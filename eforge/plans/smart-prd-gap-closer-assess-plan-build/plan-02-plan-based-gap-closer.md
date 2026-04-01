---
id: plan-02-plan-based-gap-closer
name: Plan-Based Gap Closer Execution
dependsOn: [plan-01-enhanced-validation]
branch: smart-prd-gap-closer-assess-plan-build/plan-based-gap-closer
---

# Plan-Based Gap Closer Execution

## Architecture Context

After plan-01 adds structured assessment data and a viability gate, this plan replaces the simple one-shot gap closer with a two-phase approach: (1) a lightweight plan-generation agent produces a markdown plan scoped to the gaps, then (2) that plan is executed through the existing `runBuildPipeline` infrastructure (implement stage with continuation/handoff + review-fix cycle). All gap-close build events use `planId: 'gap-close'` so the monitor UI renders a distinct "PRD Gap Close" swimlane.

The orchestrator already re-runs `validate(ctx)` when `gapClosePerformed` is true (line 174 of `orchestrator.ts`), so no changes are needed for post-gap-close validation.

## Implementation

### Overview

Rewrite `runGapCloser` from a single agent call into a two-stage pipeline: plan generation followed by build execution. The plan generation agent receives gaps + PRD + codebase context and outputs a markdown plan. That plan is wrapped in a `BuildStageContext` with `planId: 'gap-close'` and executed via `runBuildPipeline` with `['implement', 'review-cycle']` stages. The gap closer prompt is rewritten to produce plan output instead of direct code changes. The monitor UI recognizes `planId: 'gap-close'` for distinct swimlane labeling.

### Key Decisions

1. **Plan generation uses a dedicated agent call (maxTurns: 20), separate from execution.** The plan-gen agent produces structured output; the build pipeline executes it. This gives the builder continuation/handoff support (maxTurns: 50 with checkpointing) that the old 30-turn one-shot lacked.
2. **`planId: 'gap-close'` is a synthetic plan ID** - it doesn't correspond to a plan file on disk. The `PlanFile` object is constructed in memory from the generated plan markdown. The `filePath` field points to a temporary path or empty string since the plan isn't persisted.
3. **The `GapCloser` type signature changes** to accept additional context (backend, pipeline, tracing, config) so it can construct a `BuildStageContext`. This means updating the callback creation in `eforge.ts` and the type in `orchestrator.ts`.
4. **Gap closing runs once** - the `gapClosePerformed` flag in `PhaseContext` already prevents re-entry. No additional guarding is needed.
5. **Monitor swimlane** - the existing `getEventPlanId()` function in `event-card.tsx` already extracts `planId` from any event that has it. By adding `planId: 'gap-close'` to all `build:*` events emitted during gap-close execution, the timeline groups them automatically. Only the label needs special-casing.

## Scope

### In Scope
- Rewrite `runGapCloser` to plan-generation + `runBuildPipeline` execution
- Rewrite `gap-closer.md` prompt for plan generation output
- Update `GapCloser` type to carry build pipeline context
- Update gap closer closure in `eforge.ts`
- Add `'gap-closer'` to `AGENT_ROLE_DEFAULTS` with `maxTurns: 20` for plan generation
- Update `gap_close:start` and `gap_close:complete` events to carry optional metadata
- Monitor UI: label `planId: 'gap-close'` as "PRD Gap Close" in event card and thread pipeline
- Thread pipeline: add gap-closer agent to `AGENT_COLORS` and `AGENT_TO_STAGE` mappings

### Out of Scope
- PRD validator output changes (completed in plan-01)
- Viability gate (completed in plan-01)
- Persisting the generated plan to disk
- Configurable build stages for gap closing (always implement + review-cycle)
- Recursive gap closing

## Files

