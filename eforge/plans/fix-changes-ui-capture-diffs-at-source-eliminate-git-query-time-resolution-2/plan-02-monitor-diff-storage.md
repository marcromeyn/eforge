---
id: plan-02-monitor-diff-storage
name: Monitor Diff Storage and Simplified Endpoint
depends_on: [plan-01-engine-diff-capture]
branch: fix-changes-ui-capture-diffs-at-source-eliminate-git-query-time-resolution-2/monitor-diff-storage
---

# Monitor Diff Storage and Simplified Endpoint

## Architecture Context

With plan-01 capturing diffs at emission time in `build:files_changed` events, this plan stores those diffs in SQLite and replaces the fragile git-query-time diff resolution with a DB lookup. The existing 4-strategy fallback chain (`resolveCommitSha` -> `resolvePlanBranch` -> `resolveFeatureBranch` -> `resolveCwd`) is removed entirely. A retention policy manages DB growth.

## Implementation

### Overview

Add a `file_diffs` table to the monitor DB schema. Update the recorder to extract `diffs` from `build:files_changed` events and insert them into `file_diffs` while stripping them from the serialized event payload. Replace the `serveDiff()` function body with a DB query. Remove the 4 resolve functions and related dead code. Add retention cleanup triggered on server startup.

### Key Decisions

1. Diffs are stored in a separate table (not in the events JSON) to keep the events table and SSE stream lean while enabling direct single-file lookups.
2. The recorder strips `diffs` from the event before `JSON.stringify()` - existing event consumers (SSE stream, event log) are unaffected.
3. `candidateOrchestrationPaths()` is retained - it is still used by `readBuildConfigFromOrchestration()` elsewhere in server.ts.
4. Retention cleanup runs on server startup via `cleanupOldSessions(retentionCount)`. It deletes `file_diffs`, `events`, and `runs` for sessions beyond the keep count.

## Scope

### In Scope
- New `file_diffs` table with schema and indexes in db.ts
- New DB methods: `insertFileDiffs()`, `getFileDiff()`, `getFileDiffs()`, `cleanupOldSessions()`
- Recorder extracts diffs to `file_diffs` table and strips from serialized event
- Replace `serveDiff()` body with DB query (single-file and bulk modes)
- Remove dead code: `resolveCommitSha()`, `resolvePlanBranch()`, `resolveFeatureBranch()`, `resolveCwd()`
- Retention policy triggered on server startup
- New test file for DB queries and retention

### Out of Scope
- Event type changes (done in plan-01)
- Config schema changes (done in plan-01)
- UI changes (diff viewer already handles `{ diff: string | null }` responses)

## Files

### Create
- `test/file-diffs-db.test.ts` - Tests for `insertFileDiffs`, `getFileDiff`, `getFileDiffs`, and `cleanupOldSessions` against a temp SQLite DB. Tests insert/query round-trip, latest-diff-wins behavior for duplicate file paths, bulk query returns all files for a plan, and cleanup deletes sessions beyond keep count while preserving recent ones

### Modify
- `src/monitor/db.ts` - Add `file_diffs` table creation (with `idx_file_diffs_plan_file` index) to schema init. Add `MonitorDB` interface methods: `insertFileDiffs(runId, planId, diffs, timestamp)` for bulk insert, `getFileDiff(sessionId, planId, filePath)` returning latest diff record, `getFileDiffs(sessionId, planId)` returning all diffs for a plan, `cleanupOldSessions(keepCount)` that deletes old sessions' file_diffs/events/runs. Implement all methods in `SqliteMonitorDB`
- `src/monitor/recorder.ts` - In the event recording logic, when event type is `build:files_changed` and `diffs` array is present: call `db.insertFileDiffs()` with the diffs, then delete `diffs` from the event object before `JSON.stringify()` for the events table
- `src/monitor/server.ts` - Replace `serveDiff()` body: single-file mode calls `db.getFileDiff(sessionId, planId, file)` and returns `{ diff: record?.diffText ?? null }`; bulk mode calls `db.getFileDiffs(sessionId, planId)` and returns `{ files: records.map(r => ({ path: r.filePath, diff: r.diffText })) }`. Delete `resolveCommitSha()`, `resolvePlanBranch()`, `resolveFeatureBranch()`, `resolveCwd()` functions. Add `cleanupOldSessions()` call in `startServer()` using config's `monitor.retentionCount` (default 20). Keep `candidateOrchestrationPaths()` intact

## Database Schema

```sql
CREATE TABLE IF NOT EXISTS file_diffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id),
  plan_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  diff_text TEXT NOT NULL,
  timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_file_diffs_plan_file ON file_diffs(plan_id, file_path);
```

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes - all existing tests plus new file-diffs-db tests
- [ ] `file_diffs` table is created when the monitor DB initializes
- [ ] `insertFileDiffs()` bulk-inserts multiple `{path, diff}` records in one call
- [ ] `getFileDiff(sessionId, planId, filePath)` returns the latest diff record for one file (by timestamp DESC)
- [ ] `getFileDiffs(sessionId, planId)` returns all diff records for a plan
- [ ] `cleanupOldSessions(20)` deletes file_diffs, events, and runs for sessions beyond the 20 most recent
- [ ] Recorder calls `insertFileDiffs()` when `build:files_changed` event has `diffs` array
- [ ] Recorder strips `diffs` from event before `JSON.stringify()` - events table and SSE stream do not contain diff text
- [ ] `/api/diff/:sessionId/:planId?file=path` returns `{ diff: string | null }` from DB query with zero git operations
- [ ] `/api/diff/:sessionId/:planId` (bulk) returns `{ files: Array<{ path: string, diff: string }> }` from DB query with zero git operations
- [ ] `resolveCommitSha()` function no longer exists in server.ts
- [ ] `resolvePlanBranch()` function no longer exists in server.ts
- [ ] `resolveFeatureBranch()` function no longer exists in server.ts
- [ ] `resolveCwd()` function no longer exists in server.ts
- [ ] `candidateOrchestrationPaths()` still exists in server.ts
- [ ] `cleanupOldSessions()` is called during `startServer()` initialization
