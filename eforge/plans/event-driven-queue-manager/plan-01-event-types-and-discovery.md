---
id: plan-01-event-types-and-discovery
name: Event Types and Mid-Cycle Discovery
depends_on: []
branch: event-driven-queue-manager/event-types-and-discovery
---

# Event Types and Mid-Cycle Discovery

## Architecture Context

This plan introduces the foundational changes needed for the event-driven queue manager: updating event types and adding the `discoverNewPrds()` helper to `runQueue()`. These changes must land first because Plan 02 (watchQueue rewrite) depends on the new event type and the discovery mechanism.

The key insight is that `runQueue()` currently snapshots the queue once at startup. When `parallelism > 1`, PRDs enqueued mid-cycle sit idle until the cycle finishes. Adding `discoverNewPrds()` to `runQueue()` solves this for the single-cycle case, and Plan 02 extends it to the long-lived watcher.

## Implementation

### Overview

1. Add `queue:prd:discovered` event type to the `QueueEvent` union
2. Remove three poll-based event types: `queue:watch:waiting`, `queue:watch:poll`, `queue:watch:cycle`
3. Add `discoverNewPrds()` helper inside `runQueue()` that re-scans the queue directory, discovers new PRDs not yet in `prdState`, and emits `queue:prd:discovered` for each
4. Call `discoverNewPrds()` on `queue:prd:complete` before `startReadyPrds()`
5. Make `orderedPrds` mutable (change from `const` filtered result to `let` / mutable array)
6. Update CLI display to handle the new event and remove cases for deleted events
7. Update tests

### Key Decisions

1. **Discovery happens inside `runQueue()`, not `watchQueue()`** - this means even a single `eforge run --queue` invocation benefits from mid-cycle discovery when `parallelism > 1`. The watcher just adds fs.watch on top.
2. **`discoverNewPrds()` is idempotent** - it compares against `prdState` and only adds PRDs not already tracked. Safe to call repeatedly.
3. **Poll events removed in this plan** - removing `queue:watch:waiting`, `queue:watch:poll`, and `queue:watch:cycle` here rather than in Plan 02 because the type changes cascade to display.ts and tests. Plan 02 will rewrite `watchQueue()` which no longer emits these events.

## Scope

### In Scope
- Adding `queue:prd:discovered` to `QueueEvent` union in `events.ts`
- Removing `queue:watch:waiting`, `queue:watch:poll`, `queue:watch:cycle` from `QueueEvent` union
- Adding `discoverNewPrds()` helper to `runQueue()` in `eforge.ts`
- Making `orderedPrds` mutable in `runQueue()`
- Calling `discoverNewPrds()` before `startReadyPrds()` on `queue:prd:complete`
- Adding `queue:prd:discovered` display case in `display.ts`
- Removing display cases for the three deleted event types in `display.ts`
- Updating `test/greedy-queue-scheduler.test.ts` with discovery tests
- Updating `test/watch-queue.test.ts` to remove references to deleted events

### Out of Scope
- Rewriting `watchQueue()` to use `fs.watch` (Plan 02)
- Daemon spawn changes (Plan 02)
- Changes to `startReadyPrds()`, `buildSinglePrd()`, or the semaphore/scheduler logic

## Files

### Modify
- `src/engine/events.ts` (~line 269-279) - Add `queue:prd:discovered` event type with `prdId` and `title` fields. Remove `queue:watch:waiting`, `queue:watch:poll`, and `queue:watch:cycle` from the `QueueEvent` union.
- `src/engine/eforge.ts` (~lines 909-1077, `runQueue()`) - Change `orderedPrds` to mutable array. Add `discoverNewPrds()` async helper that calls `loadQueue()` + `resolveQueueOrder()`, diffs against `prdState`, adds new PRDs, and pushes `queue:prd:discovered` events to `eventQueue`. Call `await discoverNewPrds()` in the `queue:prd:complete` handler (line ~1059) before `startReadyPrds()`.
- `src/engine/eforge.ts` (~lines 1084-1138, `watchQueue()`) - Remove the method body temporarily (it will be rewritten in Plan 02). Leave a minimal stub that delegates to `runQueue()` and yields `queue:complete` so the build compiles. This avoids type errors from the removed event types while Plan 02 rewrites it fully.
- `src/cli/display.ts` (~lines 647-661) - Add case for `queue:prd:discovered` displaying the discovered PRD title. Remove cases for `queue:watch:waiting`, `queue:watch:poll`, `queue:watch:cycle`.
- `test/greedy-queue-scheduler.test.ts` - Add test: with `parallelism=2`, verify `discoverNewPrds()` emits `queue:prd:discovered` when a new PRD file is written mid-build. Add test: verify re-scan without new files emits no `queue:prd:discovered` events (idempotent).
- `test/watch-queue.test.ts` - Remove tests that assert `queue:watch:cycle`, `queue:watch:waiting`, `queue:watch:poll` events. Update remaining tests to match new behavior (final `queue:complete` still emitted).
- `test/with-run-id.test.ts` (~line 48) - Remove or replace the `queue:watch:waiting` event in the test fixture. It's cast through `unknown` so it won't cause a type error, but it references a removed event type. Replace with a valid queue event (e.g., `queue:prd:skip`).
- `test/monitor-recording.test.ts` (~lines 246-247, 366, 275-282, 404-405) - Remove or replace `queue:watch:cycle` and `queue:watch:waiting` events in test fixtures. Update assertions that check for exclusion of these event types.

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes - all existing tests updated, new discovery tests pass
- [ ] `QueueEvent` union contains `queue:prd:discovered` with `prdId: string` and `title: string`
- [ ] `QueueEvent` union does NOT contain `queue:watch:waiting`, `queue:watch:poll`, or `queue:watch:cycle`
- [ ] `discoverNewPrds()` calls `loadQueue()` + `resolveQueueOrder()` and compares against `prdState`
- [ ] `discoverNewPrds()` is called before `startReadyPrds()` in the `queue:prd:complete` handler
- [ ] `display.ts` has a case for `queue:prd:discovered` and no cases for the three removed events
- [ ] `orderedPrds` in `runQueue()` is a mutable array that `discoverNewPrds()` can append to
