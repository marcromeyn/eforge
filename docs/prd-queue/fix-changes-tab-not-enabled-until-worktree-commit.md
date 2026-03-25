---
title: Fix Changes tab not enabled until worktree commit
created: 2026-03-25
status: pending
---

# Fix Changes tab not enabled until worktree commit

## Problem / Motivation

The monitor UI's "Changes" tab stays disabled even when the builder has modified many files in the worktree. Two issues compound to cause this:

1. **Wrong git command**: `git diff --name-only baseBranch...HEAD` (three-dot syntax) compares commits only, missing uncommitted (staged + unstaged) changes in the working tree.
2. **Event emitted too late**: `build:files_changed` is only emitted once, after the full `implement` stage completes. No other file-modifying stages (`review-fix`, `doc-update`, `test-write`, `test-fix`) emit it, so the Changes tab never updates as the build progresses through later stages.

## Goal

Make the Changes tab enable as soon as any file-modifying stage completes — including when the builder leaves uncommitted changes — by fixing the git diff command and emitting `build:files_changed` from all relevant stages.

## Approach

### 1. Fix the git diff command to capture all changes

**File**: `src/engine/pipeline.ts` (~line 782)

Change:
```typescript
const { stdout } = await exec('git', ['diff', '--name-only', `${ctx.orchConfig.baseBranch}...HEAD`], { cwd: ctx.worktreePath });
```
To:
```typescript
const { stdout } = await exec('git', ['diff', '--name-only', ctx.orchConfig.baseBranch], { cwd: ctx.worktreePath });
```

`git diff --name-only baseBranch` (two-dot, no `HEAD`) compares the base branch tip to the working tree, capturing committed + staged + unstaged changes.

### 2. Extract a reusable helper for emitting the event

Create a helper function in `pipeline.ts` (near the existing code):

```typescript
async function* emitFilesChanged(ctx: BuildStageContext): AsyncGenerator<EforgeEvent> {
  try {
    const { stdout } = await exec('git', ['diff', '--name-only', ctx.orchConfig.baseBranch], { cwd: ctx.worktreePath });
    const files = stdout.trim().split('\n').filter(Boolean);
    if (files.length > 0) {
      yield { type: 'build:files_changed', planId: ctx.planId, files };
    }
  } catch {
    // Non-critical - skip silently
  }
}
```

### 3. Emit `build:files_changed` after all file-modifying stages

Call `yield* emitFilesChanged(ctx)` at the end of these stages:
- **`implement`** (~line 780) — replace existing inline code with `yield* emitFilesChanged(ctx)`
- **`review-fix`** (~line 869, after fixer completes) — new addition
- **`doc-update`** (~line 965, after doc updater completes) — new addition
- **`test-write`** (after test writer completes) — new addition
- **`test-fix`** (after test fixer completes) — new addition

The reducer already handles duplicate/updated `build:files_changed` events per `planId` (it overwrites the previous files array), so emitting multiple times is safe and will progressively update the heatmap.

### 4. Update existing tests

**File**: `test/files-changed-event.test.ts` — update if any tests assert on the specific git command format.

## Scope

**In scope:**
- Fixing the git diff command in `src/engine/pipeline.ts`
- Extracting a reusable `emitFilesChanged` helper
- Adding `build:files_changed` emission to `review-fix`, `doc-update`, `test-write`, and `test-fix` stages
- Updating tests in `test/files-changed-event.test.ts`

**Out of scope:**
- N/A

**Files to modify:**
- `src/engine/pipeline.ts` — main changes (helper + emit calls)
- `test/files-changed-event.test.ts` — update tests if needed

## Acceptance Criteria

- `git diff --name-only baseBranch` (two-dot, no `HEAD`) is used instead of `baseBranch...HEAD`, so uncommitted (staged + unstaged) changes are captured.
- A reusable `emitFilesChanged` helper function exists in `pipeline.ts` and is used by all file-modifying stages.
- `build:files_changed` is emitted after each of: `implement`, `review-fix`, `doc-update`, `test-write`, `test-fix`.
- `pnpm type-check` passes with no type errors.
- `pnpm test` passes (all tests, including updated ones in `test/files-changed-event.test.ts`).
- Manual verification: running `eforge build` on a test PRD shows the Changes tab enabling as soon as the implement stage completes, even if the builder leaves uncommitted changes.
