---
id: plan-01-xml-parsing-resilience
name: XML Parsing Resilience
depends_on: []
branch: xml-parsing-resilience-prd/xml-parsing-resilience
---

# XML Parsing Resilience

## Architecture Context

All agent-to-engine structured communication goes through hand-rolled regex parsers in `common.ts`, `reviewer.ts`, and `builder.ts`. These parsers use individual `attrs.match(/name="([^"]+)"/)` calls that require double quotes, no extra whitespace, and specific attribute ordering. Failures return `null` or `[]` with no way to distinguish "block absent" from "block malformed." This refactor adds a shared attribute parser, a `ParseResult<T>` discriminated union, and a diagnostic `agent:parse_warning` event — all internal to the engine, no prompt or consumer event contract changes.

## Implementation

### Overview

1. Add `parseAttributes()` utility and `ParseResult<T>` type to `common.ts`
2. Refactor all attribute-based parsers to use `parseAttributes` and return `ParseResult`
3. Add `agent:parse_warning` event type to the discriminated union
4. Update all callers (agent runners) to handle `ParseResult` status and yield `agent:parse_warning` on malformed results
5. Render `agent:parse_warning` in CLI display
6. Add tests for `parseAttributes` and `ParseResult` malformed detection

### Key Decisions

1. `parseAttributes` handles double quotes, single quotes, whitespace around `=`, and arbitrary attribute order — covers common LLM output variations without going full XML parser.
2. `ParseResult<T>` is a discriminated union with `found`, `not-found`, and `malformed` statuses. The `malformed` variant carries `raw` (the matched block text) and `reason` (what went wrong) for diagnostics.
3. `parseGeneratedProfileBlock` already uses JSON-in-XML and doesn't need attribute parsing changes, but adopts `ParseResult` for consistency — its JSON parse failure becomes `malformed` instead of `null`.
4. `agent:parse_warning` is always yielded (not verbose-gated) so it appears in CLI, monitor, and hooks. It's informational — pipeline continues with fallback behavior identical to today's null handling.
5. Callers that currently check `result === null` switch to checking `result.status`. The mapping is: `null`/`[]` → check for `not-found` or `malformed`; `malformed` → yield warning then apply same fallback as today.

## Scope

### In Scope
- `parseAttributes()` shared helper in `common.ts`
- `ParseResult<T>` type in `common.ts`
- Refactor `parseClarificationBlocks`, `parseScopeBlock`, `parseProfileBlock`, `parseModulesBlock` to use `parseAttributes` and return `ParseResult`
- Refactor `parseReviewIssues` (reviewer.ts) to use `parseAttributes` and return `ParseResult<ReviewIssue[]>`
- Refactor `parseEvaluationBlock` (builder.ts) to use `parseAttributes` and return `ParseResult<EvaluationVerdict[]>`
- Refactor `parseGeneratedProfileBlock` to return `ParseResult<GeneratedProfileBlock>`
- `agent:parse_warning` event type in `events.ts`
- Update all callers to handle `ParseResult` and yield warnings on malformed
- CLI display rendering for `agent:parse_warning`
- Tests for `parseAttributes`, `ParseResult` malformed detection, and updated parser signatures

### Out of Scope
- Prompt changes (agent output format stays the same)
- Full XML parser library integration
- Changes to consumer-facing event types (`plan:scope`, `plan:profile`, etc.)
- Monitor UI changes (events are already recorded generically)

## Files

