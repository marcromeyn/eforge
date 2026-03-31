---
id: plan-01-engine-diff-capture
name: Engine Diff Capture and Config
depends_on: []
branch: fix-changes-ui-capture-diffs-at-source-eliminate-git-query-time-resolution-2/engine-diff-capture
---

# Engine Diff Capture and Config

## Architecture Context

The `build:files_changed` event currently carries only file paths. The monitor's diff viewer attempts to reconstruct diffs at query time using a fragile 4-strategy fallback chain against git state. This plan adds diff content capture at the emission site so diffs are available without git operations at query time.

This plan handles the engine-side changes: extending the event type, adding the diff capture utility, updating emission sites, and adding the `monitor.retentionCount` config field.

## Implementation

### Overview

Extend the `build:files_changed` event type with optional `diffs` and `baseBranch` fields. Add a `captureFileDiffs()` utility that runs a single `git diff <baseBranch>` and splits the output into per-file chunks. Update both `emitFilesChanged()` and `withPeriodicFileCheck()` to call `captureFileDiffs()` and include the results in emitted events. Add `monitor.retentionCount` to the config schema, interface, defaults, and merge logic.

### Key Decisions

1. `diffs` and `baseBranch` are optional fields for backward compatibility with existing events already stored in DBs.
2. `captureFileDiffs()` returns an empty array on failure - consistent with the existing non-critical error handling in `emitFilesChanged()` and `withPeriodicFileCheck()`.
3. The diff capture runs a single `git diff <baseBranch>` (without `--name-only`) and splits on `diff --git a/` headers - one git command for all files.
4. `monitor.retentionCount` defaults to 20 and follows the same shallow-merge pattern as `daemon` and other object config sections.

## Scope

### In Scope
- Extend `build:files_changed` event type with optional `diffs` and `baseBranch`
- New `captureFileDiffs()` helper in pipeline.ts
- Update `emitFilesChanged()` to capture and emit diffs
- Update `withPeriodicFileCheck()` to capture and emit diffs
- Add `monitor` config section to schema, interface, defaults, and merge logic
- Update existing tests for new optional event fields
- Add test for diff capture in periodic file check
- Update docs/config.md with `monitor` section
- Update CLAUDE.md with `monitor` in config merge docs

### Out of Scope
- Monitor DB schema changes (plan-02)
- Recorder changes (plan-02)
- Server endpoint changes (plan-02)
- Dead code removal (plan-02)
- UI changes (not needed - diff viewer already handles the response shape)

## Files

### Modify
- `src/engine/events.ts` - Add optional `diffs: Array<{ path: string; diff: string }>` and `baseBranch: string` fields to the `build:files_changed` variant of `EforgeEvent`
- `src/engine/pipeline.ts` - Add exported `captureFileDiffs(cwd: string, baseBranch: string)` function. Update `emitFilesChanged()` and `withPeriodicFileCheck()` to call it and include results in emitted events
- `src/engine/config.ts` - Add `monitor: z.object({ retentionCount: z.number().int().positive().optional() }).optional()` to `eforgeConfigSchema`. Add `monitor: { retentionCount: number }` to `EforgeConfig`. Add `monitor: Object.freeze({ retentionCount: 20 })` to `DEFAULT_CONFIG`. Add shallow-merge block for `monitor` in `mergePartialConfigs()`
- `test/files-changed-event.test.ts` - Add tests verifying events with optional `diffs` and `baseBranch` fields compile and pass runtime checks. Add test verifying events without these fields (backward compat) still pass
- `test/periodic-file-check.test.ts` - Mock `captureFileDiffs` (via the git diff call) to return diff content. Verify emitted `build:files_changed` events include `diffs` and `baseBranch` fields when file list changes
- `docs/config.md` - Add `monitor` section between `daemon` and `pi` sections documenting `retentionCount` with default of 20. Update Config Layers paragraph to include `monitor` in the list of shallow-merge object sections
- `CLAUDE.md` - Add `monitor` to the config merge strategy documentation

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes - all existing tests plus new/updated tests
- [ ] `build:files_changed` event type accepts objects with `diffs` and `baseBranch` fields present
- [ ] `build:files_changed` event type accepts objects without `diffs` and `baseBranch` fields (backward compat)
- [ ] `captureFileDiffs()` splits `git diff` output on `diff --git a/` headers into per-file `{path, diff}` pairs
- [ ] `captureFileDiffs()` returns `[]` when the git command fails
- [ ] `emitFilesChanged()` includes `diffs` and `baseBranch` in the yielded event
- [ ] `withPeriodicFileCheck()` includes `diffs` and `baseBranch` in emitted `build:files_changed` events
- [ ] `eforgeConfigSchema` accepts `{ monitor: { retentionCount: 20 } }`
- [ ] `DEFAULT_CONFIG.monitor.retentionCount` equals 20
- [ ] `mergePartialConfigs()` shallow-merges the `monitor` section (project overrides global)
- [ ] `docs/config.md` contains `monitor:` section with `retentionCount` documented
- [ ] Config Layers paragraph in `docs/config.md` lists `monitor` alongside other shallow-merge sections
