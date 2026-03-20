---
id: plan-01-backend-diff-api
name: Backend Diff API
dependsOn: []
branch: monitor-diff-viewer-heatmap-integration/backend-diff-api
---

# Backend Diff API

## Architecture Context

The monitor heatmap shows which files were changed by which plans, but there's no way to see the actual diffs. This plan adds the data pipeline: capturing the squash-merge commit SHA in `merge:complete` events, then serving unified diffs on-demand via a new server endpoint. The UI plan (plan-02) consumes this endpoint.

Worktrees and branches are force-deleted after squash merge, so diffs come from git history via `git show <sha> -- <file>`. Zero event storage overhead - no diff text in SQLite.

## Implementation

### Overview

Three changes along the data path: (1) add optional `commitSha` to the `merge:complete` event type, (2) capture HEAD SHA after `mergeWorktree()` in the orchestrator, (3) add a `/api/diff/:sessionId/:planId` endpoint to the monitor server that queries the DB for the commit SHA and runs `git show` to produce diffs.

### Key Decisions

1. **Optional `commitSha` field** on `merge:complete` rather than a separate event - keeps the event model lean and backwards compatible with existing DB records.
2. **Legacy fallback via `git log --grep`** - events already in the DB won't have `commitSha`, so the server falls back to searching git history by plan ID in the commit message. The commit message format is `feat(plan-id): Plan Name` which is grep-able.
3. **Bulk and single-file endpoints on the same route** - `GET /api/diff/:sessionId/:planId?file=path` returns one diff, omitting `file` returns all diffs for the plan's commit. Avoids N+1 requests when clicking through files.
4. **Use run's `cwd` from DB** for git operations, not the server's working directory. This lets historical runs resolve correctly even if the server is started from a different directory.
5. **Large diff and binary file handling** - the endpoint checks diff size (>500KB returns a "too large" indicator) and detects binary files from git output.

## Scope

### In Scope
- Adding `commitSha?: string` to `merge:complete` event type
- Capturing `git rev-parse HEAD` after squash merge in orchestrator
- `/api/diff/:sessionId/:planId` endpoint (bulk: all files, single: `?file=path`)
- Legacy SHA lookup via `git log --grep` for events without `commitSha`
- Large diff (>500KB) and binary file detection
- Error responses for missing commits, invalid params

### Out of Scope
- UI rendering of diffs (plan-02)
- Diffs during active builds (before merge)

## Files

### Modify
- `src/engine/events.ts` — Add optional `commitSha` field to the `merge:complete` event union member
- `src/engine/orchestrator.ts` — After `mergeWorktree()`, run `git rev-parse HEAD` and include `commitSha` in the yielded `merge:complete` event
- `src/monitor/server.ts` — Add `serveDiff()` handler and route matching for `GET /api/diff/:sessionId/:planId` with optional `?file=` query param. Uses `db.getEventsByTypeForSession()` to find `merge:complete` events, extracts `commitSha` from event data, falls back to `git log --grep`, runs `git show <sha>` or `git show <sha> -- <file>` via `child_process.execFile`

## Verification

- [ ] `pnpm type-check` passes with the new optional `commitSha` field on `merge:complete`
- [ ] `pnpm test` — all existing tests pass (no regressions)
- [ ] `merge:complete` event in orchestrator includes `commitSha` field with a 40-char hex SHA string
- [ ] `GET /api/diff/:sessionId/:planId?file=src/foo.ts` returns `{ diff: "<unified diff>", commitSha: "<sha>" }` JSON
- [ ] `GET /api/diff/:sessionId/:planId` (no file param) returns `{ files: [{ path, diff }], commitSha }` JSON
- [ ] Request with non-existent session/plan returns 404 with `{ error: "Commit not found" }` JSON
- [ ] Invalid sessionId or planId (non-alphanumeric) returns 400
- [ ] Diff larger than 500KB returns `{ diff: null, tooLarge: true, commitSha }` for single-file and `{ diff: null, tooLarge: true }` per file entry in bulk
- [ ] Binary files return `{ diff: null, binary: true }` per file entry
- [ ] Server resolves `cwd` from the run's DB record, not `process.cwd()`
