---
title: Plan: Queue-First `eforge run`
created: 2026-03-23
status: pending
---

# Queue-First `eforge run`

## Problem / Motivation

The daemon should be the single orchestration authority, but currently `eforge run <source>` runs the full pipeline (enqueue → compile → build) in-process, bypassing the daemon entirely. The MCP path goes through the daemon but spawns a worker that does the same. Neither leverages the queue as the canonical entry point. This creates two parallel execution paths that don't share lifecycle management, failure handling, or monitoring through the daemon.

## Goal

Make the queue the canonical entry point for all execution: `eforge run <source>` = enqueue + daemon auto-builds. The daemon starts a persistent watcher worker on startup that polls the queue and processes PRDs automatically, centralizing orchestration authority in the daemon.

## Approach

### 1. Config: add `prdQueue.autoBuild`

**File**: `src/engine/config.ts`

- Add `autoBuild: z.boolean().optional()` to the prdQueue Zod schema (~line 190)
- Add `autoBuild: boolean` to the prdQueue type in `EforgeConfig` interface (~line 221)
- Default: `true` in `DEFAULT_CONFIG` (~line 277)
- Add to merge logic in `loadConfig()` (~line 347)

### 2. Extract shared daemon client

**New file**: `src/cli/daemon-client.ts`

Extract from `src/cli/mcp-proxy.ts` (lines 50-112):
- `ensureDaemon(cwd): Promise<number>` — check lockfile, auto-start daemon, poll until ready
- `daemonRequest(cwd, method, path, body?): Promise<unknown>` — HTTP helper
- `sleep(ms)` helper + constants (`DAEMON_START_TIMEOUT_MS`, `DAEMON_POLL_INTERVAL_MS`)

Then update `mcp-proxy.ts` to import from `daemon-client.ts` instead of defining locally.

### 3. Daemon watcher lifecycle

**File**: `src/monitor/server-main.ts`

After `writeLockfile` (line 187), in persistent mode:

- **Load config** to read `autoBuild` setting
- **Track watcher state**: `watcherProcess`, `watcherSessionId`, `autoBuildEnabled`
- **`spawnWatcher()`**: spawn `eforge run --queue --watch --auto --no-monitor` as detached child. Track PID. Listen for exit to clear state.
- **`killWatcher()`**: SIGTERM the watcher, clear state
- **Auto-start**: if `persistent && autoBuildEnabled`, call `spawnWatcher()` after lockfile is written
- **Respawn on crash**: extend the existing orphan detection interval (line 190-201) to check watcher health — if dead and autoBuild enabled, respawn
- **Shutdown**: call `killWatcher()` in the shutdown handler before removing lockfile

**Pass state to server**: Create a `DaemonState` interface:
```typescript
interface DaemonState {
  getAutoBuild(): boolean;
  setAutoBuild(enabled: boolean): void;  // toggles + spawns/kills watcher
  getWatcherInfo(): { running: boolean; pid: number | null; sessionId: string | null };
}
```
Pass to `startServer()` options alongside existing `workerTracker`.

### 4. HTTP API: auto-build endpoints

**File**: `src/monitor/server.ts`

- `GET /api/auto-build` → `{ enabled, watcher: { running, pid, sessionId } }` (503 if not daemon mode)
- `POST /api/auto-build` with `{ enabled: boolean }` → toggle autoBuild, returns same shape
- Enrich `POST /api/enqueue` response with `autoBuild` field so callers know if auto-build will process it

### 5. CLI: rename `eforge run` → `eforge build`, default to daemon delegation

**File**: `src/cli/index.ts`

- Rename the `run` command to `build`. Add `run` as a hidden alias for backwards compatibility.
- Add `--foreground` flag.

**New default path** (when source provided, no `--foreground`, no `--queue`, no `--dry-run`):
1. `ensureDaemon(cwd)` — auto-start daemon if needed
2. `POST /api/enqueue` with source
3. Print: "PRD enqueued. Daemon will auto-build." + sessionId + monitor URL
4. Exit

