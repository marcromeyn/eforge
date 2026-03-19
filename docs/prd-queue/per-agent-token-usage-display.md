---
title: Per-Agent Token Usage Display
created: 2026-03-19
status: pending
---

## Problem / Motivation

The monitor dashboard Gantt bars and eval summary table show only aggregate token data. Per-agent token breakdown already exists in `agent:result` events and in eval `result.json` (`metrics.agents`) - it's just not surfaced to the user. The data is there but invisible, making it harder to understand cost and performance at the agent level.

## Goal

Wire existing per-agent token usage data into the monitor dashboard UI (Gantt bar labels and tooltips) and the eval output (per-agent breakdown table and `cacheRead` in summary totals).

## Approach

Two parallel tracks, both consuming data that already flows through the system:

### Part 1: Monitor Dashboard - Token info on Gantt bars

**1.1 Extend `AgentThread` in `src/monitor/ui/src/lib/reducer.ts`**

Add to the `AgentThread` interface:
```typescript
inputTokens: number | null;
outputTokens: number | null;
totalTokens: number | null;
cacheRead: number | null;
costUsd: number | null;
numTurns: number | null;
```

**1.2 Update `processEvent()` in `reducer.ts`**

- In the `agent:start` handler (~line 196): initialize new fields as `null`
- In the `agent:result` handler (~line 214): populate token fields from `event.result.usage` alongside the existing `durationMs` assignment

**1.3 Update tooltip in `src/monitor/ui/src/components/pipeline/thread-pipeline.tsx`**

Add `formatNumber` import from `@/lib/format`. In the `PlanRow` tooltip, after the duration line, add:
- Token count: `"{formatNumber(totalTokens)} tokens (X% cached)"` (when `totalTokens != null`)
- Cost: `"$0.1234"` (when `costUsd != null && costUsd > 0`)

Running agents show no token info (fields remain `null` until `agent:result` fires).

**1.4 Update bar label in `thread-pipeline.tsx`**

Append compact token count after agent name on the bar itself:
```tsx
{thread.agent}
{thread.totalTokens != null && <span className="opacity-50 ml-1">{formatNumber(thread.totalTokens)}</span>}
```

The existing `truncate` class clips gracefully on narrow bars.

### Part 2: Eval Results - Per-agent breakdown

**2.1 Add `cacheRead` to summary.json totals in `eval/run.sh`**

The summary aggregation (~line 216) currently omits `cacheRead`. Add it to the accumulation loop and `totals.tokens` object.

**2.2 Add per-agent breakdown table in `eval/run.sh` `print_summary()`**

After the main scenario table (before the closing separator), aggregate `metrics.agents` across all scenarios and print:

```
Agent Breakdown:
Agent                    Count   Tokens    Cache     Cost      Duration
---------------------------------------------------------------------------
planner                  1       250k      94%       $0.32     1m 12s
builder                  1       180k      91%       $0.25     0m 45s
reviewer                 1       120k      89%       $0.15     0m 30s
...
```

Sorted by total tokens descending.

## Scope

**In scope:**
- `src/monitor/ui/src/lib/reducer.ts` - `AgentThread` type + `processEvent()`
- `src/monitor/ui/src/components/pipeline/thread-pipeline.tsx` - tooltip + bar label
- `eval/run.sh` - `print_summary()` + summary totals

**Out of scope:**
- N/A

## Acceptance Criteria

1. `pnpm build` completes cleanly
2. `pnpm type-check` reports no type errors
3. Running `eforge run` on a test PRD and opening the monitor dashboard shows:
   - Completed agent bars display token count in the bar label
   - Hovering over a bar shows tokens (with cache %), cost, and duration in the tooltip
   - Running agents show no token data until completion (fields remain `null`)
4. Running `./eval/run.sh` on a scenario produces:
   - `cacheRead` included in `summary.json` totals
   - Per-agent breakdown table printed after the main scenario summary table, sorted by total tokens descending
