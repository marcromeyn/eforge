---
title: Fix: Eval framework — foreground builds + shared eval monitor
created: 2026-03-24
status: pending
---

# Fix: Eval framework — foreground builds + shared eval monitor

## Problem / Motivation

Two problems exist with the eval framework:

1. **Daemon-mode default breaks evals**: `eforge run` defaults to daemon mode, so eval scenarios just enqueue PRDs and exit without actually building them.
2. **Orphaned monitor servers**: Each scenario spawns its own detached monitor server in a temporary workspace. These become orphan processes when the workspace is deleted after the scenario completes.

The result is that evals don't actually execute builds, and leftover monitor processes accumulate.

## Goal

Make the eval framework run foreground builds and use a single shared monitor server for the entire eval run, so all scenarios can be observed live from one dashboard and no orphaned processes are left behind.

## Approach

### Already done (in current working tree)

- `eval/run.sh` line 45: replaced `mapfile` (bash 4+) with portable `while read` loop for macOS bash 3.x compatibility.
- `eval/lib/run-scenario.sh`: added `--foreground` to eforge invocation.

### 1. Engine: allow overriding monitor DB path via env var

**File**: `src/monitor/index.ts` — `ensureMonitor()`

Add support for `EFORGE_MONITOR_DB` env var. When set, use it instead of `<cwd>/.eforge/monitor.db` for the DB path. The lockfile stays cwd-scoped (needed for daemon discovery).

```typescript
const dbPath = process.env.EFORGE_MONITOR_DB || resolve(cwd, '.eforge', 'monitor.db');
```

This is a one-line change. The lockfile and server spawning logic stays the same.

### 2. Eval: start a shared monitor server before scenarios, kill it after

**File**: `eval/run.sh` — `main()`

Before the scenario loop:
- Set `EVAL_MONITOR_DB="$run_dir/monitor.db"` (shared DB in eval results dir).
- Export `EFORGE_MONITOR_DB="$EVAL_MONITOR_DB"` so all scenario eforge invocations write to it.
- Start `server-main.js` directly pointing at the shared DB, with a dedicated port (e.g., 4580 to avoid clashing with project daemon on 4567).
- Print the monitor URL.

After the scenario loop (in a trap or finally block):
- Kill the monitor server PID.
- The shared `monitor.db` stays in `$run_dir/` for post-hoc analysis.

### 3. Eval: pass `--no-monitor` to scenarios since the shared server handles it

**File**: `eval/lib/run-scenario.sh`

Change invocation to:
```bash
"$eforge_bin" run "$prd" --auto --verbose --foreground --no-monitor
```

With `EFORGE_MONITOR_DB` set, `--no-monitor` skips spawning a per-scenario server, but `withRecording()` still writes events to the shared DB (via the env var override). The shared server polls that same DB for SSE delivery.

### 4. Eval: stop copying per-scenario monitor.db (it's now shared)

**File**: `eval/lib/run-scenario.sh` (lines 89–94)

Remove or skip the `monitor.db` copy step since the DB is now shared at the run level.

**File**: `eval/lib/build-result.ts`

Update to accept the shared DB path. Currently takes `$scenario_dir/monitor.db` as arg — change to accept the eval-level DB path.

### Files to modify

- `src/monitor/index.ts` — one-line DB path override
- `eval/run.sh` — start/stop shared monitor server, export env var
- `eval/lib/run-scenario.sh` — add `--no-monitor`, remove per-scenario DB copy
- `eval/lib/build-result.ts` — read metrics from shared DB path

## Scope

**In scope:**
- `EFORGE_MONITOR_DB` env var support in the engine's monitor module
- Shared monitor server lifecycle management in the eval runner
- `--no-monitor` flag for per-scenario invocations
- Removing per-scenario `monitor.db` copy logic
- Updating `build-result.ts` to read from the shared DB path

**Out of scope:**
- Changes to the daemon discovery or lockfile logic (lockfile stays cwd-scoped)
- Changes to the monitor server itself beyond DB path sourcing
- Changes to the SSE delivery or web dashboard UI

## Acceptance Criteria

- Running a single eval scenario (`./eval/run.sh todo-api-errand-health-check`) prints a shared monitor URL, the build runs with non-zero tokens, and the monitor server is killed at exit.
- No orphaned eforge or monitor processes remain after the eval run completes (`ps aux | grep eforge | grep -v grep` returns nothing).
- `EFORGE_MONITOR_DB` env var, when set, causes the engine to use the specified path for the monitor SQLite database instead of the default `<cwd>/.eforge/monitor.db`.
- Per-scenario eforge invocations run with `--foreground` and `--no-monitor`, but events are still recorded to the shared DB via `withRecording()`.
- The shared `monitor.db` persists in `$run_dir/` after the eval completes for post-hoc analysis.
- `build-result.ts` reads metrics from the shared eval-level DB path rather than a per-scenario `monitor.db`.
