---
id: plan-01-enhanced-validation
name: Enhanced PRD Validation Output and Viability Gate
dependsOn: []
branch: smart-prd-gap-closer-assess-plan-build/enhanced-validation
---

# Enhanced PRD Validation Output and Viability Gate

## Architecture Context

The PRD validator currently outputs a flat list of `{ requirement, explanation }` gaps with no scope assessment. The orchestrator blindly attempts gap closing regardless of how much work remains. This plan adds structured assessment data (completion percentage, per-gap complexity) to the validator output and introduces a viability gate that fails builds when too much work remains for fix-forward.

The orchestrator already re-runs validation after gap closing (line 174 of `orchestrator.ts`), so post-gap-close validation is covered.

## Implementation

### Overview

Extend the PRD validator's structured output to include `completionPercent` (0-100) and per-gap `complexity` ('trivial' | 'moderate' | 'significant'). Add a configurable viability threshold to `OrchestratorOptions` and `PhaseContext`. In the `prdValidate` phase, check `completionPercent` against the threshold before attempting gap closing. Update CLI and monitor UI to display the new assessment data.

### Key Decisions

1. `complexity` is optional on `PrdValidationGap` to maintain backward compatibility with any existing serialized data. `completionPercent` is optional on the `prd_validation:complete` event for the same reason.
2. The viability threshold defaults to 75 and is configurable via `OrchestratorOptions.minCompletionPercent`. This keeps the gate tunable without code changes.
3. The `parseGaps` function extracts `completionPercent` from the top-level JSON object alongside `gaps`. It falls back to `undefined` if not present (agent output is best-effort).
4. Display changes are additive - existing gap display still works, enriched with new fields when available.

## Scope

### In Scope
- `PrdValidationGap.complexity` optional field
- `completionPercent` on `prd_validation:complete` event
- Updated `parseGaps` to extract both new fields
- Updated PRD validator prompt requesting structured assessment
- `minCompletionPercent` on `OrchestratorOptions` and `PhaseContext`
- Viability gate in `prdValidate` phase
- CLI display of completion % and complexity breakdown
- Monitor event card display of completion %

### Out of Scope
- Changes to the gap closer agent itself (plan-02)
- Monitor UI swimlane for gap-close work (plan-02)
- Recursive gap closing logic

## Files

### Modify
- `src/engine/events.ts` - Add optional `complexity: 'trivial' | 'moderate' | 'significant'` to `PrdValidationGap` interface (lines 12-15). Add optional `completionPercent?: number` to the `prd_validation:complete` event variant (line 242).
- `src/engine/agents/prd-validator.ts` - Update `parseGaps` (lines 71-95) to return `{ gaps, completionPercent }` instead of just gaps. Extract `completionPercent` from parsed JSON top-level. Extract optional `complexity` from each gap object. Update `runPrdValidator` to pass `completionPercent` into the emitted `prd_validation:complete` event.
- `src/engine/prompts/prd-validator.md` - Add instructions requesting the agent output `completionPercent` (0-100 integer) at the top level of the JSON block and `complexity` ('trivial', 'moderate', 'significant') per gap. Provide definitions: trivial = missing log line or config tweak, moderate = missing function or handler, significant = missing subsystem or major feature path.
- `src/engine/orchestrator.ts` - Add `minCompletionPercent?: number` to `OrchestratorOptions` (after `gapCloser` field). Pass it through to `PhaseContext` construction.
- `src/engine/orchestrator/phases.ts` - Add `minCompletionPercent: number` to `PhaseContext` (with default 75). In `prdValidate`, after receiving `prd_validation:complete` with gaps, check `event.completionPercent`: if defined and below `ctx.minCompletionPercent`, set `state.status = 'failed'`, emit a descriptive log event, and skip gap closing. Only proceed to gap closing when completionPercent is undefined (backward compat) or >= threshold.
- `src/cli/display.ts` - In the `prd_validation:complete` handler (lines 675-683), append completion percentage to the spinner message (e.g., "PRD Validation failed: 85% complete, 3 gap(s) found"). Below the gap list, show complexity breakdown if any gaps have complexity (e.g., "  1 trivial, 2 moderate").
- `src/monitor/ui/src/components/timeline/event-card.tsx` - In `eventSummary` (line 87), include completionPercent when available (e.g., "PRD Validation: 85% complete, 3 gap(s) found"). In `eventDetail` (lines 176-183), include per-gap complexity in the detail text when present.
### Create
- `test/prd-validator.test.ts` - Add tests for `parseGaps` with the new `completionPercent` and `complexity` fields: JSON with both fields present, JSON with missing fields (backward compat), JSON with invalid complexity values (ignored).

## Verification

- [ ] `pnpm type-check` passes with no errors
- [ ] `pnpm test` passes - existing prd-validator tests still pass
- [ ] `parseGaps('{"completionPercent": 85, "gaps": [{"requirement": "x", "explanation": "y", "complexity": "moderate"}]}')` returns `{ gaps: [{ requirement: "x", explanation: "y", complexity: "moderate" }], completionPercent: 85 }`
- [ ] `parseGaps('{"gaps": [{"requirement": "x", "explanation": "y"}]}')` returns `{ gaps: [{ requirement: "x", explanation: "y" }], completionPercent: undefined }` (backward compat)
- [ ] Invalid complexity values (e.g., `"complexity": "extreme"`) are stripped from parsed gaps
- [ ] `OrchestratorOptions.minCompletionPercent` defaults to 75 when not provided
- [ ] In `prdValidate`, when `completionPercent` is 60 and threshold is 75, `state.status` is set to `'failed'` without invoking the gap closer
- [ ] In `prdValidate`, when `completionPercent` is 80 and threshold is 75, gap closing proceeds
- [ ] In `prdValidate`, when `completionPercent` is undefined, gap closing proceeds (backward compat)
