---
id: plan-01-engine-events
name: Add build:files_changed event type and builder emission logic
depends_on: []
branch: monitor-dashboard-prd/engine-events
---

# Engine Events: `build:files_changed`

## Architecture Reference

This module implements [Shared Data Model → Event Types] and [Integration Contracts → engine-events → file-heatmap] from the architecture.

Key constraints from architecture:
- The new event flows through the standard pipeline: engine emits → recorder persists → SSE pushes → React reducer updates
- Engine purity preserved — no UI concerns, just event emission
- Files list derived from `git diff --name-only` (reliable, tool-agnostic)
- Event emitted after `build:implement:complete`, before review

## Scope

### In Scope
- Add `build:files_changed` to the `EforgeEvent` discriminated union in `events.ts`
- Emit the event from the builder agent runner after implementation completes
- Derive the file list via `git diff --name-only` against the base branch in the worktree
- Pass the base branch through to the builder emission site
- Update existing tests to account for the new event type

### Out of Scope
- Monitor DB schema changes (recorder already stores full event JSON — no changes needed)
- SSE transport changes (new event type flows through existing SSE infrastructure)
- UI rendering of file changes (belongs to `file-heatmap` module)
- Any changes to the `AgentBackend` interface

## Implementation Approach

### Overview

This is a small, surgical change: define a new event type, then emit it at the right point in the build pipeline. The key design question is how to get the base branch into the builder's context so `git diff --name-only` can compare against it.

The builder agent runner (`builderImplement`) operates in a worktree that was branched from `baseBranch`. The `git diff` needs to compare against `baseBranch` (or more precisely, the merge-base) to capture all files changed by the implementation. The cleanest approach is to:

1. Run `git diff --name-only <baseBranch>...HEAD` in the worktree after `build:implement:complete`
2. Emit the event from the `planRunner` closure in `eforge.ts` (not inside `builderImplement` itself), since the plan runner already has access to `orchConfig.baseBranch` and `worktreePath`

This keeps the builder agent pure (no awareness of orchestration context) and places the emission at the natural seam between implementation and review.

### Key Decisions

1. **Emit from `planRunner` in `eforge.ts`, not from `builderImplement`** — The builder agent shouldn't need to know about base branches or orchestration. The plan runner closure already has `orchConfig.baseBranch` and `worktreePath`, making it the natural emission point. The event is yielded immediately after iterating `builderImplement` events and confirming no failure.

2. **Use `git diff --name-only <baseBranch>...HEAD`** — The triple-dot syntax finds the merge-base automatically, giving us exactly the files changed by the implementation branch. This works correctly in worktrees and handles cases where `baseBranch` has advanced (inter-wave merges).

3. **Graceful degradation on git failure** — If the `git diff` command fails (e.g., corrupted worktree), skip the event silently rather than failing the build. The heatmap is a visualization aid, not a critical path.

## Files

### Modify
- `src/engine/events.ts` — Add `build:files_changed` variant to the `EforgeEvent` discriminated union:
  ```typescript
  | { type: 'build:files_changed'; planId: string; files: string[] }
  ```
  Place it after `build:implement:complete` in the union ordering for logical grouping.

- `src/engine/eforge.ts` — In the `planRunner` closure inside `build()`, after the `builderImplement` loop completes successfully (no `implFailed`), add a `git diff --name-only` call and yield the `build:files_changed` event before proceeding to the review cycle. Pseudocode:
  ```typescript
  // After builderImplement loop, before review cycle:
  try {
    const { stdout } = await exec('git', ['diff', '--name-only', `${orchConfig.baseBranch}...HEAD`], { cwd: worktreePath });
    const files = stdout.trim().split('\n').filter(Boolean);
    if (files.length > 0) {
      yield { type: 'build:files_changed', planId, files };
    }
  } catch {
    // Non-critical — skip silently
  }
  ```

- `test/agent-wiring.test.ts` — If any existing builder wiring tests collect all events and assert on exact event sequences, update them to account for the new event NOT being emitted (since `builderImplement` itself doesn't emit it — it's emitted by the plan runner, which isn't tested here). Verify no test breakage.

### Create
- `test/files-changed-event.test.ts` — Unit tests for the `build:files_changed` event integration:
  - Test that the event type is part of the `EforgeEvent` union (type-level test via assignment)
  - Test the git diff → event emission logic in isolation (extract the diff+emit logic into a small helper function if needed, or test indirectly through the plan runner)

## Testing Strategy

### Unit Tests
- **Type correctness**: Verify `build:files_changed` is assignable to `EforgeEvent` (compile-time check via a test file that constructs the event)
- **Event construction**: Verify the event shape matches the expected structure (`planId`, `files` array)
- **Empty file list**: Verify no event is emitted when `git diff` returns empty output
- **Git failure**: Verify graceful degradation — no event emitted, no error thrown

### Integration Tests
- Existing `pnpm test` and `pnpm type-check` must pass with the new event type added
- The `agent-wiring.test.ts` tests for `builderImplement` should be unaffected since the event is emitted outside the builder agent

## Verification

- [ ] `pnpm type-check` passes with the new `build:files_changed` event in the union
- [ ] `pnpm test` passes — no existing tests broken
- [ ] The `EforgeEvent` union includes `{ type: 'build:files_changed'; planId: string; files: string[] }`
- [ ] The event is emitted in the `planRunner` closure after successful implementation, before review
- [ ] `git diff --name-only` failure does not cause the build to fail
- [ ] No event is emitted when the file list is empty