### Modify
- `src/engine/events.ts` - Update `gap_close:start` to include optional `{ gapCount: number; completionPercent?: number }`. Update `gap_close:complete` to include optional `{ passed: boolean }`. These carry context for display without changing the discriminated union shape.
- `src/engine/orchestrator.ts` - Update `GapCloser` type signature to accept a context object: `(cwd: string, gaps: PrdValidationGap[], completionPercent?: number) => AsyncGenerator<EforgeEvent>`. The closure in `eforge.ts` captures everything else it needs.
- `src/engine/agents/gap-closer.ts` - Major rewrite. Export `GapCloserContext` interface carrying: `backend`, `cwd`, `gaps`, `prdContent`, `completionPercent`, `pipelineContext` (for constructing `BuildStageContext`), `verbose`, `abortController`. The `runGapCloser` generator: (1) emits `gap_close:start` with gap count, (2) runs plan-gen agent (maxTurns: 20, 'coding' tools) with the gap-closer prompt, (3) parses the markdown plan from agent output, (4) constructs a `BuildStageContext` with `planId: 'gap-close'`, the merge worktree path, a synthetic `PlanFile`, build stages `['implement', 'review-cycle']`, and default review config, (5) yields all events from `runBuildPipeline(buildCtx)`, (6) emits `gap_close:complete`. Error handling: if plan generation fails or returns no plan, emit `gap_close:complete` with `passed: false` and return (non-fatal).
- `src/engine/prompts/gap-closer.md` - Rewrite from "make code changes" to "generate a fix plan". The agent receives gaps + PRD + instructions to output a markdown plan with: overview section, files to modify with descriptions of changes, and verification criteria. The plan format matches the builder's expected input. Remove the commit instructions since the builder handles commits.
- `src/engine/eforge.ts` - Update the `gapCloser` closure (lines 650-681). The closure now passes additional context to `runGapCloser`: `backend`, `pipeline` (the build pipeline composition), `tracing`, `config`, `orchConfig`, `planFileMap`, `planSet`, `verbose`, `abortController`. It constructs a `GapCloserContext` and delegates. Update the `GapCloser` type import and the call signature to pass `completionPercent` from the `prd_validation:complete` event.
- `src/engine/orchestrator/phases.ts` - Update the `prdValidate` function to pass `completionPercent` from the `prd_validation:complete` event to `ctx.gapCloser()`. Extract the completionPercent from the event and forward it: `yield* ctx.gapCloser(ctx.mergeWorktreePath, event.gaps, event.completionPercent)`.
- `src/engine/pipeline.ts` - Add `'gap-closer': { maxTurns: 20 }` to `AGENT_ROLE_DEFAULTS` (for the plan generation call; the builder during execution uses its own default of 50).
- `src/monitor/ui/src/components/timeline/event-card.tsx` - In `eventSummary`: handle `gap_close:start` to show "Gap closing: N gap(s)" when gapCount is available. In the planId rendering section, when `planId === 'gap-close'`, display "PRD Gap Close" instead of the raw planId.
- `src/monitor/ui/src/components/pipeline/thread-pipeline.tsx` - Add `'gap-closer'` to `AGENT_COLORS` map with a distinct color. Add `'gap-closer'` to `AGENT_TO_STAGE` mapping as `'gap-close'`. In `abbreviatePlanId`, return "Gap Close" when the planId is `'gap-close'`.
- `test/gap-closer.test.ts` - Rewrite tests for the new two-stage flow. Test: (1) plan generation agent is called with correct prompt and maxTurns: 20, (2) generated plan is passed to `runBuildPipeline` with `planId: 'gap-close'` and `['implement', 'review-cycle']` stages, (3) `gap_close:start` event includes gapCount, (4) `gap_close:complete` event includes passed status, (5) plan generation failure emits `gap_close:complete` with `passed: false` without calling runBuildPipeline, (6) abort errors propagate.

## Verification

- [ ] `pnpm type-check` passes with no errors
- [ ] `pnpm test` passes - gap-closer tests validate the two-stage flow
- [ ] When `runGapCloser` is called, it emits `gap_close:start` with `gapCount` matching the number of gaps provided
- [ ] The plan generation agent receives a prompt containing gap descriptions and PRD content
- [ ] The plan generation agent runs with `maxTurns: 20` (from `AGENT_ROLE_DEFAULTS['gap-closer']`)
- [ ] The `BuildStageContext` passed to `runBuildPipeline` has `planId: 'gap-close'`
- [ ] The `BuildStageContext.build` contains `['implement', 'review-cycle']`
- [ ] All `build:*` events emitted during gap-close execution carry `planId: 'gap-close'`
- [ ] When plan generation fails (agent produces no parseable plan), `gap_close:complete` is emitted with `passed: false` and `runBuildPipeline` is not called
- [ ] In the monitor UI, events with `planId === 'gap-close'` display "PRD Gap Close" as the label
- [ ] `abbreviatePlanId('gap-close')` returns "Gap Close" in thread-pipeline.tsx
- [ ] The `GapCloser` type accepts `completionPercent` as an optional third argument
