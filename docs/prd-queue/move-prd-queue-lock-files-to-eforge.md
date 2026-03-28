---
title: Move PRD Queue Lock Files to `.eforge/`
created: 2026-03-28
status: pending
---



# Move PRD Queue Lock Files to `.eforge/`

## Problem / Motivation

After kicking off an eforge build, PRD lock files (`{prd}.md.lock`) are created alongside PRDs in `docs/prd-queue/`, which dirties the base branch's `git status` with untracked files. These lock files are purely runtime coordination artifacts and should never appear in `git status`. The PRD status modification (`pending -> running`) is intentional and acceptable, but the transient lock files are not.

## Goal

Relocate PRD queue lock files from `docs/prd-queue/{prd}.md.lock` to `.eforge/queue-locks/{prd-id}.lock` so they are automatically gitignored and colocated with other transient runtime state.

## Approach

Move lock files into `.eforge/queue-locks/`, which is already gitignored and is the canonical location for transient runtime state (`state.json`, `monitor.db`, `daemon.lock`). No gitignore changes are needed in any project.

Update `claimPrd` and `releasePrd` signatures from `(filePath: string)` to `(prdId: string, cwd: string)`, deriving the lock path as:

```typescript
const lockDir = resolve(cwd, '.eforge', 'queue-locks');
const lockPath = resolve(lockDir, `${prdId}.lock`);
```

`claimPrd` must ensure the directory exists (`await mkdir(lockDir, { recursive: true })`) before creating the lock. All other logic - `O_CREAT | O_EXCL` atomicity, stale PID detection, non-throwing release - stays the same.

### Changes

**1. `src/engine/prd-queue.ts`** - Change lock file location

Update `claimPrd` and `releasePrd` to accept `(prdId: string, cwd: string)` and derive lock paths as shown above.

**2. `src/engine/eforge.ts`** - Update 4 call sites in `runQueue`

| Line | Current | New |
|------|---------|-----|
| ~627 | `claimPrd(prd.filePath)` | `claimPrd(prd.id, cwd)` |
| ~658 | `releasePrd(prd.filePath)` | `releasePrd(prd.id, cwd)` |
| ~677 | `releasePrd(prd.filePath)` | `releasePrd(prd.id, cwd)` |
| ~766 | `releasePrd(prd.filePath)` | `releasePrd(prd.id, cwd)` |

**3. `test/prd-queue.test.ts`** - Update tests

Update `claimPrd` and `releasePrd` tests to pass `(prdId, tempDir)` and assert lock files at `.eforge/queue-locks/{prdId}.lock`.

## Scope

**In scope:**
- Changing lock file storage location from `docs/prd-queue/` to `.eforge/queue-locks/`
- Updating `claimPrd` and `releasePrd` function signatures and internals in `src/engine/prd-queue.ts`
- Updating all 4 call sites in `src/engine/eforge.ts`
- Updating tests in `test/prd-queue.test.ts`

**Out of scope:**
- Changes to gitignore (`.eforge/` is already gitignored)
- Changes to lock atomicity, stale PID detection, or release semantics
- Changes to PRD status field updates (`pending -> running`)

## Acceptance Criteria

- `pnpm test` - All tests pass
- `pnpm type-check` - No type errors
- Running `eforge build` on a test PRD produces no untracked `.lock` files in `git status`
- Lock file appears at `.eforge/queue-locks/{prd-id}.lock` during a build
- `claimPrd` and `releasePrd` accept `(prdId: string, cwd: string)` instead of `(filePath: string)`
- `claimPrd` creates `.eforge/queue-locks/` directory if it does not exist
- Existing lock semantics (`O_CREAT | O_EXCL` atomicity, stale PID detection, non-throwing release) are preserved
