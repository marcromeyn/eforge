---
id: plan-01-prompt-parser-foundations
name: Prompt, Parser, and Type Foundations
depends_on: []
branch: prd-agent-prompt-gaps/prompt-parser-foundations
---

# Prompt, Parser, and Type Foundations

## Architecture Context

This plan implements R1 (vague criteria detection), R2 (issue triage), R3 (structured evaluation evidence), R4 (per-hunk evaluation), and R6 (plan reviewer tool access bug). These are all foundational changes — prompt text updates, type additions, parser enhancements — that must land before R5 (cohesion review) can build on them. The cohesion review agents reuse the structured evidence format from R3, the `parseEvaluationBlock` parser from R3/R4, and depend on R6's fix to work correctly.

## Implementation

### Overview

Six areas of change:

1. **R1 — Vague criteria detection**: Add banned-words sections to planner, module-planner, and plan-reviewer prompts
2. **R2 — Issue triage in reviewer**: Add triage section to reviewer prompt
3. **R3 — Structured evaluation evidence**: Update evaluator + plan-evaluator prompts, add `EvaluationEvidence` type, enhance `parseEvaluationBlock` parser
4. **R4 — Per-hunk evaluation**: Update evaluator prompt with per-hunk instructions, add optional `hunk` to `EvaluationVerdict`, update parser
5. **R6 — Bug fix**: Change `tools: 'none'` to `tools: 'coding'` in plan-reviewer agent
6. **Tests + exports**: Add parser tests, re-export new types

### Key Decisions

1. **Backwards-compatible parser**: `parseEvaluationBlock` extracts structured child elements (`<staged>`, `<fix>`, `<rationale>`, `<if-accepted>`, `<if-rejected>`) when present, falling back to plain text as `reason`. This avoids breaking existing evaluation flows.
2. **`EvaluationEvidence` is optional on `EvaluationVerdict`**: Existing code that only reads `reason` continues to work. New code can check `evidence` for richer data.
3. **The `<original>` tag in plan-evaluator**: The plan evaluator uses `<original>` instead of `<staged>` (per PRD R3), since it evaluates planner's original artifacts, not staged code. The parser handles both.
4. **Reviewer prompt, not reviewer parser**: R2 only changes the reviewer's prompt instructions. No parser changes needed — triaged-out issues simply won't appear in the XML output.

## Scope

### In Scope
- Prompt text additions for planner.md, module-planner.md, plan-reviewer.md, reviewer.md, evaluator.md, plan-evaluator.md
- `EvaluationEvidence` type definition and `evidence` field on `EvaluationVerdict`
- `hunk` field on `EvaluationVerdict`
- `parseEvaluationBlock` parser enhancements (evidence extraction, hunk extraction)
- Re-export `EvaluationEvidence` from `src/engine/index.ts`
- Plan reviewer `tools: 'none'` → `tools: 'coding'` bug fix
- New tests in `test/xml-parsers.test.ts`

### Out of Scope
- New agent files (cohesion reviewer/evaluator — plan-02)
- New event types (cohesion events — plan-02)
- Changes to `display.ts` (plan-02)
- Changes to `eforge.ts` flow (plan-02)

## Files

### Modify
- `src/engine/prompts/planner.md` — Add "Vague Criteria Patterns" section to Quality Criteria (after line 311) listing banned words with bad-to-good examples
- `src/engine/prompts/module-planner.md` — Add vague criteria ban to Quality Criteria section (after line 95)
- `src/engine/prompts/plan-reviewer.md` — Expand Feasibility description (line 25) to include vague-pattern detection with regex, severity mapping, and concrete replacement examples
- `src/engine/prompts/reviewer.md` — Add "Issue Triage" section between Scope (after line 18) and Review Categories (line 20) with skip rules for generated files, existing mitigations, dev-only code, unreachable paths
- `src/engine/prompts/evaluator.md` — Replace verdict XML format (lines 138-149) with structured child elements (`<staged>`, `<fix>`, `<rationale>`, `<if-accepted>`, `<if-rejected>`). Add per-hunk evaluation instructions (count hunks, evaluate multi-hunk files per-hunk, use `hunk` attribute)
- `src/engine/prompts/plan-evaluator.md` — Replace verdict XML format (lines 118-126) with structured child elements using `<original>` instead of `<staged>`
- `src/engine/agents/builder.ts` — Add `EvaluationEvidence` interface, add `evidence?: EvaluationEvidence` and `hunk?: number` to `EvaluationVerdict`, enhance `parseEvaluationBlock` to extract structured child elements and `hunk` attribute
- `src/engine/agents/plan-reviewer.ts` — Line 51: change `tools: 'none'` to `tools: 'coding'`
- `src/engine/index.ts` — Re-export `EvaluationEvidence` type from builder.ts
- `test/xml-parsers.test.ts` — Add tests for: verdict with all 5 evidence elements, verdict with `<original>` tag, plain-text verdict backwards compat, verdict with `hunk="2"`, verdict without `hunk`

## Verification

- [ ] `pnpm type-check` passes with no errors
- [ ] `pnpm test` passes — all existing tests still pass, plus new tests for structured evidence and per-hunk parsing
- [ ] `parseEvaluationBlock` returns `evidence` with all 5 fields when structured child elements are present in the XML
- [ ] `parseEvaluationBlock` returns `evidence` with `staged` populated from `<original>` tag (plan-evaluator format)
- [ ] `parseEvaluationBlock` returns `undefined` evidence and populated `reason` when only plain text is inside `<verdict>`
- [ ] `parseEvaluationBlock` extracts `hunk: 2` from `<verdict file="..." hunk="2" action="reject">`
- [ ] `parseEvaluationBlock` returns `hunk: undefined` for verdicts without `hunk` attribute
- [ ] `EvaluationEvidence` type is exported from `src/engine/index.ts`
- [ ] `plan-reviewer.ts` runs with `tools: 'coding'` (line 51)
- [ ] `planner.md` contains a "Vague Criteria Patterns" section listing all 17 banned words
- [ ] `module-planner.md` contains vague criteria ban matching planner.md
- [ ] `plan-reviewer.md` Feasibility category includes regex `/\b(appropriate|properly|correctly|should|good|nice|clean|well|efficient)\b/i` and instructions to flag as `warning`/`feasibility`
- [ ] `reviewer.md` has an "Issue Triage" section between Scope and Review Categories with rules for generated files, existing mitigations, dev-only code, and unreachable paths
- [ ] `evaluator.md` verdict format uses `<staged>`, `<fix>`, `<rationale>`, `<if-accepted>`, `<if-rejected>` child elements and documents per-hunk evaluation with `hunk` attribute
- [ ] `plan-evaluator.md` verdict format uses `<original>` instead of `<staged>` with same evidence structure
