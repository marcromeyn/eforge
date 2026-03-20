---
title: Tester Agent: Separate Test Concerns from Builder
created: 2026-03-20
status: pending
---

# Tester Agent: Separate Test Concerns from Builder

## Problem / Motivation

The builder agent currently owns both production code implementation AND test verification/fixing within its multi-turn conversation. This overloads the builder's scope - it holds implementation context, test expectations, failure diagnosis, and fix strategies all at once. The builder prompt's "Verification" section tells it to run tests and fix failures before committing, with no visibility into what happened at the pipeline level.

Separating test responsibilities into a dedicated tester agent:
- **Reduces builder scope** - builder focuses purely on implementing production code from the plan
- **Improves test quality** - dedicated agent with test-specific prompting can write better tests, diagnose failures more accurately, and distinguish test bugs from production bugs
- **Enables test-first workflows** - TDD becomes a natural stage composition
- **Creates visibility** - test-specific events give the pipeline and monitor clear signals about test health

## Goal

Extract test writing, running, and fixing from the builder into dedicated `test-writer` and `tester` agents, composable via new pipeline stages (`test-write`, `test`, `test-fix`, `test-cycle`) that the planner selects per-plan as build stage sequences.

## Approach

### New Agent Roles

| Agent | Role | Tools | Turns | Purpose |
|-------|------|-------|-------|---------|
| **test-writer** | `test-writer` | `coding` | 30 | Writes tests from plan spec (TDD) or from implementation (post-build) |
| **tester** | `tester` | `coding` | 40 | Runs tests, diagnoses failures, fixes test bugs, applies production fixes (unstaged) |

Both live in a single file (`src/engine/agents/tester.ts`) with two exported async generators.

### Stage Compositions (Strategies)

The planner/module-planner selects a test strategy by emitting the right build stage sequence in `<build-config>`:

```yaml
# 1. Build-then-test (default for plans with testable behavior)
build: [implement, test-cycle, review-cycle]

# 2. TDD (well-specified features with clear acceptance criteria)
build: [test-write, implement, test-cycle]

# 3. Parallel test + review (time-optimized)
build: [implement, [test-cycle, review-cycle]]

# 4. No testing (config changes, simple refactors, doc-only)
build: [implement, review-cycle]
```

### Test Cycle (Composite Stage)

Mirrors the review cycle: `test-cycle` = `[test, test-fix, evaluate]` looped for N rounds.

1. **`test`** stage - tester agent runs tests, writes missing tests for uncovered plan requirements, fixes test bugs (commits). Reports production issues as structured `TestIssue[]` via `<test-issues>` XML output. Production fixes are applied as unstaged changes.
2. **`test-fix`** stage - a lightweight fixer (reuses `runReviewFixer` pattern) applies production code fixes from test issues. Leaves changes unstaged for evaluator. Runs only if the `test` stage reported production issues without applying its own unstaged fixes. (In practice, the tester often applies fixes directly, making this stage a no-op - but it's there for robustness when the tester diagnoses but can't fix.)
3. **`evaluate`** stage - reuses the existing evaluator to judge unstaged production fixes. Same agent, same prompt, same verdict logic. Shared with review-cycle.

The evaluate stage already checks `hasUnstagedChanges()` and no-ops when clean - no special handling needed.

### TestIssue Type

```typescript
interface TestIssue {
  severity: 'critical' | 'warning';     // test failures are binary, no 'suggestion'
  category: 'production-bug' | 'missing-behavior' | 'regression';
  file: string;           // production file with the bug
  testFile: string;       // test file that exposed it
  description: string;
  testOutput?: string;    // relevant test failure output
  fix?: string;           // description of unstaged fix applied
}
```

### Builder Scope Change

When test stages appear in `ctx.build`, the builder skips test execution during verification. The `implement` stage in `pipeline.ts` checks for test stages and passes a `{{verification_scope}}` template variable to the builder prompt:

- `full` (default, no test stages in build): "Run type-check, build, and tests"
- `build-only` (test stages present): "Run type-check and build only. Test verification is handled by dedicated test stages."

This is detected at the pipeline level, not hardcoded in the builder - the builder prompt is parameterized, and the implement stage resolves the scope from `ctx.build`.

### Tester Agent Workflow

The tester agent (multi-turn, tools: coding):

