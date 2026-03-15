---
id: plan-02-cohesion-review
name: Expedition Cohesion Review Cycle
depends_on: [plan-01-prompt-parser-foundations]
branch: prd-agent-prompt-gaps/cohesion-review
---

# Expedition Cohesion Review Cycle

## Architecture Context

This plan adds a cohesion review cycle for expedition mode. After module planners complete and plan files are compiled, a cohesion reviewer validates cross-module quality (file overlaps, integration contracts, dependency correctness, vague criteria). The cohesion evaluator then accepts/rejects the reviewer's fixes using the same review→evaluate pattern as the existing plan review.

The new agents follow the exact patterns of `plan-reviewer.ts` and `plan-evaluator.ts`. They reuse `parseReviewIssues` and `parseEvaluationBlock` (enhanced in plan-01 with structured evidence). The cohesion review cycle is inserted into `eforge.ts` using the existing `runReviewCycle()` helper, guarded by `scopeAssessment === 'expedition'`.

## Implementation

### Overview

1. Create two new prompt files: `cohesion-reviewer.md` and `cohesion-evaluator.md`
2. Create two new agent files: `cohesion-reviewer.ts` and `cohesion-evaluator.ts`
3. Add new event types and agent roles to `events.ts`
4. Wire cohesion review cycle into `eforge.ts` between plan commit and plan review
5. Render new events in `display.ts`
6. Re-export new agents from `index.ts`
7. Add StubBackend wiring tests

### Key Decisions

1. **Reuse `runReviewCycle()`**: The cohesion review follows the same reviewer→evaluator pattern. Using the existing `runReviewCycle` helper avoids code duplication and ensures consistent tracing/error handling.
2. **Coding tools for both agents**: The cohesion reviewer needs `tools: 'coding'` to read plan files and write fixes. The evaluator needs `tools: 'coding'` to run `git reset --soft HEAD~1` and apply verdicts (same as plan-evaluator).
3. **Guard with scope check**: The cohesion review only runs for expeditions (`scopeAssessment === 'expedition'`) since it's specifically about cross-module validation. Errands and excursions don't have module boundaries.
4. **Architecture content passed to reviewer**: The cohesion reviewer needs `architecture.md` content to verify integration contracts. This is read from `plans/{planSetName}/architecture.md` in the engine.
5. **Non-fatal**: Like plan review, cohesion review failure is non-fatal — plan artifacts are already committed.

## Scope

### In Scope
- New prompt: `src/engine/prompts/cohesion-reviewer.md`
- New prompt: `src/engine/prompts/cohesion-evaluator.md`
- New agent: `src/engine/agents/cohesion-reviewer.ts`
- New agent: `src/engine/agents/cohesion-evaluator.ts`
- Event type additions: `plan:cohesion:start`, `plan:cohesion:complete`, `plan:cohesion:evaluate:start`, `plan:cohesion:evaluate:complete`
- Agent role additions: `'cohesion-reviewer' | 'cohesion-evaluator'`
- Engine wiring in `eforge.ts`
- CLI display rendering in `display.ts`
- Re-exports in `index.ts`
- Wiring tests in `test/cohesion-review.test.ts`

### Out of Scope
- Changes to the orchestrator's execution model
- Multi-agent parallelization for large reviews
- Cohesion review for excursions (multi-plan but no architecture document)

## Files

### Create
- `src/engine/prompts/cohesion-reviewer.md` — Prompt instructing a coding agent to: build file_path→[plan_ids] overlap map, verify architecture.md integration contracts, validate depends_on matches data flow, detect vague verification criteria. Safe fixes written unstaged; unsafe issues reported only. Output is `<review-issues>` XML.
- `src/engine/prompts/cohesion-evaluator.md` — Prompt following plan-evaluator.md structure with cohesion-specific accept/reject criteria. Uses 5-point evidence format (`<original>`, `<fix>`, `<rationale>`, `<if-accepted>`, `<if-rejected>`).
- `src/engine/agents/cohesion-reviewer.ts` — Async generator following plan-reviewer.ts pattern: yields `plan:cohesion:start`, runs backend with `tools: 'coding'`, parses `<review-issues>` via `parseReviewIssues`, yields `plan:cohesion:complete` with issues array. Options type: `CohesionReviewerOptions` (backend, sourceContent, planSetName, architectureContent, cwd, verbose, abortController).
- `src/engine/agents/cohesion-evaluator.ts` — Async generator following plan-evaluator.ts pattern: yields `plan:cohesion:evaluate:start`, runs backend with `tools: 'coding'`, parses evaluation via `parseEvaluationBlock`, yields `plan:cohesion:evaluate:complete` with accepted/rejected counts. Options type: `CohesionEvaluatorOptions`.
- `test/cohesion-review.test.ts` — StubBackend wiring tests for both agents: event emission lifecycle, XML parsing of review issues, XML parsing of evaluation verdicts, error handling (non-fatal), empty output handling.

### Modify
- `src/engine/events.ts` — Add `'cohesion-reviewer' | 'cohesion-evaluator'` to `AgentRole` union. Add 4 event types to `EforgeEvent`: `plan:cohesion:start`, `plan:cohesion:complete` (with `issues: ReviewIssue[]`), `plan:cohesion:evaluate:start`, `plan:cohesion:evaluate:complete` (with `accepted: number; rejected: number`).
- `src/engine/eforge.ts` — In `plan()` method, after the git commit at line 247 and before the plan review at line 251, insert a cohesion review cycle guarded by `if (scopeAssessment === 'expedition')`. Read `architectureContent` from `plans/{planSetName}/architecture.md`. Use `runReviewCycle()` with cohesion-reviewer and cohesion-evaluator. Import new agent functions.
- `src/cli/display.ts` — Add cases for all 4 new event types matching existing `plan:review:*` pattern: `plan:cohesion:start` → start spinner, `plan:cohesion:complete` → succeed spinner with issue counts, `plan:cohesion:evaluate:start` → start spinner, `plan:cohesion:evaluate:complete` → succeed spinner with accepted/rejected counts. Update the exhaustive switch default.
- `src/engine/index.ts` — Re-export `runCohesionReview` and `CohesionReviewerOptions` from cohesion-reviewer.ts, `runCohesionEvaluate` and `CohesionEvaluatorOptions` from cohesion-evaluator.ts.

## Verification

- [ ] `pnpm type-check` passes — no type errors from new events, agents, or display cases
- [ ] `pnpm test` passes — all existing tests pass, plus new `test/cohesion-review.test.ts`
- [ ] `AgentRole` type includes `'cohesion-reviewer'` and `'cohesion-evaluator'`
- [ ] `EforgeEvent` union includes all 4 cohesion event types with correct payloads
- [ ] `display.ts` exhaustive switch handles all 4 new events without hitting `default`
- [ ] `eforge.ts` runs cohesion review cycle only when `scopeAssessment === 'expedition'`
- [ ] Cohesion review cycle is non-fatal (wrapped in try/catch, same as plan review)
- [ ] `runCohesionReview` yields `plan:cohesion:start` then `plan:cohesion:complete` with parsed `ReviewIssue[]`
- [ ] `runCohesionEvaluate` yields `plan:cohesion:evaluate:start` then `plan:cohesion:evaluate:complete` with accepted/rejected counts
- [ ] Both new agents use `tools: 'coding'`
- [ ] `cohesion-reviewer.md` instructs building file_path→[plan_ids] map, checking architecture contracts, validating depends_on, detecting vague criteria
- [ ] `cohesion-evaluator.md` uses 5-point evidence format with `<original>` tag
- [ ] New agents and types are re-exported from `src/engine/index.ts`
