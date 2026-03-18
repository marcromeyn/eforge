---
id: plan-01-deduplicate
name: Deduplicate Repeated Patterns Across Engine and Tests
depends_on: []
branch: errand-deduplicate-repeated-patterns-across-engine-tests/deduplicate
---

# Deduplicate Repeated Patterns Across Engine and Tests

## Architecture Context

The codebase has four copy-pasted patterns that each appear in 3+ locations - past the project's "colocate until 3+ files" threshold. All four extractions are mechanical: pull repeated code into a canonical location, replace inline definitions with imports. Zero behavioral changes.

## Implementation

### Overview

Four independent extractions, all purely mechanical:

1. **`SEVERITY_ORDER`** → export from `src/engine/events.ts`, remove 3 local definitions
2. **`formatIssueSummary()`** → private helper in `src/cli/display.ts`, replace 3 inline blocks
3. **Test event helpers** → new `test/test-events.ts`, replace inline definitions in 13 test files
4. **Temp dir helper** → new `test/test-tmpdir.ts`, replace boilerplate in 7 test files (9 describe blocks)

### Key Decisions

1. `SEVERITY_ORDER` goes in `src/engine/events.ts` next to the `ReviewIssue` interface it references - keeps the severity mapping colocated with the type definition
2. `formatIssueSummary()` stays private (not exported) in `display.ts` since it's only used within that file - it's a DRY extraction, not a shared utility
3. `useTempDir()` returns a `getTempDir` function and registers its own `afterEach` cleanup - consumers call the factory at describe scope and use the returned getter inside tests
4. `formatter-agent.test.ts` keeps its unique `collectEventsAndResult()` inline but imports `findEvent` and `filterEvents` from the shared module

## Scope

### In Scope
- Extracting `SEVERITY_ORDER` to `src/engine/events.ts`
- Extracting `formatIssueSummary()` as a private helper in `display.ts`
- Creating `test/test-events.ts` with `collectEvents`, `findEvent`, `filterEvents`
- Creating `test/test-tmpdir.ts` with `useTempDir()` factory
- Updating all consuming files to use imports instead of inline definitions

### Out of Scope
- Any behavioral changes
- Extracting `collectEventsAndResult()` from `formatter-agent.test.ts` (unique variant, stays inline)
- Changing test structure or adding/removing tests

## Files

### Create
- `test/test-events.ts` — shared `collectEvents()`, `findEvent()`, `filterEvents()` helpers
- `test/test-tmpdir.ts` — shared `useTempDir()` factory with auto-cleanup

### Modify

**Engine (SEVERITY_ORDER extraction):**
- `src/engine/events.ts` — add `export const SEVERITY_ORDER` after the `ReviewIssue` interface
- `src/engine/pipeline.ts` — remove local `SEVERITY_ORDER` (lines 248-252), import from `../events.js`
- `src/engine/agents/review-fixer.ts` — remove local `SEVERITY_ORDER` inside `formatIssuesForPrompt`, import from `../events.js`
- `src/engine/agents/parallel-reviewer.ts` — remove local `SEVERITY_ORDER` inside `deduplicateIssues`, import from `../events.js`

**CLI (formatIssueSummary extraction):**
- `src/cli/display.ts` — add private `formatIssueSummary()` helper, replace three inline filter-count-colorize blocks at `plan:review:complete` (lines 161-168), `plan:cohesion:complete` (lines 198-205), and `build:review:complete` (lines 259-266) with calls to it. Import `ReviewIssue` type from events.

**Test event helpers (13 files):**
- `test/agent-wiring.test.ts` — remove inline `collectEvents`, `findEvent`, `filterEvents`; import from `./test-events.js`
- `test/assessor-wiring.test.ts` — remove inline `collectEvents`, `findEvent`, `filterEvents`; import from `./test-events.js`
- `test/cohesion-review.test.ts` — remove inline `collectEvents`, `findEvent`, `filterEvents`; import from `./test-events.js`
- `test/doc-updater-wiring.test.ts` — remove inline `collectEvents`, `findEvent`; import from `./test-events.js`
- `test/dynamic-profile-generation.test.ts` — remove inline `collectEvents`, `findEvent`, `filterEvents`; import from `./test-events.js`
- `test/merge-conflict-resolver.test.ts` — remove inline `collectEvents`, `findEvent`; import from `./test-events.js`
- `test/parallel-reviewer.test.ts` — remove inline `collectEvents`, `findEvent`, `filterEvents`; import from `./test-events.js`
- `test/sdk-event-mapping.test.ts` — remove inline `collectEvents`; import from `./test-events.js`
- `test/sdk-mapping.test.ts` — remove inline `collectEvents`; import from `./test-events.js`
- `test/staleness-assessor.test.ts` — remove inline `collectEvents`, `findEvent`, `filterEvents`; import from `./test-events.js`
- `test/validation-fixer.test.ts` — remove inline `collectEvents`, `findEvent`, `filterEvents`; import from `./test-events.js`
- `test/watch-queue.test.ts` — remove inline `collectEvents`; import from `./test-events.js`
- `test/hooks.test.ts` — remove inline `collectEvents` (inside describe block); import from `./test-events.js`
- `test/formatter-agent.test.ts` — keep `collectEventsAndResult` inline; remove inline `findEvent`, `filterEvents`; import those two from `./test-events.js`

**Test temp dir helpers (7 files, 9 describe blocks):**
- `test/agent-wiring.test.ts` — 2 describe blocks: replace `tempDirs`/`makeTempDir`/`afterEach` with `useTempDir()`
- `test/adopt.test.ts` — 2 describe blocks: replace `tempDirs`/`makeTempDir`/`afterEach` with `useTempDir()`
- `test/dynamic-profile-generation.test.ts` — 1 describe block: replace with `useTempDir()`
- `test/plan-parsing.test.ts` — 1 describe block: replace with `useTempDir()`
- `test/prd-queue.test.ts` — 1 describe block: replace with `useTempDir()`
- `test/prd-queue-enqueue.test.ts` — 1 describe block: replace with `useTempDir()`
- `test/state.test.ts` — 1 describe block: replace with `useTempDir()`

## Verification

- [ ] `SEVERITY_ORDER` is exported from `src/engine/events.ts` and no local definitions exist in `pipeline.ts`, `review-fixer.ts`, or `parallel-reviewer.ts` (grep for `const SEVERITY_ORDER` returns exactly 1 hit in `events.ts`)
- [ ] `formatIssueSummary` function exists in `display.ts` and the three inline filter-count-colorize blocks are replaced (grep for `filter.*severity.*critical.*length` in `display.ts` returns 0 hits)
- [ ] `test/test-events.ts` exports `collectEvents`, `findEvent`, `filterEvents` — no test file defines them inline (grep for `^async function collectEvents` or `^function findEvent` in `test/*.test.ts` returns 0 hits, except `collectEventsAndResult` in `formatter-agent.test.ts`)
- [ ] `test/test-tmpdir.ts` exports `useTempDir` — no test file has `const tempDirs: string[] = []` inline (grep returns 0 hits in `test/*.test.ts`)
- [ ] `formatter-agent.test.ts` retains `collectEventsAndResult` inline and imports `findEvent`, `filterEvents` from `./test-events.js`
- [ ] `pnpm type-check` passes with exit code 0
- [ ] `pnpm test` passes with exit code 0
