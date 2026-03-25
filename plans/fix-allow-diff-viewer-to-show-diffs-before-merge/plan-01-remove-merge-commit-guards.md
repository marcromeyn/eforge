---
id: plan-01-remove-merge-commit-guards
name: Remove mergeCommits guards from DiffViewer
depends_on: []
branch: fix-allow-diff-viewer-to-show-diffs-before-merge/remove-merge-commit-guards
---

# Remove mergeCommits guards from DiffViewer

## Architecture Context

The monitor's diff viewer has a client-side guard that checks `mergeCommits[planId]` before calling `fetchFileDiff()`. The server already supports a branch-based fallback (`git diff baseBranch..planBranch`) added in commit `5e0f67c`, so the guard is unnecessary and prevents diffs from rendering during the build phase.

## Implementation

### Overview

Remove the `mergeCommits` prop and all related guards from `DiffViewer`, and stop passing it from `FileHeatmap`. The server handles commit resolution via its branch-based fallback — the client does not need to gate on merge commit availability.

### Key Decisions

1. Remove the entire `mergeCommits` prop rather than making it optional — the server handles all resolution logic, so the client has no use for this data in this component.
2. Use `planIds ?? []` directly instead of filtering by merge commit existence, preserving the existing pattern for the multi-plan view.

## Scope

### In Scope
- Remove `mergeCommits` from `DiffViewerProps` interface
- Remove `mergeCommitsKey` memo and its usage in the effect dependency array
- Remove the early-exit guard on lines 62-66 that returns "Commit not found" when `mergeCommits[planId]` is falsy
- Remove the `.filter((id) => mergeCommits[id])` on line 75
- Remove the `mergeCommits={runState.mergeCommits}` prop from the `DiffViewer` usage in `file-heatmap.tsx`

### Out of Scope
- Server-side diff resolution changes
- Any other monitor UI changes

## Files

### Modify
- `src/monitor/ui/src/components/heatmap/diff-viewer.tsx` — Remove `mergeCommits` from props interface, remove `mergeCommitsKey` memo, remove early-exit guard (lines 62-66), replace filtered `relevantPlanIds` with `planIds ?? []`, remove `mergeCommitsKey` from effect dependency array
- `src/monitor/ui/src/components/heatmap/file-heatmap.tsx` — Remove `mergeCommits={runState.mergeCommits}` prop from `<DiffViewer>` usage (line 164)

## Verification

- [ ] `pnpm build` completes with zero type errors
- [ ] `DiffViewerProps` interface has no `mergeCommits` field
- [ ] No references to `mergeCommits` remain in `diff-viewer.tsx`
- [ ] No references to `mergeCommitsKey` remain in `diff-viewer.tsx`
- [ ] `file-heatmap.tsx` does not pass `mergeCommits` to `<DiffViewer>`
- [ ] The `fetchFileDiff()` call is reached for both single-plan and multi-plan views without any merge commit precondition
