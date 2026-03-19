---
id: plan-01-cache-tokens
name: Include Cached Input Tokens in Metrics and Surface Cache Breakdown
depends_on: []
branch: fix-include-cached-input-tokens-in-metrics-surface-cache-breakdown/cache-tokens
---

# Include Cached Input Tokens in Metrics and Surface Cache Breakdown

## Architecture Context

The SDK's `ModelUsage` type exposes three input token categories: `inputTokens` (non-cached), `cacheReadInputTokens`, and `cacheCreationInputTokens`. Today `extractResultData()` only reads `inputTokens`, so reported totals dramatically undercount actual usage when prompt caching is active. The fix sums all three categories at the extraction point and threads the cache breakdown through every downstream consumer - the `AgentResultData` type, eval metrics, monitor UI, and Langfuse traces.

## Implementation

### Overview

Add `cacheRead` and `cacheCreation` fields to `AgentResultData.usage` and per-model `modelUsage`. Fix `extractResultData()` to sum all three input token categories. Propagate the new fields through the eval build-result aggregation, eval summary table, monitor UI state/cards/event-cards, and Langfuse trace usage details. Update tests to cover the new fields.

### Key Decisions

1. `usage.input` becomes the **total** of all three categories (uncached + cacheRead + cacheCreation) so existing consumers that only read `input` get correct totals without changes.
2. Cache fields use `cacheRead` / `cacheCreation` naming (matching the SDK's camelCase convention without the `InputTokens` suffix) for brevity in the event type.
3. Per-model `modelUsage` entries gain `cacheReadInputTokens` and `cacheCreationInputTokens` fields matching the SDK's naming exactly, since these mirror the SDK `ModelUsage` shape.

## Scope

### In Scope
- Fix `extractResultData()` to sum all three input token categories
- Add `cacheRead` and `cacheCreation` to `AgentResultData.usage`
- Add `cacheReadInputTokens` and `cacheCreationInputTokens` to per-model `modelUsage` entries
- Propagate cache fields through eval metrics aggregation and summary table
- Surface cache hit % in monitor UI (summary card subtitle, per-agent event card detail)
- Add cache fields to Langfuse trace usage details
- Update sdk-mapping tests and stub-backend

### Out of Scope
- Changing cost calculation logic
- Adding new monitor UI pages or components

## Files

### Modify
- `src/engine/events.ts` — Add `cacheRead` and `cacheCreation` to `AgentResultData.usage`, add `cacheReadInputTokens` and `cacheCreationInputTokens` to `modelUsage` record type
- `src/engine/backends/claude-sdk.ts` — Fix `extractResultData()` to read `cacheReadInputTokens` and `cacheCreationInputTokens` from SDK `ModelUsage`, sum into `inputTokens`, and populate new fields
- `eval/lib/build-result.ts` — Add `cacheRead` and `cacheCreation` to `AgentAggregate`, `ModelAggregate`, `Metrics.tokens`; accumulate in aggregation loops
- `eval/run.sh` — Add `Cache` column to summary table showing `cacheRead / input * 100`; add cache stats to totals line
- `src/monitor/ui/src/lib/reducer.ts` — Add `cacheRead` and `cacheCreation` to `RunState`; accumulate in agent:result handler; expose via `getSummaryStats`
- `src/monitor/ui/src/components/common/summary-cards.tsx` — Accept `cacheRead`/`tokensIn` props; show cache hit % as subtitle under TOKENS card value
- `src/monitor/ui/src/components/timeline/event-card.tsx` — Show cache hit % after "Tokens: X in / Y out" in agent:result detail; show per-model cache breakdown
- `src/engine/pipeline.ts` — Add `cacheRead` and `cacheCreation` per-model entries to `usageDetails` for Langfuse
- `test/sdk-mapping.test.ts` — Add `cacheReadInputTokens` and `cacheCreationInputTokens` to mock `modelUsage`; update expected `usage` assertion to include cache totals in input and new cache fields
- `test/stub-backend.ts` — Add `cacheRead: 0, cacheCreation: 0` to `STUB_RESULT.usage`

## Verification

- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` exits with code 0
- [ ] `test/sdk-mapping.test.ts` "aggregates tokens across multiple models" test asserts `usage.cacheRead` and `usage.cacheCreation` match summed mock values
- [ ] `test/sdk-mapping.test.ts` mock `modelUsage` entries include non-zero `cacheReadInputTokens` and `cacheCreationInputTokens`
- [ ] `test/sdk-mapping.test.ts` expected `usage.input` equals sum of all three token categories across models
- [ ] `test/stub-backend.ts` `STUB_RESULT.usage` includes `cacheRead: 0` and `cacheCreation: 0`
- [ ] `AgentResultData.usage` type in `events.ts` has `cacheRead: number` and `cacheCreation: number` fields
- [ ] `AgentResultData.modelUsage` value type has `cacheReadInputTokens: number` and `cacheCreationInputTokens: number` fields
- [ ] `extractResultData()` in `claude-sdk.ts` reads `usage.cacheReadInputTokens` and `usage.cacheCreationInputTokens` from SDK result
- [ ] Monitor `RunState` includes `cacheRead` and `cacheCreation` number fields
- [ ] Monitor TOKENS summary card renders cache hit percentage when `cacheRead > 0`
- [ ] Monitor event-card agent:result detail includes "(X% cached)" when cache data is present
- [ ] Langfuse `usageDetails` includes `${model}:cacheRead` and `${model}:cacheCreation` entries
- [ ] Eval `Metrics.tokens` type includes `cacheRead` and `cacheCreation` fields
- [ ] Eval summary table header includes a `Cache` column
