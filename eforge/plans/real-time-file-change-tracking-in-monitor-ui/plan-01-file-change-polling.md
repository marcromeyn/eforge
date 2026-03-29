---
id: plan-01-file-change-polling
name: Add throttled file change polling to build stages
depends_on: []
branch: real-time-file-change-tracking-in-monitor-ui/file-change-polling
---

# Add throttled file change polling to build stages

## Architecture Context

Build stages emit `build:files_changed` events only at stage completion via `emitFilesChanged()`. The monitor UI already handles these events via SSE and re-renders the FileHeatmap. This plan adds periodic polling during long-running agent loops so the UI updates in real time, not just at stage boundaries.

The change is self-contained in `pipeline.ts`. No new event types, no UI changes, no new dependencies.

## Implementation

### Overview

Add a `withFileChangePolling()` async generator wrapper that intercepts `agent:tool_result` events from an inner generator and periodically calls `emitFilesChanged()` with a 5-second throttle. Apply it to the 5 build stages that run coding agents (implement, review-fix, doc-update, test-write, test).

### Key Decisions

1. **Trigger on `agent:tool_result` rather than polling on a timer** - tool results indicate a tool just completed (likely a file write). This avoids spawning background timers or intervals, keeping the async generator pattern pure.
2. **5-second throttle interval** - balances UI responsiveness against git diff overhead. Each poll runs `git diff --name-only` which is fast but not free.
3. **Wrapper pattern rather than inline logic** - a single `withFileChangePolling()` function avoids duplicating the throttle logic in 5 stage implementations.
4. **Preserve existing end-of-stage `emitFilesChanged()` calls** - the wrapper handles mid-stage polling; the existing calls serve as a final flush to capture any changes made after the last tool result.

## Scope

### In Scope
- New `withFileChangePolling()` async generator wrapper in `pipeline.ts`
- Wrapping agent event iterators in 5 stages: implement, review-fix, doc-update, test-write, test
- 5-second throttle on `agent:tool_result` events

### Out of Scope
- Frontend/UI changes (existing SSE + reducer handles `build:files_changed` already)
- File watchers, background pollers, or new dependencies
- Changes to `review` or `evaluate` stages (read-only, no file modifications)
- New event types or schema changes

## Files

### Modify
- `src/engine/pipeline.ts` - Add `withFileChangePolling()` helper (~15 lines near `emitFilesChanged`). Wrap the `for await` loops in 5 stages:
  - `implement` stage (~line 995): wrap `builderImplement(...)` call
  - `reviewFixStageInner` (~line 1149): wrap `runReviewFixer(...)` call
  - `doc-update` stage (~line 1248): wrap `runDocUpdater(...)` call
  - `test-write` stage (~line 1294): wrap `runTestWriter(...)` call
  - `testStageInner` (~line 1330): wrap `runTester(...)` call

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes all existing tests
- [ ] `pnpm build` completes with exit code 0
- [ ] `withFileChangePolling()` yields all events from the inner generator unchanged
- [ ] `withFileChangePolling()` calls `emitFilesChanged()` after `agent:tool_result` events when >= 5000ms have elapsed since the last check
- [ ] `withFileChangePolling()` does NOT call `emitFilesChanged()` when < 5000ms have elapsed since the last check
- [ ] All 5 wrapped stages (`implement`, `review-fix`, `doc-update`, `test-write`, `test`) pass their agent iterator through `withFileChangePolling()`
- [ ] Existing `yield* emitFilesChanged(ctx)` calls at end of each stage remain intact
