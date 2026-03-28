---
id: plan-01-relocate-lock-files
name: Relocate PRD Queue Lock Files to .eforge/queue-locks/
depends_on: []
branch: move-prd-queue-lock-files-to-eforge/relocate-lock-files
---

# Relocate PRD Queue Lock Files to .eforge/queue-locks/

## Architecture Context

PRD lock files (`{prd}.md.lock`) are currently created alongside PRD files in `docs/prd-queue/`, which pollutes `git status` with untracked files. The `.eforge/` directory is already gitignored and houses other transient runtime state (`state.json`, `monitor.db`, `daemon.lock`). Moving lock files there eliminates the git noise without any gitignore changes.

## Implementation

### Overview

Change `claimPrd` and `releasePrd` signatures from `(filePath: string)` to `(prdId: string, cwd: string)`. Lock paths are derived as `.eforge/queue-locks/{prdId}.lock` relative to `cwd`. `claimPrd` ensures the directory exists before creating the lock. All call sites in `eforge.ts` are updated to pass `(prd.id, cwd)`. Tests are updated to use the new signature and assert lock files at the new location.

### Key Decisions

1. Lock path is `resolve(cwd, '.eforge', 'queue-locks', `${prdId}.lock`)` - colocated with other `.eforge/` runtime state, no gitignore changes needed.
2. `claimPrd` calls `mkdir(lockDir, { recursive: true })` before attempting `O_CREAT | O_EXCL` - the directory must exist for atomic file creation.
3. All existing lock semantics (atomic creation, stale PID detection, non-throwing release) are preserved unchanged.

## Scope

### In Scope
- Updating `claimPrd` and `releasePrd` signatures and lock path derivation in `src/engine/prd-queue.ts`
- Updating 4 call sites in `src/engine/eforge.ts` to pass `(prd.id, cwd)`
- Updating all tests in `test/prd-queue.test.ts` for the new signature and lock location

### Out of Scope
- Gitignore changes (`.eforge/` is already gitignored)
- Lock atomicity, stale PID detection, or release semantics changes
- PRD status field updates (`pending -> running`)

## Files

### Modify
- `src/engine/prd-queue.ts` - Change `claimPrd(filePath: string)` to `claimPrd(prdId: string, cwd: string)` and `releasePrd(filePath: string)` to `releasePrd(prdId: string, cwd: string)`. Derive lock path as `resolve(cwd, '.eforge', 'queue-locks', `${prdId}.lock`)`. Add `mkdir(lockDir, { recursive: true })` in `claimPrd` before the `open()` call.
- `src/engine/eforge.ts` - Update 4 call sites: line ~627 `claimPrd(prd.filePath)` -> `claimPrd(prd.id, cwd)`, line ~658 `releasePrd(prd.filePath)` -> `releasePrd(prd.id, cwd)`, line ~677 `releasePrd(prd.filePath)` -> `releasePrd(prd.id, cwd)`, line ~766 `releasePrd(prd.filePath)` -> `releasePrd(prd.id, cwd)`.
- `test/prd-queue.test.ts` - Update `claimPrd` and `releasePrd` test calls to pass `(prdId, tempDir)` instead of `(filePath)`. Assert lock files exist at `join(tempDir, '.eforge', 'queue-locks', `${prdId}.lock`)` instead of `${filePath}.lock`.

## Verification

- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` exits with code 0
- [ ] `claimPrd` accepts `(prdId: string, cwd: string)` - no `filePath` parameter
- [ ] `releasePrd` accepts `(prdId: string, cwd: string)` - no `filePath` parameter
- [ ] `claimPrd` creates the `.eforge/queue-locks/` directory if it does not exist
- [ ] Lock file is created at `{cwd}/.eforge/queue-locks/{prdId}.lock`, not alongside the PRD file
- [ ] `O_CREAT | O_EXCL` atomic creation is preserved in `claimPrd`
- [ ] Stale PID detection logic is preserved in `claimPrd`
- [ ] `releasePrd` remains non-throwing when lock file is already gone
- [ ] All 4 call sites in `eforge.ts` pass `(prd.id, cwd)` to `claimPrd`/`releasePrd`
