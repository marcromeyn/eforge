---
title: Real-time Token Usage Updates in Monitor UI
created: 2026-03-31
---

# Real-time Token Usage Updates in Monitor UI

## Problem / Motivation

Token metrics in the monitor dashboard (total tokens, cache hit rate, cost, turns) only update when an agent completes (`agent:result` event). For long-running agents like the builder, this means the dashboard shows stale counts for minutes at a time. The underlying backends already track or receive per-turn data but don't surface it:

- **Pi backend** already tracks per-turn cumulative token counts via `session.getSessionStats()` on each `turn_end` (src/engine/backends/pi.ts:414-429) but doesn't emit them as events.
- **Claude SDK backend** may receive `SDKTaskProgressMessage` events with `{ total_tokens, tool_uses, duration_ms }` during execution, but currently ignores them (falls to default case in `mapSDKMessages`). These have no input/output breakdown and may only fire for spawned subtasks.

## Goal

Provide per-turn intermediate token usage updates so the monitor dashboard metrics feel live, updating incrementally as agents work rather than only on completion.

## Approach

### 1. Add `agent:usage` event type

**File:** `src/engine/events.ts`

Add after the `agent:stop` line (line 224), in the agent lifecycle section:

```typescript
| { type: 'agent:usage'; planId?: string; agentId: string; agent: AgentRole;
    usage: { input: number; output: number; total: number; cacheRead: number; cacheCreation: number };
    costUsd: number; numTurns: number }
```

This carries **cumulative** values for the current agent run (not deltas).

Add `'agent:usage'` to `isAlwaysYieldedAgentEvent()` (line 281) so it passes through verbose gating.

### 2. Emit `agent:usage` from Pi backend

**File:** `src/engine/backends/pi.ts`

In the `turn_end` handler (line 414-429), after updating the local accumulators, push an `agent:usage` event into the `eventQueue`. All data is already computed - just yield it.

### 3. Handle `SDKTaskProgressMessage` in Claude SDK backend (best-effort)

**File:** `src/engine/backends/claude-sdk.ts`

Add a case in `mapSDKMessages()` for system messages with subtype `task_progress`. Since these only provide `total_tokens` (no input/output split), yield `agent:usage` with `total` set and `input`/`output` as 0. If these messages don't actually fire during direct `query()` calls, no harm done - the result event still handles it.

### 4. Add `agent:usage` to monitor UI types

**File:** `src/monitor/ui/src/lib/types.ts`

Add the `agent:usage` event type to the UI's `EforgeEvent` union so TypeScript is happy.

### 5. Add `liveAgentUsage` to reducer state and handle `agent:usage`

**File:** `src/monitor/ui/src/lib/reducer.ts`

Add to `RunState`:
```typescript
liveAgentUsage: Record<string, {
  input: number; output: number; cacheRead: number;
  cacheCreation: number; cost: number; turns: number;
}>;
```

In `processEvent()`:
- On `agent:usage`: set `state.liveAgentUsage[event.agentId]` to the event's cumulative values
- On `agent:result`: delete `state.liveAgentUsage[event.agentId]` (existing additive logic handles finalized counts unchanged)
- On `agent:stop`: delete `state.liveAgentUsage[event.agentId]` (safety cleanup for error cases)

Also update `AgentThread` - on `agent:usage`, update the matching thread's `totalTokens`, `inputTokens`, `outputTokens`, `cacheRead`, `costUsd`, `numTurns` so the per-agent pipeline view also updates live.

### 6. Update `getSummaryStats()` to include live agent usage

**File:** `src/monitor/ui/src/lib/reducer.ts`

In `getSummaryStats()` (line 391), compute display totals as finalized + live overlay:

```typescript
const liveExtra = Object.values(state.liveAgentUsage).reduce(
  (acc, u) => ({
    input: acc.input + u.input,
    output: acc.output + u.output,
    cacheRead: acc.cacheRead + u.cacheRead,
    cacheCreation: acc.cacheCreation + u.cacheCreation,
    cost: acc.cost + u.cost,
    turns: acc.turns + u.turns,
  }),
  { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, cost: 0, turns: 0 },
);

return {
  tokensIn: state.tokensIn + liveExtra.input,
  tokensOut: state.tokensOut + liveExtra.output,
  cacheRead: state.cacheRead + liveExtra.cacheRead,
  cacheCreation: state.cacheCreation + liveExtra.cacheCreation,
  totalCost: state.totalCost + liveExtra.cost,
  totalTurns: baseThreadTurns + liveExtra.turns,
  // ... rest unchanged
};
```

This avoids double-counting: finalized totals come from `agent:result`, live overlay comes from `liveAgentUsage`, and the live entry is deleted when the agent finishes.

## Scope

**In scope:**
- New `agent:usage` event type in the engine event system
- Emitting `agent:usage` from the Pi backend on `turn_end`
- Best-effort handling of `SDKTaskProgressMessage` in the Claude SDK backend
- UI reducer changes to track live agent usage and overlay it onto summary stats
- UI type updates for the new event

**Out of scope:**
- No changes needed to `summary-cards.tsx`, `thread-pipeline.tsx`, `server.ts`, or `recorder.ts` - they already handle incremental state updates

**Files to modify:**
1. `src/engine/events.ts` - Add event type + update `isAlwaysYieldedAgentEvent`
2. `src/engine/backends/pi.ts` - Emit `agent:usage` on `turn_end`
3. `src/engine/backends/claude-sdk.ts` - Handle `SDKTaskProgressMessage` (best-effort)
4. `src/monitor/ui/src/lib/types.ts` - Add `agent:usage` to UI event type
5. `src/monitor/ui/src/lib/reducer.ts` - Add `liveAgentUsage`, handle events, update `getSummaryStats()`

## Acceptance Criteria

1. Running an eforge build with Pi backend shows token counts and turns incrementing per-turn in the monitor dashboard
2. Running with Claude SDK backend produces no errors from the new system message handling
3. `agent:result` still provides correct final counts with no double-counting
4. Batch-load (page refresh during a build) correctly reconstructs state from replayed events
5. `pnpm type-check` and `pnpm test` pass