**Fallback**: if daemon unreachable, warn and fall through to existing in-process path (which becomes the `--foreground` path).

The existing in-process `allPhases()` code is unchanged — it just runs when `--foreground` is set or daemon is unavailable.

**`eforge build --queue`** and **`eforge build --queue --watch`** retain existing behavior (explicit queue processing). These are also what the daemon's watcher worker invokes internally.

### 6. MCP proxy: align with queue-first

**File**: `src/cli/mcp-proxy.ts`

- Import `ensureDaemon`/`daemonRequest` from `daemon-client.ts`
- **Rename `eforge_run` → `eforge_build`**: calls `POST /api/enqueue` (enqueue only, daemon auto-builds)
- **Remove queue mode from `eforge_build`** — the daemon watcher handles queue processing. No `--queue`/`--watch` flags needed on the MCP tool.
- **New tool `eforge_auto_build`**: get/set auto-build state via `GET/POST /api/auto-build`

### 7. Plugin skill overhaul

**Remove**:
- `eforge-plugin/skills/run/run.md` — replaced by `/eforge:build`
- `eforge-plugin/skills/enqueue/enqueue.md` — subsumed by `/eforge:build`

**Create**:
- `eforge-plugin/skills/build/build.md` — new `/eforge:build` skill. Accepts a source (file or inline), calls `mcp__eforge__eforge_build`, reports "PRD enqueued, daemon will auto-build" with sessionId and monitor URL.

**Update**:
- `eforge-plugin/.claude-plugin/plugin.json` — bump version, update commands array (remove run + enqueue, add build)

### 8. Documentation updates

- **`CLAUDE.md`** — update CLI commands section (`eforge run` → `eforge build`), update plugin skill references, add `prdQueue.autoBuild` to config docs
- **`README.md`** — update all CLI examples (`eforge run` → `eforge build`), update architecture description to reflect queue-first model and daemon auto-build

### Failure behavior: pause + notify

When any PRD build fails, the watcher **pauses auto-build** and emits a prominent notification, preventing cascading failures if the repo is in a broken state.

1. **Watcher reports failure to daemon**: When the watcher worker exits (non-zero or with a `queue:complete` event where any PRD failed), the daemon detects this via the `child.on('exit')` handler.

2. **Daemon pauses auto-build**: Instead of respawning the watcher on exit, the daemon checks the exit reason. If the watcher exited due to a build failure (vs clean shutdown), set `autoBuildEnabled = false` and do NOT respawn.

3. **Emit notification event**: The daemon writes a `daemon:auto-build:paused` event to the SQLite DB with `reason: 'build-failed'`. The monitor SSE stream picks this up and the web UI can show a banner.

4. **User re-enables**: User reviews the failure in the monitor, fixes or removes the failed PRD, then re-enables auto-build via web UI toggle or MCP tool.

**Distinguishing failure from clean exit**: The watcher worker exits with code 0 when aborted (SIGTERM from toggle-off or daemon shutdown) and non-zero when a build fails. The daemon's exit handler checks the code:
- Exit code 0 + was killed by us → don't respawn (intentional stop)
- Exit code 0 + not killed → check if autoBuild still enabled → respawn (clean cycle completion, should keep watching)
- Exit code non-zero → pause auto-build + notify

### Key design decisions

- **Watcher is a subprocess**, not inline engine code in the daemon. Daemon stays a thin coordinator.
- **autoBuild is in-memory toggle** — reads from config on startup, `POST /api/auto-build` changes runtime state only. Persistent config changes require editing `eforge.yaml`.
- **5s poll delay is acceptable** — PRD shows up on next watcher cycle. Can optimize with IPC later.
- **`--foreground` is the escape hatch** — direct in-process execution for dev/debugging.
- **Fallback on daemon failure** — CLI gracefully falls back to foreground execution if daemon won't start.
- **Build failure pauses auto-build** — any failed PRD stops the watcher and notifies the user. Prevents cascading failures.

