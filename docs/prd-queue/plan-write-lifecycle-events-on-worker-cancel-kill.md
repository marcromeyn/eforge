---
title: Plan: Write lifecycle events on worker cancel/kill
created: 2026-03-24
status: pending
---

# Write Lifecycle Events on Worker Cancel/Kill

## Problem / Motivation

When a worker is cancelled (via `POST /api/cancel/{sessionId}` or duplicate watcher kill), `cancelWorker()` sends `SIGTERM` and marks the DB run as `killed`, but does **not** write `phase:end` or `session:end` events. The monitor detail panel computes status from events (not run status), so killed sessions appear stuck as "Running" forever.

Additionally, `rollupStatus()` in the UI doesn't recognize `killed` as a terminal status, compounding the problem at the sidebar level.

## Goal

Ensure cancelled/killed sessions immediately reflect their terminal state ("Failed") in both the detail panel and sidebar, by writing synthetic lifecycle events on cancel and treating `killed` as a failed terminal status in the UI.

## Approach

Three coordinated changes:

### 1. Write synthetic lifecycle events on cancel (`src/monitor/server-main.ts`)

After `cancelWorker()` kills the process and marks runs as `killed`, insert `phase:end` and `session:end` events into the DB for any running runs in that session. This uses existing `db.insertEvent()` and `db.getRunsBySession()` — no new DB methods needed.

In `cancelWorker()` (~line 154–184), after the kill + status update:

```typescript
// Write lifecycle events so the detail panel reflects the kill
const sessionRuns = db.getRunsBySession(sessionId);
const now = new Date().toISOString();
for (const run of sessionRuns) {
  if (run.status === 'running' || run.status === 'killed') {
    db.insertEvent({
      runId: run.id,
      type: 'phase:end',
      data: JSON.stringify({ type: 'phase:end', runId: run.id, result: { status: 'failed', summary: 'Cancelled' }, timestamp: now }),
      timestamp: now,
    });
  }
}
// Write session:end
db.insertEvent({
  runId: sessionRuns[sessionRuns.length - 1]?.id ?? '',
  type: 'session:end',
  data: JSON.stringify({ type: 'session:end', sessionId, result: { status: 'failed', summary: 'Cancelled' }, timestamp: now }),
  timestamp: now,
});
```

### 2. Handle `killed` in `rollupStatus()` (`src/monitor/ui/src/lib/session-utils.ts`)

Add `killed` to the failed check in `rollupStatus()` (~line 27–31):

```typescript
if (runs.some((r) => r.status === 'failed' || r.status === 'killed')) return 'failed';
```

### 3. Update `RunInfo` type (`src/monitor/ui/src/lib/types.ts`)

Ensure the `status` field on `RunInfo` accepts `'killed'` as a value, not just `'running' | 'failed' | 'completed'`.

## Scope

**In scope:**
- Writing synthetic `phase:end` and `session:end` events in `cancelWorker()` after kill
- Treating `killed` as `failed` in `rollupStatus()`
- Adding `killed` to the `RunInfo.status` type (if not already present)

**Out of scope:**
- N/A

## Acceptance Criteria

- `pnpm test` — existing tests pass
- `pnpm build` — builds clean (includes UI rebuild)
- Triggering a build via daemon, then cancelling it via the stop button in the monitor sidebar results in the detail panel showing "Failed" (not "Running") immediately after cancel
- The sidebar shows the red X icon for cancelled sessions
- Files modified are limited to:
  - `src/monitor/server-main.ts`
  - `src/monitor/ui/src/lib/session-utils.ts`
  - `src/monitor/ui/src/lib/types.ts`