### Modify
- `src/engine/agents/common.ts` — Add `parseAttributes()`, `ParseResult<T>`. Refactor `parseClarificationBlocks` → `ParseResult<ClarificationQuestion[]>`, `parseScopeBlock` → `ParseResult<ScopeDeclaration>`, `parseProfileBlock` → `ParseResult<ProfileSelection>`, `parseModulesBlock` → `ParseResult<ExpeditionModule[]>`, `parseGeneratedProfileBlock` → `ParseResult<GeneratedProfileBlock>`.
- `src/engine/agents/reviewer.ts` — Refactor `parseReviewIssues` → `ParseResult<ReviewIssue[]>` using `parseAttributes`. Update `runReview` to handle `ParseResult` and yield `agent:parse_warning` on malformed.
- `src/engine/agents/builder.ts` — Refactor `parseEvaluationBlock` → `ParseResult<EvaluationVerdict[]>` using `parseAttributes`. Update `builderEvaluate` to handle `ParseResult` and yield `agent:parse_warning` on malformed.
- `src/engine/events.ts` — Add `agent:parse_warning` variant: `{ type: 'agent:parse_warning'; agent: AgentRole; block: string; reason: string; raw: string }`.
- `src/engine/agents/planner.ts` — Update calls to `parseScopeBlock`, `parseProfileBlock`, `parseClarificationBlocks`, `parseGeneratedProfileBlock` to handle `ParseResult`. Yield `agent:parse_warning` on malformed scope/profile/clarification blocks.
- `src/engine/agents/plan-evaluator.ts` — Update `parseEvaluationBlock` call to handle `ParseResult` and yield warning on malformed.
- `src/engine/agents/cohesion-evaluator.ts` — Update `parseEvaluationBlock` call to handle `ParseResult` and yield warning on malformed.
- `src/engine/agents/cohesion-reviewer.ts` — Update `parseReviewIssues` call to handle `ParseResult` and yield warning on malformed.
- `src/engine/agents/plan-reviewer.ts` — Update `parseReviewIssues` call to handle `ParseResult` and yield warning on malformed.
- `src/engine/agents/parallel-reviewer.ts` — Update `parseReviewIssues` calls to handle `ParseResult` and yield warning on malformed.
- `src/engine/agents/assessor.ts` — Update `parseScopeBlock` and `parseProfileBlock` calls to handle `ParseResult` and yield warning on malformed.
- `src/engine/pipeline.ts` — Update `parseModulesBlock` call to handle `ParseResult`.
- `src/engine/index.ts` — Re-export `ParseResult` type.
- `src/cli/display.ts` — Add `agent:parse_warning` case to `renderEvent` switch: yellow warning with block name and reason.
- `test/xml-parsers.test.ts` — Update existing tests for new `ParseResult` return types. Add `parseAttributes` tests (double quotes, single quotes, whitespace, multiple attrs). Add malformed detection tests (scope block present but missing assessment → malformed, scope block absent → not-found, valid scope → found).
- `test/agent-wiring.test.ts` — Verify existing agent wiring tests pass with updated parser signatures. Add test that malformed parse results yield `agent:parse_warning` events.
- `test/dynamic-profile-generation.test.ts` — Update `parseGeneratedProfileBlock` tests for `ParseResult` return type.

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes — all existing tests in `xml-parsers.test.ts`, `agent-wiring.test.ts`, and `dynamic-profile-generation.test.ts` updated and passing
- [ ] `parseAttributes('id="foo"')` returns `{ id: 'foo' }`
- [ ] `parseAttributes("id='foo'")` returns `{ id: 'foo' }`
- [ ] `parseAttributes('id = "foo"')` returns `{ id: 'foo' }`
- [ ] `parseAttributes('id="foo" name="bar"')` returns `{ id: 'foo', name: 'bar' }`
- [ ] `parseScopeBlock` on text with `<scope>` present but missing `assessment` attribute returns `{ status: 'malformed', raw: ..., reason: ... }`
- [ ] `parseScopeBlock` on text with no `<scope>` tag returns `{ status: 'not-found' }`
- [ ] `parseScopeBlock` on valid `<scope assessment="errand">text</scope>` returns `{ status: 'found', value: { assessment: 'errand', justification: 'text' } }`
- [ ] `parseGeneratedProfileBlock` with invalid JSON inside tags returns `{ status: 'malformed', ... }` instead of `null`
- [ ] `renderEvent` handles `agent:parse_warning` without throwing (exhaustive switch remains complete)
- [ ] All callers that previously checked `=== null` or `.length` on parse results now check `.status`
