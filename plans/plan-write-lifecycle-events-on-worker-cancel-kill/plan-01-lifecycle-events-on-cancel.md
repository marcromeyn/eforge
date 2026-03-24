---
id: plan-01-lifecycle-events-on-cancel
name: Write Lifecycle Events on Worker Cancel/Kill
depends_on: []
branch: plan-write-lifecycle-events-on-worker-cancel-kill/lifecycle-events-on-cancel
---

# Write Lifecycle Events on Worker Cancel/Kill

## Architecture Context

When a worker is cancelled via `POST /api/cancel/{sessionId}`, the `cancelWorker()` function in `server-main.ts` sends SIGTERM and marks DB runs as `killed`, but never writes `phase:end` or `session:end` events. The monitor detail panel derives status from events, so killed sessions appear stuck as "Running". Additionally, `rollupStatus()` in the UI sidebar only checks for `running` and `failed` — it doesn't recognize `killed` as terminal, so the sidebar also shows "Running" for killed sessions.

## Implementation

### Overview

Three coordinated changes:
1. After `cancelWorker()` kills a process and marks runs as `killed`, write synthetic `phase:end` and `session:end` events into the DB so the detail panel reflects the kill immediately.
2. Add `killed` to the failed check in `rollupStatus()` so the sidebar shows the red X icon.
3. The `RunInfo.status` type in `types.ts` is already `string` (not a union literal), so no type change is needed there.

### Key Decisions

1. Synthetic events use `result: { status: 'failed', summary: 'Cancelled' }` to match the existing event schema that the detail panel already processes for failed sessions.
2. Events are written inside `cancelWorker()` in `server-main.ts` (inside `createWorkerTracker()`) rather than in `server.ts`, because that's where the DB reference and kill logic live.
3. For the in-memory worker path (lines 156-165), we also need to mark runs as killed in the DB and write events — currently that path only kills the process and removes from the map without any DB updates.

## Scope

### In Scope
- Writing synthetic `phase:end` and `session:end` events in `cancelWorker()` after kill
- Marking runs as `killed` in DB for the in-memory worker path (which currently skips DB update)
- Treating `killed` as `failed` in `rollupStatus()`

### Out of Scope
- Changes to the detail panel event rendering logic
- Changes to the SSE broadcast mechanism

## Files

### Modify
- `src/monitor/server-main.ts` — In `cancelWorker()`, after killing the process and updating run status, write synthetic `phase:end` events for each running/killed run in the session, then a `session:end` event. Also fix the in-memory worker path to update DB status.
- `src/monitor/ui/src/lib/session-utils.ts` — In `rollupStatus()`, add `r.status === 'killed'` to the failed check on line 29.

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes with zero failures
- [ ] `pnpm build` completes with exit code 0
- [ ] `rollupStatus()` returns `'failed'` when any run has `status === 'killed'`
- [ ] `cancelWorker()` writes a `phase:end` event for each running run in the cancelled session
- [ ] `cancelWorker()` writes a `session:end` event for the cancelled session
- [ ] The in-memory worker path in `cancelWorker()` calls `db.updateRunStatus()` before writing events
