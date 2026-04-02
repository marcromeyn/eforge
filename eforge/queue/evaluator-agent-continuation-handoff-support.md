---
title: Evaluator Agent Continuation (Handoff) Support
created: 2026-04-02
---

# Evaluator Agent Continuation (Handoff) Support

## Problem / Motivation

Evaluator agents (both build-phase and plan-phase) currently have no continuation support when they hit `error_max_turns`. Builders and planners already have this - when they exhaust conversation turns, the pipeline checkpoints progress and restarts with continuation context. Evaluators just fail silently (plan-phase) or emit `build:failed` (build-phase), losing partial verdict progress. This was hit in production when an evaluator ran out of turns mid-evaluation.

## Goal

Add continuation loops around evaluator calls in the pipeline, following the same pattern as builder/planner but simpler, so that evaluators can recover from `error_max_turns` and complete their work across multiple attempts.

## Approach

Add continuation loops around evaluator calls in the pipeline. Evaluators don't need git checkpoint commits because verdicts are applied incrementally (`git add`/`git checkout --`), so partial progress persists naturally.

**Not extracting a generic continuation helper.** The three loops (builder, planner, evaluator) share a structural pattern but differ in context-building, checkpointing, event types, and error propagation enough that a generic abstraction would add complexity without meaningful DRY benefit.

Key design decisions:

- **No git checkpoint for evaluators** - verdicts are applied incrementally via `git add`/`git checkout --`, so partial progress persists naturally
- **"No unstaged changes = success"** - if the evaluator processed all files but hit max_turns before the final commit, the continuation check detects no remaining work and breaks
- **Prompt ordering** - continuation context placed before Setup section so the model sees "don't reset" before the instruction to reset
- **Default 1 continuation** - evaluators are simpler than builders; 1 retry is usually sufficient

### Changes

#### 1. Events (`src/engine/events.ts`)

Add 4 new continuation event types to the `EforgeEvent` union:

- `build:evaluate:continuation` (after `build:evaluate:complete`, line ~192) - with `planId`, `attempt`, `maxContinuations`
- `plan:evaluate:continuation` (after `plan:evaluate:complete`, line ~163) - with `attempt`, `maxContinuations`
- `plan:architecture:evaluate:continuation` (after line ~169) - same shape
- `plan:cohesion:evaluate:continuation` (after line ~175) - same shape

#### 2. Agent defaults (`src/engine/pipeline.ts`, line 416-418)

Add entries to `AGENT_MAX_CONTINUATIONS_DEFAULTS`:
```typescript
evaluator: 1,
'plan-evaluator': 1,
'cohesion-evaluator': 1,
'architecture-evaluator': 1,
```

Default of 1 (evaluators have simpler tasks than builders).

#### 3. Build-phase evaluator agent (`src/engine/agents/builder.ts`)

**3a. Add `evaluatorContinuationContext` to `BuilderOptions`** (line ~30):
```typescript
evaluatorContinuationContext?: { attempt: number; maxContinuations: number };
```

**3b. Update `builderEvaluate`** (lines 155-193):
- Build continuation context text when `evaluatorContinuationContext` is present - instructs evaluator to skip `git reset --soft HEAD~1` and only evaluate remaining unstaged files
- Pass `continuation_context` to `loadPrompt('evaluator', ...)`
- Re-throw `error_max_turns` errors (currently caught and yielded as `build:failed`). Keep catch-and-yield for non-max-turns errors.

#### 4. Plan-phase evaluator agent (`src/engine/agents/plan-evaluator.ts`)

**4a. Add `continuationContext` to `PlanPhaseEvaluatorOptions`** (line ~30):
```typescript
continuationContext?: { attempt: number; maxContinuations: number };
```

**4b. Update `runEvaluate`** (lines 129-168):
- Build continuation context text (same message as build-phase)
- Pass `continuation_context` to `loadPrompt(config.promptName, ...)`
- Error handling already re-throws - no change needed

#### 5. Prompts

**`src/engine/prompts/evaluator.md`** - Add `{{continuation_context}}` between the Context section and Setup section (after line 11). When populated, it tells the evaluator to skip `git reset --soft HEAD~1` and only process remaining unstaged files.

**`src/engine/prompts/plan-evaluator.md`** - Same placement (after line 9).

