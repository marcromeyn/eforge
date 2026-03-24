---
id: plan-01-eval-foreground-shared-monitor
name: Eval Foreground Builds with Shared Monitor
depends_on: []
branch: fix-eval-framework-foreground-builds-shared-eval-monitor/eval-foreground-shared-monitor
---

# Eval Foreground Builds with Shared Monitor

## Architecture Context

The eval framework (`eval/run.sh` + `eval/lib/run-scenario.sh`) runs eforge scenarios in temporary workspaces. Currently, each scenario invocation spawns its own monitor server (writing to `<workspace>/.eforge/monitor.db`), and the workspace is deleted after the scenario completes — orphaning the monitor process. Additionally, `--foreground` was recently added to the eforge invocation but no `--no-monitor` flag is passed, so per-scenario servers still spawn.

The fix introduces a single shared monitor DB at the eval-run level, overridable via `EFORGE_MONITOR_DB` env var in the engine, and a shared monitor server started/stopped by the eval runner.

## Implementation

### Overview

Four coordinated changes:

1. **Engine**: Add `EFORGE_MONITOR_DB` env var support in `ensureMonitor()` so `withRecording()` writes to a caller-specified DB path instead of `<cwd>/.eforge/monitor.db`.
2. **Eval runner** (`run.sh`): Start a shared monitor server before scenarios using `server-main.js`, export `EFORGE_MONITOR_DB`, and kill the server on exit.
3. **Scenario runner** (`run-scenario.sh`): Add `--no-monitor` to the eforge invocation and remove the per-scenario `monitor.db` copy step. Pass the shared DB path to `build-result.ts`.
4. **Build result** (`build-result.ts`): No changes needed — it already accepts `monitorDbPath` as a CLI argument. The caller (`run-scenario.sh`) just needs to pass the shared path instead of the per-scenario path.

### Key Decisions

1. **Env var for DB path override** — `EFORGE_MONITOR_DB` is the simplest integration point. `withRecording()` already receives the DB handle from `ensureMonitor()`, so overriding the path at `ensureMonitor()` level propagates automatically.
2. **Lockfile stays cwd-scoped** — Only the DB path changes. The lockfile is used for daemon discovery and must remain per-workspace. Since eval scenarios use `--no-monitor`, no per-scenario lockfiles are created.
3. **Shared server on port 4580** — Avoids collision with any project daemon on the default port 4567.
4. **`signalMonitorShutdown()` also needs the env var** — It resolves `dbPath` from `cwd` to check running runs. Must use `EFORGE_MONITOR_DB` when set, for consistency.
5. **Trap-based cleanup** — The shared monitor server PID is killed in an EXIT trap so it's cleaned up even if the eval runner is interrupted.

## Scope

### In Scope
- `EFORGE_MONITOR_DB` env var support in `ensureMonitor()` and `signalMonitorShutdown()`
- Shared monitor server lifecycle in `eval/run.sh`
- `--no-monitor` flag added to per-scenario eforge invocations
- Removal of per-scenario `monitor.db` copy logic
- Passing shared DB path to `build-result.ts`

### Out of Scope
- Changes to the monitor server itself (SSE, web UI, state machine)
- Changes to daemon discovery or lockfile logic
- Changes to the `withRecording()` middleware (it already works with any DB handle)
- Changes to `check-expectations.ts`

## Files

### Modify
- `src/monitor/index.ts` — In `ensureMonitor()`, read `EFORGE_MONITOR_DB` env var and use it as `dbPath` when set. Same for `signalMonitorShutdown()`.
- `eval/run.sh` — Before the scenario loop: set and export `EFORGE_MONITOR_DB` pointing to `$run_dir/monitor.db`; resolve the `server-main.js` path and start it as a background process on port 4580 with the shared DB; print the monitor URL; register an EXIT trap to kill the monitor PID. After the scenario loop: the trap handles cleanup.
- `eval/lib/run-scenario.sh` — Add `--no-monitor` to the eforge invocation (line 66). Remove the `monitor.db` copy block (lines 88-94). Change the `build-result.ts` invocation to pass `$EFORGE_MONITOR_DB` (the shared DB path) instead of `$scenario_dir/monitor.db`.

## Verification

- [ ] `grep -q 'EFORGE_MONITOR_DB' src/monitor/index.ts` returns 0 (env var referenced in source)
- [ ] `grep -q '\-\-no-monitor' eval/lib/run-scenario.sh` returns 0 (flag present in invocation)
- [ ] `grep -q '\-\-foreground' eval/lib/run-scenario.sh` returns 0 (foreground flag preserved)
- [ ] `grep -q '4580' eval/run.sh` returns 0 (shared monitor port configured)
- [ ] `grep -q 'EFORGE_MONITOR_DB' eval/run.sh` returns 0 (env var exported)
- [ ] `grep -qv 'monitor\.db' eval/lib/run-scenario.sh` — the per-scenario `cp` of `monitor.db` files is removed (no `cp.*monitor.db` pattern in the file)
- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes
