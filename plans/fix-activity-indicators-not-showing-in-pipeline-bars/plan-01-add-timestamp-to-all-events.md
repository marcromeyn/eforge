---
id: plan-01-add-timestamp-to-all-events
name: Add Required Timestamp to All EforgeEvents
dependsOn: []
branch: fix-activity-indicators-not-showing-in-pipeline-bars/add-timestamp-to-all-events
---

# Add Required Timestamp to All EforgeEvents

## Architecture Context

The `ActivityOverlay` component in the monitor UI filters events with `'timestamp' in event`. Streaming events (`agent:message`, `agent:tool_use`, `agent:tool_result`) emitted by `mapSDKMessages` lack timestamps, so the activity heatmap renders nothing. The fix makes `timestamp` a required field on the base `EforgeEvent` type so the TypeScript compiler enforces all emission sites include it.

## Implementation

### Overview

1. Add `timestamp: string` to the base `EforgeEvent` intersection type
2. Remove per-variant `timestamp` declarations from the 6 event types that already have them
3. Add `timestamp: new Date().toISOString()` to every yield site that the compiler flags
4. Simplify the recorder's timestamp fallback to use `event.timestamp` directly
5. Add `hydrateTimestamp()` to the monitor server for backward compatibility with legacy DB events

### Key Decisions

1. **Base type approach** — Adding timestamp to the base intersection type rather than to each variant ensures future event types automatically require it. The compiler catches omissions at every yield site.
2. **ISO string format** — Use `new Date().toISOString()` consistently, matching the existing pattern in `agent:start`/`agent:stop` and session lifecycle events.
3. **Hydration at read time** — Legacy events stored without JSON-embedded timestamps get the DB `timestamp` column injected at serving time, avoiding a SQLite migration.
4. **Re-yield sites untouched** — Sites in `session.ts` and `eforge.ts` that spread existing events (`yield { ...event, sessionId }`) automatically carry through the upstream timestamp.

## Scope

### In Scope
- Making `timestamp` required on base `EforgeEvent` type in `events.ts`
- Removing redundant per-variant `timestamp` declarations from 6 event types
- Adding `timestamp: new Date().toISOString()` to all ~138 yield sites across engine source files
- Adding `hydrateTimestamp()` helper to `src/monitor/server.ts` and applying at SSE replay, SSE poll, and batch API paths
- Simplifying recorder timestamp logic in `src/monitor/recorder.ts`
- Updating test fixtures that construct EforgeEvent objects (e.g., `test/stub-backend.ts`)

### Out of Scope
- Changes to the `ActivityOverlay` component rendering logic
- SQLite schema migrations
- New monitor UI features

## Files

### Modify
- `src/engine/events.ts` — Add `timestamp: string` to base `EforgeEvent` type; remove per-variant `timestamp` from `session:start`, `session:end`, `phase:start`, `phase:end`, `agent:start`, `agent:stop`
- `src/engine/backends/claude-sdk.ts` — Add `timestamp: new Date().toISOString()` to 7 yield sites (`agent:message`, `agent:tool_use`, `agent:tool_result`, `agent:result`)
- `src/engine/eforge.ts` — Add `timestamp` to ~22 yield sites (enqueue, queue, cleanup, build:failed events)
- `src/engine/orchestrator.ts` — Add `timestamp` to ~24 yield sites (schedule, merge, validation, finalize events)
- `src/engine/pipeline.ts` — Add `timestamp` to ~32 yield sites (compile and build stage events)
- `src/engine/agents/planner.ts` — Add `timestamp` to ~13 yield sites
- `src/engine/agents/builder.ts` — Add `timestamp` to ~7 yield sites
- `src/engine/agents/reviewer.ts` — Add `timestamp` to ~2 yield sites
- `src/engine/agents/parallel-reviewer.ts` — Add `timestamp` to ~6 yield sites
- `src/engine/agents/review-fixer.ts` — Add `timestamp` to ~2 yield sites
- `src/engine/agents/plan-reviewer.ts` — Add `timestamp` to ~2 yield sites
- `src/engine/agents/plan-evaluator.ts` — Add `timestamp` to ~3 yield sites
- `src/engine/agents/doc-updater.ts` — Add `timestamp` to ~2 yield sites
- `src/engine/agents/module-planner.ts` — Add `timestamp` to ~2 yield sites
- `src/engine/agents/cohesion-reviewer.ts` — Add `timestamp` to ~2 yield sites
- `src/engine/agents/architecture-reviewer.ts` — Add `timestamp` to ~2 yield sites
- `src/engine/agents/merge-conflict-resolver.ts` — Add `timestamp` to ~3 yield sites
- `src/engine/agents/validation-fixer.ts` — Add `timestamp` to ~2 yield sites
- `src/engine/agents/staleness-assessor.ts` — Add `timestamp` to ~1 yield site
- `src/engine/agents/tester.ts` — Add `timestamp` to ~4 yield sites
- `src/monitor/recorder.ts` — Simplify timestamp fallback at line ~88 and line ~109 from `'timestamp' in event ? ... : new Date().toISOString()` to `event.timestamp`
- `src/monitor/server.ts` — Add `hydrateTimestamp()` helper; apply at SSE historical replay, SSE poll loop, and batch API serving paths
- `test/stub-backend.ts` — Add `timestamp` to `agent:tool_result` event construction (line ~85)
- `test/session.test.ts` — Add `timestamp` to event literals cast as `EforgeEvent` (~36 sites)
- `test/monitor-reducer.test.ts` — Add `timestamp` to event literals (~29 sites)
- `test/monitor-recording.test.ts` — Add `timestamp` to event literals (~43 sites)
- `test/continuation.test.ts` — Add `timestamp` to event literals
- `test/sdk-mapping.test.ts` — Add `timestamp` to event literals
- `test/sdk-event-mapping.test.ts` — Add `timestamp` to event literals
- `test/with-run-id.test.ts` — Add `timestamp` to event literals
- `test/orchestration-logic.test.ts` — Add `timestamp` to event literals
- `test/pipeline.test.ts` — Add `timestamp` to event literals
- `test/hooks.test.ts` — Add `timestamp` to event literals
- `test/files-changed-event.test.ts` — Add `timestamp` to event literals

## Verification

- [ ] `pnpm type-check` passes with zero errors — confirms all yield sites include `timestamp`
- [ ] `pnpm build` completes without errors
- [ ] `pnpm test` passes — all existing tests continue to work
- [ ] Every `yield` statement producing an `EforgeEvent` object literal includes `timestamp: new Date().toISOString()` (or spreads an event that already has one)
- [ ] The `hydrateTimestamp()` function in `server.ts` injects the DB timestamp into event JSON when `parsed.timestamp` is falsy
- [ ] The recorder in `recorder.ts` uses `event.timestamp` directly without the `'timestamp' in event` guard
- [ ] No per-variant `timestamp` declarations remain on `session:start`, `session:end`, `phase:start`, `phase:end`, `agent:start`, `agent:stop` in `events.ts`
