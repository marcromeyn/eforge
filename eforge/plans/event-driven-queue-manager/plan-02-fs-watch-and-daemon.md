---
id: plan-02-fs-watch-and-daemon
name: fs.watch Watcher and Daemon Integration
depends_on: [plan-01-event-types-and-discovery]
branch: event-driven-queue-manager/fs-watch-and-daemon
---

# fs.watch Watcher and Daemon Integration

## Architecture Context

With Plan 01 landing the event type changes and `discoverNewPrds()` helper in `runQueue()`, this plan replaces the poll-sleep `watchQueue()` with a long-lived `fs.watch`-based implementation and updates the daemon spawn logic to match.

The current model: daemon spawns `eforge run --queue --auto --no-monitor` (single cycle), respawns on clean exit after a delay. The new model: daemon spawns `eforge run --queue --watch --auto --no-monitor` (long-lived), the watcher stays alive via `fs.watch` and exits only on SIGTERM/abort. Daemon respawns only on crash (non-zero exit).

## Implementation

### Overview

1. Rewrite `watchQueue()` in `eforge.ts` to use `fs.watch` instead of the poll-sleep loop
2. Update daemon spawn in `server-main.ts` to use `--watch` flag and remove clean-exit respawn logic
3. Add/update tests for the new watcher behavior

### Key Decisions

1. **`fs.watch` with 500ms debounce** - filesystem events are noisy (multiple events per file write). A 500ms debounce coalesces rapid events into a single `discoverNewPrds()` + `startReadyPrds()` call.
2. **`fs.watch` registered as an AsyncEventQueue producer** - this keeps the event consumer loop alive. When abort fires, close the watcher and call `removeProducer()`, allowing the consumer to drain and exit.
3. **Reuse `runQueue()` scheduler internals** - rather than duplicating the scheduler in `watchQueue()`, the new `watchQueue()` replicates the same state tracking (`prdState`, `semaphore`, `eventQueue`, `startReadyPrds`, `discoverNewPrds`) inline. The PRD specifies this approach. An alternative (having `runQueue()` accept a "keep alive" flag) was considered but deferred to keep the change focused.
4. **Daemon spawns with `--watch` flag** - the watcher is long-lived, so no respawn-on-clean-exit. Respawn only on non-zero exit (crash recovery).

## Scope

### In Scope
- Rewriting `watchQueue()` to use `fs.watch` with debouncing
- Integrating `discoverNewPrds()` + `startReadyPrds()` on fs.watch events
- Using `AsyncEventQueue` producer pattern for the fs.watch lifecycle
- Clean shutdown: abort signal closes watcher, drains in-flight builds, emits `queue:complete`
- Updating daemon spawn command to include `--watch` in `server-main.ts`
- Removing clean-exit respawn `setTimeout` in `server-main.ts` (keeping crash recovery respawn)
- Adding/updating tests in `test/watch-queue.test.ts`

### Out of Scope
- Changes to `runQueue()` (done in Plan 01)
- Changes to event types (done in Plan 01)
- Changes to the daemon state machine (WATCHING -> COUNTDOWN -> SHUTDOWN)
- Changes to `setupSignalHandlers()` or the abort controller infrastructure
- Changes to `startReadyPrds()` or the greedy scheduler algorithm

## Files

### Modify
- `src/engine/eforge.ts` (~lines 1084-1138, `watchQueue()`) - Full rewrite. New implementation: (1) initialize scheduler state (prdState, semaphore, eventQueue, startReadyPrds, discoverNewPrds) mirroring runQueue's pattern, (2) initial scan + startReadyPrds(), (3) set up `fs.watch` on queue directory with ~500ms debounce timer, (4) register fs.watch as eventQueue producer, (5) on file change: call discoverNewPrds() + startReadyPrds(), (6) on abort signal: close watcher + removeProducer(), (7) consume events from eventQueue yielding each, (8) on queue:prd:complete: call discoverNewPrds() + startReadyPrds(), (9) emit queue:complete when all producers done. Import `fs.watch` from `node:fs`.
- `src/monitor/server-main.ts` (~line 278) - Change spawn args from `['run', '--queue', '--auto', '--no-monitor']` to `['run', '--queue', '--watch', '--auto', '--no-monitor']`. Remove the `setTimeout(() => { ... spawnWatcher() ... }, respawnDelayMs)` block in the clean exit handler (~lines 331-336). Keep the non-zero exit handler that pauses autoBuild.
- `test/watch-queue.test.ts` - Rewrite tests for the new fs.watch-based watcher. Add test: abort signal causes clean exit with `queue:complete` as final event. Add test: writing a new PRD file into the queue directory triggers `queue:prd:discovered` event. Remove tests that relied on poll-based events (already removed in Plan 01, but verify no stale references remain).

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes - all existing and new tests pass
- [ ] `pnpm build` produces a clean build with no errors
- [ ] `watchQueue()` uses `fs.watch` (from `node:fs`) on the queue directory, NOT `abortableSleep` or a poll loop
- [ ] `fs.watch` callback is debounced with a ~500ms timer
- [ ] `fs.watch` is registered as an `AsyncEventQueue` producer and removed on abort
- [ ] Abort signal closes the `fs.watch` watcher and the consumer loop drains in-flight builds before yielding `queue:complete`
- [ ] `discoverNewPrds()` + `startReadyPrds()` are called both on fs.watch events AND on `queue:prd:complete`
- [ ] Daemon spawn command in `server-main.ts` includes `--watch` flag: `['run', '--queue', '--watch', '--auto', '--no-monitor']`
- [ ] Daemon does NOT respawn the watcher on clean exit (code 0) - the `setTimeout` respawn block is removed
- [ ] Daemon still respawns on non-zero exit (crash recovery) and pauses autoBuild
