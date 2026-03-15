---
id: plan-01-detached-monitor
name: Detached Monitor Server
depends_on: []
branch: prd-monitor-detached-server/detached-monitor
---

# Detached Monitor Server

## Architecture Context

The current monitor runs in-process with each CLI invocation: `createMonitor()` opens the SQLite DB, starts an HTTP server, and the recorder middleware both writes events to DB and pushes them to SSE subscribers via a callback. When the CLI process exits, the HTTP server dies. This means concurrent runs each have their own server, and finishing one run kills its dashboard.

The fix: decouple the HTTP server into a detached child process that polls SQLite for new events. CLI processes only write to the DB. A lockfile coordinates server lifecycle across processes.

## Implementation

### Overview

1. Add `pid` column to the `runs` table so the detached server can detect orphaned runs
2. Create a standalone server entry point (`server-main.ts`) that runs as a detached child process — polls SQLite for events, serves SSE, detects orphans, auto-shuts down when idle
3. Create a lockfile module for coordinating server lifecycle across CLI processes
4. Decouple the recorder from SSE push — it only writes to SQLite now
5. Replace `createMonitor()` with `ensureMonitor()` that spawns/reuses the detached server
6. Add `eforge monitor` CLI command for standalone browsing
7. Add `server-main.ts` as a second tsup entry point

### Key Decisions

1. **Poll-based SSE instead of push**: The detached server polls the `events` table every ~200ms for new rows (using `id > lastSeenId`). This is simpler than IPC and leverages SQLite WAL mode's concurrent read/write capability. The existing `getEvents(runId, afterId)` query already supports this pattern.

2. **Lockfile over PID file**: JSON lockfile stores `{ pid, port, startedAt }` — richer than a bare PID file, enables port reuse detection and staleness checks. Atomic writes via tmp+rename.

3. **Port race resolution**: If two CLI processes simultaneously try to spawn a server, both fork a child that attempts to bind the port. The loser gets `EADDRINUSE` and exits cleanly. Both parents converge by re-reading the lockfile after a short delay.

4. **Auto-shutdown**: The detached server checks every 5s for active runs and recent events. If no active runs and no new events for 30s, it removes the lockfile and exits. This prevents zombie servers.

5. **Orphan detection via `process.kill(pid, 0)`**: The detached server periodically checks if PIDs of `status='running'` runs are still alive. Dead PIDs get their run status updated to `'killed'`. This handles `kill -9` scenarios.

6. **`monitor.stop()` only closes DB**: CLI processes no longer own the HTTP server, so `stop()` just closes the database connection. The detached server manages its own lifecycle.

7. **Server-main is a second tsup entry point**: Bundled to `dist/server-main.js` without the shebang. Only externalizes `better-sqlite3` (no claude-agent-sdk dependency). In dev mode, `process.execArgv` is propagated to the child so tsx loaders work.

## Scope

### In Scope
- Detached server process with poll-based SSE delivery
- Lockfile coordination (spawn/reuse/stale detection)
- `pid` column in `runs` table for orphan detection
- Orphan detection loop in detached server
- Auto-shutdown when idle (30s no activity)
- `GET /api/health` endpoint
- `eforge monitor` standalone CLI command
- `server-main.ts` as second tsup entry point
- Recorder decoupled from SSE push (DB-only writes)
- `ensureMonitor()` replacing `createMonitor()` for CLI use

### Out of Scope
- Configurable auto-shutdown timeout
- Multi-repo monitor aggregation
- Authentication/access control
- Remote access (always 127.0.0.1)

## Files

### Create
- `src/monitor/server-main.ts` — Detached server entry point. Opens DB, starts HTTP server, runs poll loop (200ms) for SSE delivery, orphan detection loop (5s), auto-shutdown check (5s/30s idle). Writes lockfile on startup, removes on shutdown. Handles SIGTERM/SIGINT gracefully.
- `src/monitor/lockfile.ts` — Lockfile coordination utilities: `readLockfile()`, `writeLockfile()`, `removeLockfile()`, `isServerAlive()` (PID check + `/api/health` fetch). Atomic writes via tmp+rename. Lockfile path: `.eforge/monitor.lock`.

