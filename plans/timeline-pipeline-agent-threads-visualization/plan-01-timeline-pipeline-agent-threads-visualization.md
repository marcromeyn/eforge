---
id: plan-01-timeline-pipeline-agent-threads-visualization
name: "Timeline Pipeline: Agent Threads Visualization"
depends_on: []
branch: timeline-pipeline-agent-threads-visualization/main
---

# Timeline Pipeline: Agent Threads Visualization

## Context

The monitor's pipeline view currently shows static stage pills (plan/implement/review/evaluate/complete) per plan. schaake-os has a nice agent threads visualization - horizontal colored bars showing when agents ran and for how long. Rather than adding a separate threads component, we'll replace the pipeline with a Gantt-style timeline where agent bars ARE the stages, positioned in real time. Same color semantics, but with temporal context, hover tooltips, and animated running indicators.

## Changes

### 1. Add timestamps to agent lifecycle events

**`src/engine/events.ts`** (lines 179-180)
- Add `timestamp?: string` (optional) to `agent:start` and `agent:stop` event type variants — optional for backward compatibility with old events and `StubBackend` in tests

**`src/engine/backends/claude-sdk.ts`** (lines 42, 70)
- Add `timestamp: new Date().toISOString()` to both yield statements

### 2. Track agent threads in reducer

**`src/monitor/ui/src/lib/reducer.ts`**

Add type and state:
```typescript
export interface AgentThread {
  agentId: string;
  agent: string;  // AgentRole
  planId?: string;
  startedAt: string;      // ISO from agent:start timestamp
  endedAt: string | null;  // ISO from agent:stop timestamp
  durationMs: number | null; // from agent:result
}
```

- Add `agentThreads: AgentThread[]` to `RunState` and `initialRunState`
- Add `agentThreads` to the mutable state parameter of `processEvent`
- Handle three event types in `processEvent`:
  - `agent:start` - push new thread with `startedAt`, `endedAt: null`, `durationMs: null`
  - `agent:stop` - find thread by `agentId`, set `endedAt`
  - `agent:result` - find most recent thread matching `(agent, planId)` where `durationMs === null`, set `durationMs`
- Wire through `BATCH_LOAD` and `ADD_EVENT` cases

### 3. New component: `ThreadPipeline`

**New file: `src/monitor/ui/src/components/pipeline/thread-pipeline.tsx`**

Replaces the current `Pipeline` component. Takes `agentThreads`, `startTime`, `planStatuses`, `reviewIssues`.

Layout per plan row:
- Left: plan ID label (140px, clickable for plan preview, matching current style)
- Right: horizontal bar area where each agent invocation is a positioned, colored bar

Color map (reuse existing pipeline stage colors via CSS variables):
- `planner`, `assessor`, `module-planner` -> yellow (plan phase)
- `builder` -> blue (implement phase)
- `reviewer`, `plan-reviewer`, `cohesion-reviewer` -> green (review phase)
- `evaluator`, `plan-evaluator`, `cohesion-evaluator` -> purple/violet (evaluate phase)
- `validation-fixer` -> red
- Fallback: cyan

Bar positioning: `leftPercent = (threadStart - sessionStart) / totalSpan * 100`, `widthPercent = (threadEnd - threadStart) / totalSpan * 100`. Minimum width of 2px for very short agents.

Tooltip: `title` attribute (matches ActivityHeatstrip pattern) showing agent role + duration.

Running agents: animated trailing edge using existing `pulse-opacity` keyframes.

For single-plan errands: rows are grouped by plan, showing the full agent sequence. For multi-plan orchestrations: each plan gets its own row, parallel execution is visually apparent.

Review gauge: keep `ReviewGauge` below each plan row (reuse existing `review-gauge.tsx`).

### 4. Wire into app

**`src/monitor/ui/src/app.tsx`**
- Replace `<Pipeline>` import/usage with `<ThreadPipeline>`
- Pass `agentThreads={runState.agentThreads}` and `startTime={runState.startTime}` along with existing `planStatuses` and `reviewIssues`

### 5. Clean up (optional)

**`src/monitor/ui/src/components/pipeline/pipeline.tsx`** - Remove or keep as dead code. `pipeline-row.tsx` similarly.

## Files to modify

| File | Action |
|------|--------|
| `src/engine/events.ts` | Add `timestamp` to agent:start/stop types |
| `src/engine/backends/claude-sdk.ts` | Emit timestamps on agent lifecycle yields |
| `src/monitor/ui/src/lib/reducer.ts` | Add AgentThread tracking |
| `src/monitor/ui/src/components/pipeline/thread-pipeline.tsx` | **New** - Gantt-style timeline pipeline |
| `src/monitor/ui/src/app.tsx` | Swap Pipeline -> ThreadPipeline |
| `test/stub-backend.ts` | Add `timestamp` to `agent:start` and `agent:stop` yields |

## Reuse

- `STAGE_COLORS` from `pipeline-row.tsx` for color mapping reference
- `ReviewGauge` from `review-gauge.tsx` (keep as-is)
- `usePlanPreview` from `preview.tsx` for plan ID click behavior
- `pulse-opacity` keyframes already defined in globals.css
- `formatDuration` from `lib/format.ts`
- `title` attribute tooltip pattern from `ActivityHeatstrip`

## Backward compatibility

Old sessions in monitor.db won't have timestamps embedded in `agent:start`/`agent:stop` event JSON. The component handles this gracefully - threads without `startedAt` timestamps are simply not rendered. The pipeline falls back to showing just the plan ID with no bars for old data.

## Verification

1. `pnpm type-check` - no type errors from added timestamp fields
2. `pnpm test` - existing tests pass (agent:start/stop fixtures may need timestamp field added)
3. `pnpm build` - successful bundle
4. Manual: run `pnpm dev -- plan` on a test PRD with `--verbose`, open monitor at localhost:4567, verify:
   - Agent bars appear and grow in real time as agents start/stop
   - Colors match pipeline stages (yellow plan, blue build, green review, violet evaluate)
   - Hovering shows agent name + duration
   - Running agents have animated trailing edge
   - Plan IDs are clickable (opens plan preview)
   - Review gauge appears below plan rows with issues
