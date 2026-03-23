---
id: plan-01-enqueue-monitor-visibility
name: Add Formatter/Enqueue Visibility to Monitor
depends_on: []
branch: plan-add-formatter-enqueue-visibility-to-monitor/enqueue-monitor-visibility
---

# Add Formatter/Enqueue Visibility to Monitor

## Architecture Context

The monitor records EforgeEvents to SQLite via `withRecording()` in `src/monitor/recorder.ts`, then the web UI reads from the DB. Currently, the recorder only creates run records on `phase:start` events and only records events when a `runId` is set. Enqueue events (`enqueue:start` → agent events → `enqueue:complete`) never emit `phase:start`, so they are silently dropped — zero enqueue events reach SQLite.

The fix treats enqueue as a first-class run (like compile/build) by generating a synthetic `runId` on `enqueue:start` and managing the lifecycle in the recorder. The UI then displays it as a phase within the session group.

## Implementation

### Overview

1. Add `updateRunPlanSet()` to `MonitorDB` so the recorder can update the plan set name after enqueue completes (since the title isn't known at `enqueue:start` time)
2. Update the recorder to handle `enqueue:start`/`enqueue:complete` lifecycle, buffering `session:start` until a run exists
3. Add `enqueue` to the session-utils sort order
4. Add enqueue state tracking to the UI reducer
5. Add event card summaries for enqueue events
6. Add explicit formatter color in the thread pipeline
7. Add tests for recording and reducer changes

### Key Decisions

1. **Synthetic runId via `randomUUID()`** — The engine doesn't emit a `runId` for enqueue, so the recorder generates one. This keeps the engine unchanged (consumer-only fix).
2. **Session:start buffering** — `session:start` arrives before `enqueue:start`, but we can't record it without a `runId`. Buffer it and flush when the enqueue run is created.
3. **Separate `enqueueRunId` tracking** — The recorder tracks `enqueueRunId` independently from the main `runId` so that when `phase:start` arrives later (in `eforge build` flow), the existing logic takes over seamlessly.
4. **`updateRunPlanSet()` as a dedicated DB method** — At `enqueue:start` we only have `event.source` (the input path). The actual PRD title arrives at `enqueue:complete`, requiring a post-hoc update.

## Scope

### In Scope
- DB: `updateRunPlanSet()` method on MonitorDB interface
- Recorder: Handle `enqueue:start`, `enqueue:complete`, buffer `session:start`
- Session utils: Add `enqueue: -1` to `commandOrder`
- Reducer: Track `enqueueStatus`, `enqueueTitle`, `enqueueSource`; handle `session:start` for `startTime`
- Event card: Add `enqueue:start` and `enqueue:complete` summaries to `eventSummary()`
- Thread pipeline: Add explicit `formatter` entry to `AGENT_COLORS`
- Tests for recording and reducer

### Out of Scope
- Engine event emission changes
- Queue section UI changes
- Monitor server/SSE changes

## Files

### Modify
- `src/monitor/db.ts` — Add `updateRunPlanSet(runId: string, planSet: string): void` to the `MonitorDB` interface. Add a prepared statement `UPDATE runs SET plan_set = ? WHERE id = ?`. Implement in the returned object.
- `src/monitor/recorder.ts` — Import `randomUUID` from `node:crypto`. Add `enqueueRunId` variable alongside existing `runId`. Add `bufferedSessionStart` variable for the session:start event. On `session:start` when no `runId` is set, buffer the event. On `enqueue:start`: generate `enqueueRunId = randomUUID()`, call `db.insertRun()` with `command: 'enqueue'` and `event.source` as `planSet`, flush the buffered `session:start` event (insert it into DB under the new `enqueueRunId`), set tracking so subsequent events record under `enqueueRunId`. On `enqueue:complete`: call `db.updateRunPlanSet(enqueueRunId, event.title)`, call `db.updateRunStatus(enqueueRunId, 'completed', timestamp)`. On `session:end` when the active `runId` equals `enqueueRunId` (standalone enqueue or failed enqueue): if result is `failed`, mark the enqueue run as `failed`. When `phase:start` arrives later: existing logic sets a new `runId`, overriding the enqueue tracking so compile/build events record under their own run.
- `src/monitor/ui/src/lib/session-utils.ts` — Add `enqueue: -1` to the `commandOrder` object so enqueue runs sort before compile (0) and build (2).
- `src/monitor/ui/src/lib/reducer.ts` — Add `enqueueStatus: 'running' | 'complete' | null`, `enqueueTitle: string | null`, `enqueueSource: string | null` to `RunState` interface. Add corresponding null defaults to `initialRunState`. In `processEvent()`: handle `session:start` to set `startTime` when null (currently only `phase:start` does this, which breaks standalone enqueue sessions). Handle `enqueue:start` to set `enqueueStatus = 'running'` and `enqueueSource = event.source`. Handle `enqueue:complete` to set `enqueueStatus = 'complete'` and `enqueueTitle = event.title`. Update `BATCH_LOAD` and `RESET` cases to include new fields.
- `src/monitor/ui/src/components/timeline/event-card.tsx` — Add cases to `eventSummary()`: `enqueue:start` returns `Enqueuing from: ${event.source}`, `enqueue:complete` returns `Enqueued: ${event.title} → ${event.filePath}`.
- `src/monitor/ui/src/components/pipeline/thread-pipeline.tsx` — Add `formatter: { bg: 'bg-cyan/30', border: 'border-cyan/50' }` to the `AGENT_COLORS` object.
- `test/monitor-recording.test.ts` — Add a new `describe` block for enqueue recording. Test that an event stream of `session:start` → `enqueue:start` → `agent:start` (formatter) → `agent:result` → `agent:stop` → `enqueue:complete` → `session:end` results in: a run record with `command: 'enqueue'` and status `completed`, `planSet` updated to the title from `enqueue:complete`, and all events stored in the DB.
- `test/monitor-reducer.test.ts` — Add tests: `enqueue:start` sets `enqueueStatus` to `'running'` and `enqueueSource`; `enqueue:complete` sets `enqueueStatus` to `'complete'` and `enqueueTitle`; `session:start` sets `startTime` when no `phase:start` has arrived.

## Verification

- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` exits with code 0 (all existing + new tests pass)
- [ ] `pnpm build` exits with code 0
- [ ] New test in `test/monitor-recording.test.ts` verifies: enqueue event stream creates a run record with `command === 'enqueue'`, `status === 'completed'`, and `planSet` matching the `enqueue:complete` title
- [ ] New test in `test/monitor-recording.test.ts` verifies: all 7 events in the enqueue stream are stored in the events table
- [ ] New test in `test/monitor-reducer.test.ts` verifies: dispatching `enqueue:start` sets `enqueueStatus` to `'running'`
- [ ] New test in `test/monitor-reducer.test.ts` verifies: dispatching `enqueue:complete` sets `enqueueStatus` to `'complete'` and `enqueueTitle` to the event's title
- [ ] New test in `test/monitor-reducer.test.ts` verifies: dispatching `session:start` (without prior `phase:start`) sets `startTime` to the event's timestamp
- [ ] `enqueue` entry exists in `commandOrder` with value `-1` (sorts before compile at 0)
- [ ] `formatter` key exists in `AGENT_COLORS` with cyan bg/border values
- [ ] `eventSummary()` returns a non-empty string for events of type `enqueue:start` and `enqueue:complete`
