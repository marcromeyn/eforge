---
id: plan-01-feature-branch-fallback
name: Feature Branch Fallback for Monitor Diffs
depends_on: []
branch: fix-commit-not-found-in-monitor-changes-tab/feature-branch-fallback
---

# Feature Branch Fallback for Monitor Diffs

## Architecture Context

The monitor's Changes tab shows file diffs by resolving either a commit SHA (from `merge:complete` events) or a plan branch (from `orchestration.yaml`). For in-progress sequential builds (concurrency=1), neither exists - there's no `merge:complete` event yet, and the plan branch listed in `orchestration.yaml` is never created because the orchestrator builds directly on the merge worktree's feature branch (`eforge/{planSetName}`). This leaves a gap where clicking files shows "Commit not found".

The fix adds a third fallback tier: resolve the feature branch (`eforge/{name}` from orchestration.yaml's `name` field) and diff against `base_branch`.

## Implementation

### Overview

Add a `resolveFeatureBranch()` helper to `src/monitor/server.ts` and update `serveDiff()`'s fallback chain to verify plan branch existence in git before using it, falling back to the feature branch when the plan branch doesn't exist.

### Key Decisions

1. **Verify plan branch exists in git before using it** - `resolvePlanBranch()` reads from `orchestration.yaml` but doesn't check if the branch actually exists in git. Adding a `git rev-parse --verify` check prevents attempting diffs against non-existent branches.
2. **Feature branch convention is `eforge/{name}`** - The orchestrator creates branches following this pattern from `orchestration.yaml`'s `name` field. This is the branch that actually has the in-progress changes.
3. **Reuse existing `candidateOrchestrationPaths()` and `parseYaml()`** - The new helper follows the same pattern as `resolvePlanBranch()` for reading orchestration.yaml, avoiding code duplication.

## Scope

### In Scope
- Add `resolveFeatureBranch()` helper in `src/monitor/server.ts`
- Update `serveDiff()` fallback chain to verify plan branch and fall back to feature branch

### Out of Scope
- Engine worktree management changes (separate refactor in progress)
- Monitor UI changes (no frontend changes needed)
- Changes to `resolvePlanBranch()` itself (it still returns the plan branch from orchestration.yaml; the caller now verifies it)

## Files

### Modify
- `src/monitor/server.ts` - Add `resolveFeatureBranch()` helper (~15 lines, placed between `resolvePlanBranch` and `resolveCwd`). Update `serveDiff()` to verify plan branch exists via `git rev-parse --verify` and fall back to `resolveFeatureBranch()` when it doesn't.

## Verification

- [ ] `pnpm build` completes with exit code 0
- [ ] `pnpm test` passes with no new failures
- [ ] `pnpm type-check` passes with no type errors
- [ ] `resolveFeatureBranch()` reads `name` and `base_branch` from orchestration.yaml and returns `{ branch: "eforge/{name}", baseBranch }` when the branch exists in git
- [ ] `resolveFeatureBranch()` returns `null` when orchestration.yaml is missing or the branch doesn't exist in git
- [ ] `serveDiff()` falls through from plan branch to feature branch when `git rev-parse --verify` fails for the plan branch
- [ ] Completed builds still resolve diffs via the `commitSha` path (no regression)
