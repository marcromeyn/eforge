---
id: plan-01-fix-merge-and-cleanup
name: Fix merge commit scope and move cleanup to feature branch
depends_on: []
branch: fix-merge-commit-message-scope-and-cleanup-commit-location/fix-merge-and-cleanup
---

# Fix merge commit scope and move cleanup to feature branch

## Architecture Context

The orchestrator's `finalize()` phase in `src/engine/orchestrator/phases.ts` builds the `--no-ff` merge commit message and calls `worktreeManager.mergeToBase()`. Currently, single-plan builds use `config.plans[0].id` for the commit scope instead of `config.name` (the set-level identifier), creating inconsistency with multi-plan builds.

Separately, `cleanupPlanFiles()` is called in `src/engine/eforge.ts` after the orchestrator finishes - meaning the cleanup commit lands on the base branch after the merge commit. It needs to run on the feature branch before the `--no-ff` merge so the merge commit is the sole entry point on the base branch.

## Implementation

### Overview

Two changes in a single plan since they both affect the finalize flow:

1. Change the merge commit message for single-plan builds to use `config.name` instead of `config.plans[0].id` for the scope.
2. Move `cleanupPlanFiles()` execution into `finalize()` in `phases.ts`, running it on the feature branch before the `--no-ff` merge. Remove the post-orchestrator cleanup call in `eforge.ts`.

### Key Decisions

1. **Pass cleanup config through `PhaseContext`** - Add `cleanupPlanSet`, `cleanupOutputDir`, `cleanupPrdFilePath`, and `shouldCleanup` fields to `PhaseContext`. The orchestrator in `orchestrator.ts` sets these from the options it receives. This avoids changing the `Orchestrator` constructor signature beyond adding the new fields to `OrchestratorOptions`.
2. **Checkout feature branch, cleanup, checkout base, merge** - Inside `finalize()`, before the merge, checkout the feature branch, run the cleanup commit, then checkout base branch and proceed with `mergeToBase()`. This keeps the cleanup inside the feature branch history.
3. **Extract `cleanupPlanFiles()` to a shared module** - Move the existing function from `eforge.ts` to `src/engine/cleanup.ts` (or similar) so that both `eforge.ts` and `phases.ts` can import it without circular dependencies. Direct import from `eforge.ts` into `phases.ts` is not possible because `eforge.ts` → `orchestrator.ts` → `phases.ts` would form a cycle. The function's dependencies (`forgeCommit`, `retryOnLock` from `git.ts`, `exec`, `readdir`, `rm`) are all available without importing from `eforge.ts`. Call the extracted function from `finalize()` with the repo root as the cwd.
4. **Keep `config.plans[0].name` for the description** - Only the scope (parenthetical) changes to `config.name`; the human-readable description stays as the plan name.

## Scope

### In Scope
- Fix merge commit scope from `config.plans[0].id` to `config.name` for single-plan builds (line 523 in `phases.ts`)
- Add cleanup-related fields to `PhaseContext` interface
- Add cleanup-related fields to `OrchestratorOptions` interface
- Pass cleanup config from `eforge.ts` through the orchestrator to `PhaseContext`
- Execute cleanup on the feature branch inside `finalize()` before the `--no-ff` merge
- Extract `cleanupPlanFiles()` from `eforge.ts` into `src/engine/cleanup.ts` to avoid circular imports
- Remove the post-orchestrator `cleanupPlanFiles()` call in `eforge.ts` (lines 703-706)

### Out of Scope
- Multi-plan merge commit message (already uses `config.name`)
- Changes to `cleanupPlanFiles()` logic itself
- Changes to the `--no-ff` merge strategy
- Changes to worktree-ops.ts merge implementation

## Files

### Modify
- `src/engine/orchestrator/phases.ts` - Fix merge commit scope on line 523: change `config.plans[0].id` to `config.name`. Add cleanup logic before the merge in `finalize()`: checkout feature branch, call `cleanupPlanFiles()`, checkout base branch, then merge. Add `shouldCleanup`, `cleanupPlanSet`, `cleanupOutputDir`, `cleanupPrdFilePath` to `PhaseContext`.
- `src/engine/orchestrator.ts` - Add `shouldCleanup`, `cleanupPlanSet`, `cleanupOutputDir`, `cleanupPrdFilePath` to `OrchestratorOptions`. Pass these through to `PhaseContext` when constructing `ctx`.
- `src/engine/cleanup.ts` - **New file.** Extract `cleanupPlanFiles()` from `eforge.ts` into this shared module to avoid circular imports (`eforge.ts` → `orchestrator.ts` → `phases.ts` → `eforge.ts`).
- `src/engine/eforge.ts` - Import `cleanupPlanFiles` from `cleanup.ts` instead of defining it locally. Remove the post-orchestrator cleanup call (lines 703-706). Pass cleanup config (`shouldCleanup`, `planSet`, `outputDir`, `prdFilePath`) to the orchestrator options.

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes with zero failures
- [ ] `pnpm build` succeeds
- [ ] In `finalize()`, single-plan merge commit message uses `config.name` for the scope (not `config.plans[0].id`)
- [ ] In `finalize()`, when `shouldCleanup` is true, the function checks out the feature branch, runs `cleanupPlanFiles()`, checks out the base branch, then calls `mergeToBase()` - in that order
- [ ] The post-orchestrator `cleanupPlanFiles()` call in `eforge.ts` `build()` method is removed
- [ ] `cleanupPlanFiles()` is extracted to `src/engine/cleanup.ts` and imported by both `eforge.ts` and `phases.ts`
- [ ] `PhaseContext` includes `shouldCleanup`, `cleanupPlanSet`, `cleanupOutputDir`, and `cleanupPrdFilePath` fields
- [ ] `OrchestratorOptions` includes `shouldCleanup`, `cleanupPlanSet`, `cleanupOutputDir`, and `cleanupPrdFilePath` fields