#### 6. Pipeline: `evaluateStageInner` (`src/engine/pipeline.ts`, lines 1486-1518)

Replace single-pass call with a continuation loop:
- Resolve `maxContinuations` from `AGENT_MAX_CONTINUATIONS_DEFAULTS['evaluator']`
- Loop `attempt = 0..maxContinuations`
- On `error_max_turns` (now thrown by `builderEvaluate`): check if unstaged changes remain; if none, treat as success (evaluator finished); if some remain, yield `build:evaluate:continuation` event and continue
- No git checkpoint needed (verdicts already in index/working tree)
- Non-fatal on exhaustion (matches existing behavior)

#### 7. Pipeline: `runReviewCycle` (`src/engine/pipeline.ts`, lines 1781-1836)

**7a. Extend `ReviewCycleConfig`** - change evaluator's `run` signature to accept optional continuation context, add `continuationEventType` field.

**7b. Wrap evaluator phase** in a continuation loop (same pattern as `evaluateStageInner`).

**7c. Update 3 call sites** to pass new evaluator signature:
- `planReviewCycleStage` (line ~870) - `continuationEventType: 'plan:evaluate:continuation'`
- `architectureReviewCycleStage` (line ~940) - `continuationEventType: 'plan:architecture:evaluate:continuation'`
- `cohesionReviewCycleStage` (line ~1113) - `continuationEventType: 'plan:cohesion:evaluate:continuation'`

#### 8. CLI display (`src/cli/display.ts`)

Add cases for the 4 new continuation event types to update spinner text (matching the pattern at lines 143-146 and 264-267).

#### 9. Tests (`test/evaluator-continuation.test.ts`, new file)

Using `StubBackend`, no mocks:
- `builderEvaluate` re-throws `error_max_turns` (enables pipeline retry)
- `builderEvaluate` catches non-max-turns errors as `build:failed` (unchanged behavior)
- `builderEvaluate` includes continuation context in prompt when provided
- `builderEvaluate` excludes continuation context when not provided
- `runPlanEvaluate` includes continuation context in prompt when provided
- `build:evaluate:continuation` and `plan:evaluate:continuation` are valid `EforgeEvent` types
- `AGENT_MAX_CONTINUATIONS_DEFAULTS` has entries for evaluator roles

## Scope

**In scope:**
- Continuation loops for build-phase evaluator (`evaluateStageInner`)
- Continuation loops for plan-phase evaluators (`runReviewCycle` - plan, architecture, cohesion)
- 4 new continuation event types
- Agent defaults for evaluator max continuations
- Continuation context threading through `BuilderOptions` and `PlanPhaseEvaluatorOptions`
- Prompt template updates for `evaluator.md` and `plan-evaluator.md`
- CLI display updates for new event types
- New test file for evaluator continuation behavior

**Out of scope:**
- Extracting a generic continuation helper across builder/planner/evaluator loops
- Changing git checkpoint behavior (evaluators don't need it)
- Changing default continuation counts for builders or planners

## Acceptance Criteria

- `pnpm type-check` passes with no type errors from new event types and option fields
- `pnpm test` passes - all existing tests pass and new `test/evaluator-continuation.test.ts` tests pass
- `builderEvaluate` re-throws `error_max_turns` errors (enabling pipeline retry) while still catching non-max-turns errors as `build:failed`
- `builderEvaluate` and `runPlanEvaluate` include continuation context in prompts when provided and exclude it when not provided
- `AGENT_MAX_CONTINUATIONS_DEFAULTS` has entries for `evaluator`, `plan-evaluator`, `cohesion-evaluator`, and `architecture-evaluator` (all defaulting to 1)
- `evaluateStageInner` wraps the evaluator call in a continuation loop that checks for unstaged changes on `error_max_turns` and yields `build:evaluate:continuation` events
- `runReviewCycle` wraps the evaluator phase in a continuation loop, with all 3 call sites (`planReviewCycleStage`, `architectureReviewCycleStage`, `cohesionReviewCycleStage`) passing the appropriate `continuationEventType`
- CLI display shows spinner text updates for all 4 new continuation event types
- Manual verification: triggering a build with an evaluator that hits max_turns produces continuation events visible in CLI output and monitor UI
