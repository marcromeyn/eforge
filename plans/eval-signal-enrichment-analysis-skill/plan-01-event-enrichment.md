---
id: plan-01-event-enrichment
name: Enrich Evaluate Complete Events with Verdict Details
depends_on: []
branch: eval-signal-enrichment-analysis-skill/event-enrichment
---

# Enrich Evaluate Complete Events with Verdict Details

## Architecture Context

The `build:evaluate:complete`, `plan:evaluate:complete`, `plan:architecture:evaluate:complete`, and `plan:cohesion:evaluate:complete` events currently emit only aggregated counts (`accepted`, `rejected`). The parsed verdict data (file, action, reason) is already available in both `builder.ts` and `plan-evaluator.ts` via `parseEvaluationBlock()` but is discarded after counting. This plan adds an optional `verdicts` field to carry the full verdict details through the event stream, enabling downstream consumers (eval harness, monitor) to analyze reviewer calibration.

## Implementation

### Overview

Add an optional `verdicts` array to four evaluate:complete event types in the `EforgeEvent` union, then include the parsed verdict data when yielding those events in `builder.ts` and `plan-evaluator.ts`. Update the existing agent wiring test to assert the new field.

### Key Decisions

1. The `verdicts` field is optional (`verdicts?: ...`) so existing consumers that destructure only `accepted`/`rejected` continue to work without changes. This is a purely additive, non-breaking type change.
2. The verdict shape in the event uses `{ file: string; action: 'accept' | 'reject' | 'review'; reason: string }` - a subset of the full `EvaluationVerdict` type. Fields like `evidence` and `hunk` are omitted from the event payload to keep event size manageable and because they are not needed by the eval harness. If needed later, they can be added.
3. The plan-level events (`plan:evaluate:complete`, `plan:architecture:evaluate:complete`, `plan:cohesion:evaluate:complete`) share a single `runEvaluate()` function in `plan-evaluator.ts`, so all three get the enrichment from one code change.

## Scope

### In Scope
- Adding optional `verdicts` field to `build:evaluate:complete` event type in `events.ts`
- Adding optional `verdicts` field to `plan:evaluate:complete`, `plan:architecture:evaluate:complete`, and `plan:cohesion:evaluate:complete` event types in `events.ts`
- Including parsed verdicts in the event yield in `builder.ts` (around line 193)
- Including parsed verdicts in the event yield in `plan-evaluator.ts` (around line 162)
- Updating the existing `builderEvaluate wiring` test to assert verdicts are present

### Out of Scope
- Monitor UI changes to display verdicts (future work)
- Eval harness changes to consume verdicts (separate repo)
- Including `evidence` or `hunk` fields in the event payload

## Files

### Modify
- `src/engine/events.ts` - Add optional `verdicts` field typed as `Array<{ file: string; action: 'accept' | 'reject' | 'review'; reason: string }>` to the four evaluate:complete event variants (lines 147, 153, 159, 176)
- `src/engine/agents/builder.ts` - Include `verdicts: verdicts.map(v => ({ file: v.file, action: v.action, reason: v.reason }))` in the `build:evaluate:complete` event yield (around line 193)
- `src/engine/agents/plan-evaluator.ts` - Include `verdicts: verdicts.map(v => ({ file: v.file, action: v.action, reason: v.reason }))` in the evaluate:complete event yield in `runEvaluate()` (around line 162). Also add the same mapping in the error catch block (line 154) with an empty array.
- `test/agent-wiring.test.ts` - Add assertion that `build:evaluate:complete` event contains the expected verdicts array with correct file/action/reason values in the `builderEvaluate wiring` test

## Verification

- [ ] `pnpm type-check` passes with no errors
- [ ] `pnpm test` passes with no regressions
- [ ] The `build:evaluate:complete` event type in `events.ts` has an optional `verdicts` field typed as `Array<{ file: string; action: 'accept' | 'reject' | 'review'; reason: string }>`
- [ ] The `plan:evaluate:complete`, `plan:architecture:evaluate:complete`, and `plan:cohesion:evaluate:complete` event types have the same optional `verdicts` field
- [ ] The `builderEvaluate wiring` test asserts that `complete!.verdicts` is an array of 4 elements matching the test fixture verdicts
- [ ] The verdicts field maps only `file`, `action`, and `reason` from `EvaluationVerdict` (not `evidence` or `hunk`)
