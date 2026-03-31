---
id: plan-01-fix-prd-cleanup-path
name: Fix PRD cleanup path resolution
depends_on: []
branch: fix-prd-queue-files-not-deleted-in-cleanup-commit/fix-prd-cleanup-path
---

# Fix PRD cleanup path resolution

## Architecture Context

The cleanup phase runs in a merge worktree (a sibling directory to the main repo). `cleanupPrdFilePath` is currently passed as an absolute path pointing into the main repo's filesystem, so `git rm` in the worktree silently fails because the path is outside the worktree. The `-f` flag and catch blocks swallow the error, and the fallback `rm()` deletes the file from the main repo but never stages the deletion in the worktree.

Plan file cleanup (`cleanupOutputDir`) works because it uses a relative path that resolves within any worktree.

## Implementation

### Overview

Convert `cleanupPrdFilePath` from absolute to repo-relative before passing it to the orchestrator, and harden the `dirname()` call in cleanup.ts to resolve against the working directory.

### Key Decisions

1. Convert path at the point of assignment in `eforge.ts` line 672 using `relative(cwd, path)` - this produces `eforge/queue/fix-xxx.md` which resolves in any worktree of the same repo.
2. Resolve `dirname(prdFilePath)` against `cwd` in `cleanup.ts` so the empty-directory check operates in the correct working tree rather than relative to the process's cwd.

## Scope

### In Scope
- Adding `relative` to the `node:path` import in `src/engine/eforge.ts`
- Converting `cleanupPrdFilePath` from absolute to repo-relative at line 672
- Resolving `dirname()` result against `cwd` in `src/engine/cleanup.ts` line 51

### Out of Scope
- Changes to `prd-queue.ts` or how `prd.filePath` is originally resolved
- Changes to other `prdFilePath` consumers (lines 612, 868, 888) which operate correctly with the existing absolute path
- Changes to plan file cleanup, which already works

## Files

### Modify
- `src/engine/eforge.ts` - Add `relative` to `node:path` import; wrap `options.prdFilePath` with `relative(cwd, ...)` at line 672
- `src/engine/cleanup.ts` - Resolve `dirname(prdFilePath)` against `cwd` so empty-directory removal targets the worktree

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm build` completes with exit code 0
- [ ] `pnpm test` passes all existing tests
- [ ] `cleanupPrdFilePath` value is a relative path (e.g., `eforge/queue/fix-xxx.md`) not an absolute path
- [ ] `dirname()` result in cleanup.ts resolves against `cwd` parameter, not process cwd
