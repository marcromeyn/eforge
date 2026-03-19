---
title: Fix: Include cached input tokens in metrics + surface cache breakdown
created: 2026-03-19
status: pending
---

## Problem / Motivation

The eval summary and monitor UI both report ~8k tokens for a 3-minute multi-agent run. The cost ($0.74) is correct, but the token count only shows non-cached input tokens. With prompt caching, nearly all input hits cache — the real total is orders of magnitude higher.

Root cause: `extractResultData()` reads `modelUsage.inputTokens` which only counts non-cached tokens. The SDK's `ModelUsage` type also has `cacheReadInputTokens` and `cacheCreationInputTokens` that we ignore.

Beyond fixing the total, the cache breakdown is worth surfacing for backend/model comparison and prompt structure optimization.

## Goal

Include cached input tokens in all token metrics so reported totals reflect actual usage, and surface the cache breakdown (read vs. creation) across the eval summary, monitor UI, and Langfuse traces.

## Approach

Sum all three input token categories (`inputTokens` + `cacheReadInputTokens` + `cacheCreationInputTokens`) in `extractResultData()` and propagate the cache breakdown through every layer that consumes token metrics:

### 1. `src/engine/events.ts` — AgentResultData type (lines 67-77)

Add cache breakdown to `usage` and `modelUsage`:

```typescript
usage: {
  input: number;         // total: uncached + cacheRead + cacheCreation
  output: number;
  total: number;
  cacheRead: number;
  cacheCreation: number;
};
modelUsage: Record<string, {
  inputTokens: number;   // total: uncached + cacheRead + cacheCreation
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD: number;
}>;
```

### 2. `src/engine/backends/claude-sdk.ts` — extractResultData() (lines 250-286)

Sum all three input token categories per model. Track cache totals:

```typescript
const cacheRead = usage.cacheReadInputTokens ?? 0;
const cacheCreation = usage.cacheCreationInputTokens ?? 0;
const modelInput = usage.inputTokens + cacheRead + cacheCreation;
inputTokens += modelInput;
cacheReadTotal += cacheRead;
cacheCreationTotal += cacheCreation;

modelUsage[model] = {
  inputTokens: modelInput,
  outputTokens: usage.outputTokens,
  cacheReadInputTokens: cacheRead,
  cacheCreationInputTokens: cacheCreation,
  costUSD: usage.costUSD,
};
```

### 3. `eval/lib/build-result.ts` — metrics aggregation

Add `cacheRead` and `cacheCreation` to:
- `AgentAggregate` interface (lines 35-43)
- `ModelAggregate` interface (lines 45-49)
- `Metrics.tokens` interface (line 53)
- Aggregation loops (lines 106-147)

### 4. `eval/run.sh` — show cache hit rate in summary table (lines 68-79)

Add a `Cache` column computed as `cacheRead / input * 100`:

```
Scenario                   Eforge  Validate  Tokens   Cache   Cost     Duration
todo-api-health-check      PASS    PASS      312k     99.2%   $0.74    3m 7s
```

Also add cache stats to the totals line.

### 5. Monitor UI — surface cache data

**`src/monitor/ui/src/lib/reducer.ts`** (lines 99-103):
- Track `cacheRead` and `cacheCreation` in session state alongside `tokensIn`/`tokensOut`

**`src/monitor/ui/src/components/common/summary-cards.tsx`** (lines 94-100):
- Show cache hit % under the TOKENS card value (small subtitle text)

**`src/monitor/ui/src/components/timeline/event-card.tsx`** (lines 129, 134-136):
- Line 129: Add cache hit % after "Tokens: X in / Y out", e.g. "(98% cached)"
- Lines 134-136: Show cache breakdown in per-model detail

### 6. `src/engine/pipeline.ts` — Langfuse traces (lines 176-185)

Add cache fields to `usageDetails` so they appear in Langfuse generation views:

```typescript
usageDetails[`${model}:cacheRead`] = mu.cacheReadInputTokens;
usageDetails[`${model}:cacheCreation`] = mu.cacheCreationInputTokens;
```

### 7. Tests

**`test/sdk-mapping.test.ts`** (lines 115-153):
- Add `cacheReadInputTokens` and `cacheCreationInputTokens` to mock `modelUsage`
- Update expected `usage` assertion to include cache totals in input and new cache fields

**`test/stub-backend.ts`** (line 29):
- Add `cacheRead: 0, cacheCreation: 0` to STUB_RESULT usage

## Scope

**In scope:**
- Fixing `extractResultData()` to sum all three input token categories
- Adding `cacheRead` and `cacheCreation` fields to `AgentResultData.usage` and per-model `modelUsage`
- Propagating cache breakdown through eval metrics aggregation (`eval/lib/build-result.ts`)
- Adding cache hit rate column to eval summary table (`eval/run.sh`)
- Surfacing cache data in the monitor UI (session summary card, per-agent event cards)
- Adding cache fields to Langfuse trace usage details (`src/engine/pipeline.ts`)
- Updating tests (`test/sdk-mapping.test.ts`, `test/stub-backend.ts`)

**Files to modify:**
1. `src/engine/events.ts`
2. `src/engine/backends/claude-sdk.ts`
3. `eval/lib/build-result.ts`
4. `eval/run.sh`
5. `src/monitor/ui/src/lib/reducer.ts`
6. `src/monitor/ui/src/components/common/summary-cards.tsx`
7. `src/monitor/ui/src/components/timeline/event-card.tsx`
8. `src/engine/pipeline.ts`
9. `test/sdk-mapping.test.ts`
10. `test/stub-backend.ts`

**Out of scope:**
- N/A

## Acceptance Criteria

1. `pnpm type-check` passes — type changes propagate cleanly across all layers
2. `pnpm test` passes — all tests pass including updated sdk-mapping and stub-backend assertions
3. Running an eval scenario produces realistic token counts (100k+ range) and cache hit % appears in the summary table
4. Monitor UI TOKENS card shows corrected total with cache %, event cards show per-agent cache breakdown
5. Langfuse trace generation usage details include `cacheRead` and `cacheCreation` fields per model