### Files to modify

| File | Change |
|------|--------|
| `src/engine/config.ts` | Add `prdQueue.autoBuild` (default: true) |
| `src/cli/daemon-client.ts` | **New** — extracted `ensureDaemon` + `daemonRequest` |
| `src/monitor/server-main.ts` | Watcher lifecycle: spawn/kill/respawn + `DaemonState` |
| `src/monitor/server.ts` | `GET/POST /api/auto-build` endpoints |
| `src/cli/index.ts` | Rename `run` → `build` (+ alias), `--foreground` flag, default path → daemon enqueue |
| `src/cli/mcp-proxy.ts` | Import shared client, rename `eforge_run` → `eforge_build` (enqueue-only), add `eforge_auto_build` tool |
| `eforge-plugin/skills/build/build.md` | **New** — `/eforge:build` skill replacing `/eforge:run` and `/eforge:enqueue` |
| `eforge-plugin/skills/run/run.md` | **Delete** |
| `eforge-plugin/skills/enqueue/enqueue.md` | **Delete** |
| `eforge-plugin/.claude-plugin/plugin.json` | Version bump, update commands array |
| `CLAUDE.md` | Update CLI commands, plugin refs, config docs |
| `README.md` | Update CLI examples, architecture description |

## Scope

### In scope

- New `prdQueue.autoBuild` config option (default: `true`)
- Extracting shared daemon client (`ensureDaemon`, `daemonRequest`) into `src/cli/daemon-client.ts`
- Daemon watcher lifecycle: spawn, kill, respawn, health checks, shutdown handling
- HTTP API endpoints for auto-build state (`GET/POST /api/auto-build`)
- Renaming `eforge run` → `eforge build` with `run` as hidden backwards-compatible alias
- New `--foreground` flag for direct in-process execution
- Default CLI path: enqueue via daemon, exit immediately
- Graceful fallback to foreground execution when daemon is unavailable
- MCP proxy updates: rename `eforge_run` → `eforge_build` (enqueue-only), new `eforge_auto_build` tool
- Plugin skill overhaul: remove `/eforge:run` and `/eforge:enqueue`, create `/eforge:build`
- Failure handling: pause auto-build on build failure, emit `daemon:auto-build:paused` event, require user re-enable
- Documentation updates to `CLAUDE.md` and `README.md`

### Out of scope

- IPC-based instant watcher notification (5s poll is acceptable for now)
- Persistent config changes via API (runtime toggle only; persistent changes require editing `eforge.yaml`)
- Web UI changes for the auto-build toggle/banner (beyond emitting the SSE event)
- Changes to the existing `--queue` / `--queue --watch` behavior
- Changes to the engine pipeline itself

## Acceptance Criteria

1. `pnpm build` completes with no type errors.
2. `pnpm test` — all existing tests pass.
3. `eforge daemon start` spawns a watcher worker process (verifiable via `ps aux | grep eforge`).
4. `eforge build <source>` enqueues the PRD and returns immediately; the daemon's watcher picks up and processes the PRD within 5 seconds.
5. `eforge build <source> --foreground` executes the full pipeline in-process (old behavior).
6. `eforge run <source>` works as a backwards-compatible alias for `eforge build`.
7. MCP tool `eforge_auto_build` with `{ enabled: false }` stops the watcher; `{ enabled: true }` respawns it.
8. When a PRD build fails, the watcher pauses auto-build (does not respawn), and a `daemon:auto-build:paused` event is emitted to the SQLite DB / SSE stream.
9. When the daemon is unreachable, `eforge build <source>` warns and falls back to foreground in-process execution.
10. The monitor dashboard shows PRDs appearing in the queue and transitioning through compile/build phases.
11. `mcp-proxy.ts` imports `ensureDaemon`/`daemonRequest` from the new `daemon-client.ts` (no duplicated code).
12. Plugin version is bumped in `eforge-plugin/.claude-plugin/plugin.json`; commands array reflects the removal of `run`/`enqueue` and addition of `build`.
