---
id: plan-01-remove-status-field
name: Remove PRD status field and add file-location state helpers
dependsOn: []
branch: fix-prd-files-not-removed-after-build/remove-status-field
---

# Remove PRD status field and add file-location state helpers

## Architecture Context

PRD status is currently tracked by mutating a `status` field in the PRD file's YAML frontmatter. This creates uncommitted dirty working tree state that blocks `git merge --no-ff` when merging feature branches back to main after build. The fix replaces mutable frontmatter status with a file-location-based state model: presence in `eforge/queue/` means pending, lock file means running, `eforge/queue/failed/` means failed, `eforge/queue/skipped/` means skipped, and deletion means completed.

All status-related types, constants, and functions must be removed in the same plan as the callers that reference them, because this is a type cascade - removing `PrdStatus` breaks all consumers.

## Implementation

### Overview

Remove `PRD_STATUSES`, `PrdStatus`, `updatePrdStatus()` from `prd-queue.ts`. Add `movePrdToSubdir()` helper for failed/skipped states. Update `enqueuePrd()` to stop writing `status: pending`. Update `resolveQueueOrder()` to treat all PRDs in queue dir as pending. Remove all `updatePrdStatus()` calls from `eforge.ts` and replace with `movePrdToSubdir()` where appropriate. Update CLI display, monitor server, monitor UI, exports, and tests.

### Key Decisions

1. **File location as state** - A PRD in `eforge/queue/` is pending by definition. No status field needed. The lock file mechanism (`claimPrd`/`releasePrd`) already prevents double-processing, so `status: running` was redundant.
2. **`movePrdToSubdir()` uses `git mv` + commit** - Failed/skipped PRDs are moved to subdirectories via committed `git mv`, keeping the working tree clean.
3. **`cleanupCompletedPrd()` stays** - It already handles deletion via `git rm` + commit. Its JSDoc reference to `updatePrdStatus` fallback gets removed.
4. **Monitor server derives status from file location** - `serveQueue()` scans `eforge/queue/`, `eforge/queue/failed/`, and `eforge/queue/skipped/` to determine status. Lock files determine running vs pending.

## Scope

### In Scope
- Remove `PRD_STATUSES` const, `PrdStatus` type, `updatePrdStatus()` function from `prd-queue.ts`
- Remove `status` from `prdFrontmatterSchema`
- Add `movePrdToSubdir(filePath, subdir, cwd)` helper
- Add `isPrdRunning(prdId, cwd)` helper
- Update `resolveQueueOrder()` to remove status filter
- Update `enqueuePrd()` to stop writing `status: pending`
- Remove all `updatePrdStatus()` calls from `eforge.ts`, replace with `movePrdToSubdir()` for failed/skipped
- Update `src/engine/index.ts` exports
- Update `src/cli/display.ts` `renderQueueList()` to use location-based grouping
- Update `src/cli/index.ts` queue list action to load from subdirectories
- Update `src/monitor/server.ts` `serveQueue()` to scan subdirectories and check lock files
- Update `src/monitor/ui/src/lib/types.ts` QueueItem (status field stays but is now derived)
- Update `src/monitor/ui/src/components/layout/queue-section.tsx` (no status-based filtering needed since server derives it)
- Update `test/prd-queue.test.ts` - remove `updatePrdStatus` tests, update status assertions in validation/ordering tests
- Update `test/prd-queue-enqueue.test.ts` - remove `status: pending` assertions
- Update `test/greedy-queue-scheduler.test.ts` - remove status field from test PRD construction

### Out of Scope
- Changes to `src/engine/events.ts` (event result status field is unrelated to file state)
- Changes to lock file mechanism (`claimPrd`/`releasePrd`)
- Merging orphaned feature branches (manual post-deploy task)

## Files

### Modify
- `src/engine/prd-queue.ts` - Remove `PRD_STATUSES`, `PrdStatus`, `updatePrdStatus()`, remove `status` from schema. Add `movePrdToSubdir()` and `isPrdRunning()`. Update `resolveQueueOrder()` to remove status filter. Update `enqueuePrd()` to remove `status: pending`. Update `cleanupCompletedPrd()` JSDoc.
- `src/engine/eforge.ts` - Remove `updatePrdStatus` import. Line 779: replace `updatePrdStatus(prd.filePath, 'skipped')` with `movePrdToSubdir(prd.filePath, 'skipped', cwd)`. Line 819: delete `updatePrdStatus(prd.filePath, 'running')`. Line 888: replace `updatePrdStatus(prd.filePath, prdResult.status)` with conditional: `failed` -> `movePrdToSubdir(prd.filePath, 'failed', cwd)`, `skipped` -> `movePrdToSubdir(prd.filePath, 'skipped', cwd)`, `completed` -> no-op.
- `src/engine/index.ts` - Remove `PrdStatus` from type exports. Add `movePrdToSubdir`, `isPrdRunning` to exports. Keep `cleanupCompletedPrd` export.
- `src/cli/display.ts` - Update `renderQueueList()` signature to accept `{ pending, failed, skipped, running }` groups or derive grouping from a `location` field instead of `frontmatter.status`. Since PRDs in different dirs are loaded separately, accept multiple arrays.
- `src/cli/index.ts` - Update queue list action to load PRDs from `eforge/queue/`, `eforge/queue/failed/`, `eforge/queue/skipped/` and check lock files for running state.
- `src/monitor/server.ts` - Update `serveQueue()` to scan subdirectories (`failed/`, `skipped/`) and check lock files in `.eforge/queue-locks/` to derive status.
- `src/monitor/ui/src/lib/types.ts` - No change needed. `QueueItem.status` remains a string - the server now derives it from location.
- `src/monitor/ui/src/components/layout/queue-section.tsx` - No change needed. It already consumes `status` from the API response.
- `test/prd-queue.test.ts` - Remove `updatePrdStatus` import and describe block. Remove `status` field from `makeQueuedPrd` test helpers. Update `validatePrdFrontmatter` tests: remove test for invalid status, remove test for valid status values, update test that uses `status: 'pending'`. Update `resolveQueueOrder` tests: remove status fields from test PRD construction (all PRDs in queue are pending by definition), remove "filters to only pending PRDs" test, remove "returns empty when no pending PRDs" test, remove "treats PRDs without status as pending" test. Add test for `movePrdToSubdir`.
- `test/prd-queue-enqueue.test.ts` - Remove `status: pending` assertion from "writes a PRD file with correct frontmatter" test. Remove `expect(content).toContain('status: pending')` assertion.
- `test/greedy-queue-scheduler.test.ts` - Remove `status: 'pending'` and `status: 'completed'` from `makeQueuedPrd` calls in frontmatter. Update the "completed dependency" test case to not rely on status field for filtering.

## Verification

- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` exits with code 0
- [ ] No occurrence of `PRD_STATUSES`, `PrdStatus`, or `updatePrdStatus` in `src/` directory (verified via grep)
- [ ] No occurrence of `status: pending` in `enqueuePrd` output files
- [ ] `prdFrontmatterSchema` does not include a `status` field
- [ ] `movePrdToSubdir()` function exists in `prd-queue.ts` and performs `git mv` + `forgeCommit()`
- [ ] `isPrdRunning()` function exists in `prd-queue.ts` and checks `.eforge/queue-locks/<id>.lock`
- [ ] `eforge.ts` contains zero calls to `updatePrdStatus`
- [ ] `src/engine/index.ts` does not export `PrdStatus` type
- [ ] `src/monitor/server.ts` `serveQueue()` reads from `failed/` and `skipped/` subdirectories