### Modify
- `src/monitor/db.ts` — Add `pid INTEGER` column to `runs` schema (via `ALTER TABLE IF NOT EXISTS` pattern since SQLite doesn't support `IF NOT EXISTS` for columns — use a migration check). Add `pid` parameter to `insertRun()`. Add `getRunningRuns(): RunRecord[]` query (returns runs with `status = 'running'`). Add `updateRunStatus` overload that doesn't require `completedAt` (for orphan `'killed'` updates). Export `RunRecord` with optional `pid` field.
- `src/monitor/server.ts` — Add `GET /api/health` endpoint returning `{ status: 'ok', pid: process.pid }`. Remove the `pushEvent` method from `MonitorServer` interface (no longer needed — SSE delivery is poll-based in detached server). The server now polls DB for new events per subscriber using their `lastSeenId` cursor. The existing `serveSSE` already replays historical events — extend it with a poll interval that checks for new events and pushes them to the subscriber.
- `src/monitor/recorder.ts` — Remove the `onEvent` callback parameter from `withRecording()`. The function now only writes to SQLite. Accept optional `pid` parameter to pass to `insertRun()`.
- `src/monitor/index.ts` — Replace `createMonitor()` with `ensureMonitor()`. New flow: check lockfile → if alive, reuse (return URL + DB-only recorder) → if stale/missing, spawn detached child → wait for health check → return URL + DB-only recorder. The `Monitor` interface changes: `server` becomes `{ port: number; url: string }` (no `pushEvent`, no `stop` for server). `stop()` only closes the DB connection.
- `src/cli/index.ts` — Update `withMonitor` to use `ensureMonitor()`. `stop()` no longer kills the server. Add `eforge monitor` command: starts/reuses detached server via `ensureMonitor()`, prints URL, keeps process alive (readline or signal wait), on Ctrl+C sends shutdown signal to detached server if no active runs remain. Pass `process.pid` through to the recorder so it's stored in the `runs` table.
- `tsup.config.ts` — Add `src/monitor/server-main.ts` as a second entry point. Configure it without the shebang banner. Only externalize `better-sqlite3` for this entry (not claude-agent-sdk). Output to `dist/server-main.js`.

## Database Migration

The `runs` table gains a `pid` column. Since this is SQLite with `CREATE TABLE IF NOT EXISTS` and the DB is ephemeral (`.eforge/monitor.db` is gitignored), handle this pragmatically:

```sql
-- Add pid column if it doesn't exist (checked programmatically)
ALTER TABLE runs ADD COLUMN pid INTEGER;
```

In `db.ts`, after executing the base schema, check if the `pid` column exists via `PRAGMA table_info(runs)` and add it if missing. This handles both fresh DBs (column in CREATE TABLE) and existing DBs (ALTER TABLE).

Update the base schema to include `pid` for fresh databases:

```sql
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  plan_set TEXT NOT NULL,
  command TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  cwd TEXT NOT NULL,
  pid INTEGER
);
```

## Verification

- [ ] `pnpm build` produces both `dist/cli.js` and `dist/server-main.js`
- [ ] `pnpm type-check` passes with no errors
- [ ] `pnpm test` — all existing tests pass
- [ ] Two concurrent `eforge run` invocations print the same monitor URL (same port)
- [ ] Killing the first `eforge run` process does not interrupt the dashboard SSE stream
- [ ] After all runs complete, the detached server auto-exits within ~35s and `.eforge/monitor.lock` is removed
- [ ] `kill -9` on a CLI process causes the run to be marked `'killed'` in the DB within ~10s
- [ ] `eforge monitor` starts a server (or reuses existing), prints URL, stays alive until Ctrl+C
- [ ] `eforge monitor` with no prior runs shows empty dashboard without crashing
- [ ] Stale lockfile (dead PID) is detected and replaced on next `ensureMonitor()` call