1. Runs the test suite using commands from the plan's Verification section (filtered to test-related commands)
2. Reads test output and categorizes each failure:
   - **Test bug** (bad assertion, missing setup, wrong fixture, flaky pattern) - fix directly, re-run to verify, commit
   - **Production bug** (code doesn't meet spec) - apply minimal production fix as unstaged change, report in `<test-issues>` XML
3. If tests all pass, checks plan requirements for untested behavior and writes new tests
4. Outputs structured `<test-issues>` XML block summarizing any production bugs found

### Test Writer Agent Workflow

The test-writer agent (one-shot, tools: coding):

1. Reads the plan to understand feature requirements and acceptance criteria
2. If post-implementation: reads the diff to understand what was built
3. Discovers existing test infrastructure (framework, helpers, fixtures, conventions)
4. Writes focused, isolated tests that cover the plan's specified behavior
5. Commits test files (tests should FAIL if pre-implementation / TDD mode)
6. Does NOT run tests - just writes them

### Config for Test Cycle

Reuse `ctx.review.maxRounds` for test-cycle round count. No separate test config needed - the build stage sequence already expresses the strategy, and the review config's maxRounds applies to both review-cycle and test-cycle. If finer control is needed later, a `test` config section can be added to orchestration.yaml plan entries.

### Files to Create

#### `src/engine/agents/tester.ts`

Two async generators following the doc-updater/review-fixer patterns:

- `runTestWriter(options: TestWriterOptions)` - loads `test-writer` prompt, runs with `tools: 'coding'`, yields `build:test:write:start/complete`
- `runTester(options: TesterOptions)` - loads `tester` prompt, runs with `tools: 'coding'`, accumulates `agent:message` text, parses `<test-issues>` XML via `parseTestIssues()`, yields `build:test:start/complete`

Both follow the doc-updater pattern: emit start event, try/catch with AbortError re-throw, emit complete event always.

#### `src/engine/prompts/test-writer.md`

Template variables: `{{plan_id}}`, `{{plan_content}}`, `{{implementation_context}}`

Key prompt sections:
- Read plan requirements and acceptance criteria
- Discover test infrastructure (run tests once to see framework, find test helpers)
- Write tests covering each acceptance criterion
- Follow existing test patterns and conventions in the project
- Commit all test files with `git add <test-files> && git commit -m "test({{plan_id}}): add tests"`
- For TDD: tests SHOULD fail - that's expected. Write them to express the spec, not the current behavior.

#### `src/engine/prompts/tester.md`

Template variables: `{{plan_id}}`, `{{plan_content}}`

Key prompt sections:
- Run the test suite
- For each failure, classify as test-bug or production-bug
- Test bugs: fix the test, re-run to verify the fix, commit with `git add <test-files> && git commit -m "fix({{plan_id}}): fix test issues"`
- Production bugs: apply a minimal targeted fix to production code, do NOT stage or commit. Output a `<test-issues>` XML block.
- If all tests pass: check plan requirements for uncovered behavior, write additional tests, commit
- Output format: `<test-issues><issue severity="..." category="..." file="..." testFile="...">description<fix>fix applied</fix></issue></test-issues>`

### Files to Modify

#### `src/engine/events.ts`

Add to `AgentRole` union: `'test-writer' | 'tester'`

Add to `EforgeEvent` union (in the "Building (per-plan)" section):
```typescript
| { type: 'build:test:write:start'; planId: string }
| { type: 'build:test:write:complete'; planId: string; testsWritten: number }
| { type: 'build:test:start'; planId: string }
| { type: 'build:test:complete'; planId: string; passed: number; failed: number; testBugsFixed: number; productionIssues: TestIssue[] }
```

Add `TestIssue` type (exported, defined inline or via Zod schema reference).

#### `src/engine/schemas.ts`

Add `testIssueSchema` Zod schema matching the `TestIssue` interface. Add `getTestIssueSchemaYaml()` for prompt injection (same pattern as `getReviewIssueSchemaYaml()`).

#### `src/engine/agents/common.ts`

Add `parseTestIssues(text: string): TestIssue[]` following the `parseReviewIssues()` pattern:
- Extract `<test-issues>` XML block via regex
- Parse `<issue>` elements with severity, category, file, testFile attributes
- Extract description text and optional `<fix>` child
- Return typed array, never throw

#### `src/engine/pipeline.ts`

Register four new build stages:

**`test-write`**: Calls `runTestWriter()` with plan content and implementation diff (from `git diff base...HEAD`). Non-fatal on error.

**`test`**: Calls `runTester()` with plan content. On complete, converts `TestIssue[]` to `ReviewIssue[]` format and stores in `ctx.reviewIssues` (so `test-fix` and `evaluate` can consume them via existing plumbing). Non-fatal on error.

**`test-fix`**: Reuses `reviewFixStageInner()` or calls `runReviewFixer()` directly with the test-derived review issues. Same pattern as the existing review-fix stage. Non-fatal on error.

**`test-cycle`**: Composite stage mirroring `review-cycle`. Loops `[test, test-fix, evaluate]` for `ctx.review.maxRounds` rounds. Breaks early if no production issues. Uses the inner stage functions (`evaluateStageInner`, etc.) like review-cycle does.

Update the `implement` stage to detect test stages in `ctx.build` and pass `verification_scope: 'build-only'` to the builder when found. Detection: check if any stage name in the flattened `ctx.build` starts with `test`.

Add imports for `runTestWriter`, `runTester` from `./agents/tester.js`.

#### `src/engine/config.ts`

Add `'test-writer'`, `'tester'` to `AGENT_ROLES` array.

Update available stage documentation (if any string validation exists for build stage names).

Add default build constants (for reference, not necessarily used by planners):
```typescript
export const DEFAULT_BUILD_WITH_TESTS: BuildStageSpec[] = ['implement', 'test-cycle', 'review-cycle'];
export const DEFAULT_BUILD_TDD: BuildStageSpec[] = ['test-write', 'implement', 'test-cycle'];
```

#### `src/engine/prompts/builder.md`

Add `{{verification_scope}}` template variable. Replace the current Verification section:

```markdown
## Verification

{{verification_scope}}
```

Where `verification_scope` resolves to either the full verification text (current content) or a build-only variant that omits test commands.

#### `src/engine/prompts/planner.md`

Update the "Per-Plan Build and Review Configuration" section:
- Add `test-write`, `test`, `test-fix`, `test-cycle` to the available stages list
- Add guidance for when to include test stages vs not
- Add `test-cycle` as a composite stage description (like `review-cycle`)

#### `src/engine/prompts/module-planner.md`

Same updates as planner.md - add test stages to available stages and guidance.

#### `src/engine/agents/builder.ts`

Update `builderImplement()` to accept a `verificationScope` option and pass it to the prompt template as `{{verification_scope}}`. The pipeline's implement stage resolves this from `ctx.build`.

#### `src/cli/display.ts`

Add rendering for new test events:
- `build:test:write:start` / `build:test:write:complete`
- `build:test:start` / `build:test:complete`

Follow existing patterns for build event rendering (spinner/status messages).

#### `src/monitor/ui/src/components/timeline/event-card.tsx`

Add event card rendering for test events.

#### `src/monitor/ui/src/lib/reducer.ts`

Handle new test event types in the state reducer.

#### `src/monitor/ui/src/lib/types.ts`

Add test event types to the UI type definitions (if not auto-derived from engine types).

### Implementation Order

1. Types first: `events.ts` (TestIssue, new events, agent roles), `schemas.ts` (testIssueSchema), `config.ts` (AGENT_ROLES)
2. XML parser: `common.ts` (parseTestIssues)
3. Agent implementations: `tester.ts` (runTestWriter, runTester)
4. Prompts: `test-writer.md`, `tester.md`
5. Builder changes: `builder.ts` (verificationScope option), `builder.md` (template variable)
6. Pipeline stages: `pipeline.ts` (register test-write, test, test-fix, test-cycle, update implement stage)
7. Planner prompts: `planner.md`, `module-planner.md` (test strategy guidance)
8. CLI + Monitor: `display.ts`, `event-card.tsx`, `reducer.ts`, `types.ts`
9. Tests: agent wiring tests using StubBackend

## Scope

### In Scope

- New `test-writer` and `tester` agents in `src/engine/agents/tester.ts`
- New prompts: `test-writer.md`, `tester.md`
- New pipeline stages: `test-write`, `test`, `test-fix`, `test-cycle` (composite)
- `TestIssue` type and Zod schema, `parseTestIssues()` XML parser
- Builder prompt parameterization via `{{verification_scope}}` to narrow builder scope when test stages are present
- Planner and module-planner prompt updates to emit test strategies in `<build-config>`
- New `EforgeEvent` types for test lifecycle visibility
- CLI display rendering for test events
- Monitor UI rendering for test events (event cards, reducer, types)
- Agent wiring tests using `StubBackend`
- `TestIssue → ReviewIssue` conversion so test-fix and evaluate stages consume test results via existing plumbing
- Reuse of `ctx.review.maxRounds` for test-cycle round count (no separate test config)

### Out of Scope

- Separate `test` config section in orchestration.yaml plan entries (deferred unless finer control is needed)
- Changes to the `AgentBackend` interface
- New CLI commands or flags
- Changes to orchestration, worktree management, or merge logic

## Acceptance Criteria

1. `pnpm type-check` passes with all new types integrated
2. `pnpm build` succeeds
3. `pnpm test` - all existing tests pass
4. New agent wiring tests (`test/tester-wiring.test.ts`):
   - `runTestWriter` yields correct `build:test:write:start` / `build:test:write:complete` events
   - `runTester` parses `<test-issues>` XML correctly (happy path, empty issues, malformed XML)
   - `test-cycle` composes correctly: test → test-fix → evaluate, breaks early when no issues
   - `TestIssue → ReviewIssue` conversion works for evaluate stage consumption
5. Pipeline tests:
   - `implement` stage sets `verification_scope: 'build-only'` when test stages are present in `ctx.build`
   - `implement` stage sets `verification_scope: 'full'` when no test stages are present
6. `test-write`, `test`, `test-fix`, and `test-cycle` stages are registered in the pipeline stage registry
7. `'test-writer'` and `'tester'` are included in the `AGENT_ROLES` array in `config.ts`
8. Builder prompt accepts `{{verification_scope}}` template variable and renders correctly for both `full` and `build-only` modes
9. Planner and module-planner prompts document test stages and provide guidance for when to include them
10. CLI renders test events with spinner/status messages following existing build event patterns
11. Monitor UI displays test events in the timeline with appropriate event cards
12. Manual verification: `eforge run` with a PRD that produces a plan with test stages runs the tester and displays test events in both CLI and monitor
