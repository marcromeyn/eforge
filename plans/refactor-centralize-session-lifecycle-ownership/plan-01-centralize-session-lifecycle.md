---
id: plan-01-centralize-session-lifecycle
name: Centralize Session Lifecycle Ownership
depends_on: []
branch: refactor-centralize-session-lifecycle-ownership/centralize-session-lifecycle
---

# Centralize Session Lifecycle Ownership

## Architecture Context

Session lifecycle (`session:start`/`session:end`) is currently split across three layers: the `withSessionId` middleware in `session.ts`, CLI orchestration in `cli/index.ts`, and engine queue mode in `eforge.ts`. The middleware has `emitSessionStart`/`emitSessionEnd` flags that the CLI coordinates per-phase, but when `process.exit()` fires between compile and build (scope-complete at line 346, compile failure at line 350), the build phase's `withSessionId` wrapper never runs - so `session:end` is never emitted. This leaves orphaned sessions in the monitor.

The fix is a single-wrapper model: one `runSession` call wraps all phases of `eforge run`, and early exits become generator returns instead of `process.exit()` calls. The wrapper's `finally` block guarantees `session:end`.

## Implementation

### Overview

Add a `runSession` async generator helper to `session.ts` that always emits `session:start` before the first event and `session:end` in its finally block. Simplify `withSessionId` to pure sessionId-stamping only (remove `emitSessionStart`/`emitSessionEnd` flags). Refactor the CLI `run` command to yield all phases from a single async generator wrapped once by `runSession`, replacing mid-phase `process.exit()` calls with generator returns.

### Key Decisions

1. **`runSession` as a separate function from `withSessionId`** - `runSession` owns the session envelope (start/end events). `withSessionId` remains as a simpler stamping-only utility for queue mode where the engine already yields its own envelope events. This keeps queue mode in `eforge.ts` unchanged.

2. **Generator returns instead of `process.exit()` between phases** - The `allPhases` generator pattern lets each early exit (scope-complete, compile failure, dry-run) simply `return`, causing the `runSession` finally block to fire. The single `process.exit()` at the end of the event consumption loop handles the exit code based on tracked state.

3. **`scopeComplete` / `plan:scope` early-exit** - The `plan:scope` event with `assessment === 'complete'` currently triggers `process.exit(0)` at line 346. In the new model, the `allPhases` generator returns early when scope is complete. The consumer tracks scope-complete state and uses it for the exit code. The `plan:scope` event type and planner behavior are unchanged - only the CLI's reaction to it changes.

4. **Session result derivation** - `runSession`'s finally block derives the session result from the last `phase:end` event it saw. If no `phase:end` was emitted (e.g., enqueue-only failure), it falls back to `{ status: 'failed', summary: 'Session terminated abnormally' }` - same as the current `withSessionId` behavior.

## Scope

### In Scope
- New `runSession` helper in `session.ts` that guarantees `session:start`/`session:end` envelope
- Simplify `withSessionId` to pure sessionId-stamping (remove `emitSessionStart`/`emitSessionEnd` from `SessionOptions`)
- Refactor CLI `eforge run` to use single `allPhases` generator wrapped by `runSession`
- Remove `process.exit()` calls between phase boundaries in the run command (lines 346, 350)
- Simplify queue-mode CLI paths (`eforge run --queue`, `eforge queue run`) to use stamping-only `withSessionId`
- Update `wrapEvents` helper to use the new API (no more `emitSessionStart`/`emitSessionEnd` in `SessionOptions`)
- Export `runSession` from `src/engine/index.ts`
- Update existing `session.test.ts` tests for the simplified API
- Add composition tests for `runSession` covering early-exit scenarios

### Out of Scope
- Changes to queue mode session handling in `eforge.ts` (already emits session:start/end directly)
- Changes to `withHooks` or `withRecording` middleware
- Changes to the monitor or recorder
- Changes to `plan:scope` event type definition or planner behavior
- Adding a `plan:skip` event type (not needed - generator returns handle early exits)

## Files

### Modify
- `src/engine/session.ts` - Add `runSession()` async generator. Simplify `withSessionId` to remove `emitSessionStart`/`emitSessionEnd` flags from `SessionOptions`. `withSessionId` becomes a pure sessionId-stamping passthrough (accepts events + optional sessionId, stamps every event, no envelope events). `runSession` accepts events + sessionId, emits `session:start` before first event, stamps all events, emits `session:end` in finally block.
- `src/cli/index.ts` - Refactor the `run` command's normal mode (non-queue) to use an `allPhases` async generator that yields enqueue, compile, and build events sequentially, wrapped once by `runSession`. Remove `process.exit(0)` at line 346 (scope-complete) and `process.exit(1)` at line 350 (compile failure) - replace with early generator returns. The consumer loop tracks `planSetName`, `planFiles`, `scopeComplete`, `planResult`, and `enqueuedFilePath` from events, then calls `process.exit()` once after the loop. Update `wrapEvents` to use simplified `SessionOptions` (no `emitSessionStart`/`emitSessionEnd`). For queue mode paths, pass `withSessionId` with just `{ sessionId }` or no options (stamping-only). Import `runSession` from engine. Simplify the enqueue command's session options similarly.
- `src/engine/index.ts` - Add `runSession` to the session exports.
- `test/session.test.ts` - Remove tests that exercise `emitSessionStart`/`emitSessionEnd` flags (tests 3, 4, 6, 7). Update remaining tests for the simplified `withSessionId` API. Add new `describe('runSession')` block with tests for: compile failure -> `session:end` with failed result; scope-complete early return -> `session:end` with completed result; build error -> `session:end` with failed result; normal three-phase completion -> `session:end` with completed result; upstream throw -> `session:end` with failed result.

## Verification

- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` exits with code 0 (all tests pass)
- [ ] `pnpm build` exits with code 0
- [ ] Zero references to `emitSessionStart` or `emitSessionEnd` remain in `src/` and `test/` directories (search: `grep -r 'emitSessionStart\|emitSessionEnd' src/ test/` returns no results)
- [ ] Zero `process.exit()` calls between phase boundaries in the `run` command action handler (the only `process.exit()` is after the event consumption loop completes)
- [ ] New test: async generator that yields `phase:start` then `phase:end` with `status: 'failed'` (simulating compile failure) wrapped by `runSession` -> output contains `session:end` with `result.status === 'failed'`
- [ ] New test: async generator that yields `plan:scope` with `assessment: 'complete'` then returns early wrapped by `runSession` -> output contains `session:end` with `result.status === 'completed'`
- [ ] New test: async generator that yields compile `phase:end` (completed) then build `phase:end` with `status: 'failed'` wrapped by `runSession` -> output contains `session:end` with `result.status === 'failed'`
- [ ] New test: async generator that yields enqueue, compile, and build events all completing successfully wrapped by `runSession` -> output contains exactly one `session:start` and one `session:end`, both with same `sessionId`
- [ ] Existing `withSessionId` tests updated: stamping-only behavior verified (events get sessionId stamped, no `session:start`/`session:end` emitted)
- [ ] Queue mode passthrough test still passes (engine-emitted `session:start`/`session:end` flow through `withSessionId` unchanged)
