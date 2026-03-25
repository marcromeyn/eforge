---
id: plan-01-integrate-heatstrip
name: Integrate Activity Heatstrip Into Pipeline
depends_on: []
branch: move-activity-heatstrip-into-pipeline-view/integrate-heatstrip
---

# Integrate Activity Heatstrip Into Pipeline

## Architecture Context

The monitor UI has a `ThreadPipeline` component that renders Gantt-style timeline bars using a `140px label column + flex-1 timeline container` layout. Each `PlanRow` positions bars via percentage-based `left` and `width` values relative to the session time span.

The `ActivityHeatstrip` currently renders above the pipeline in `app.tsx` as a standalone component with fixed 4px-wide cells. This causes temporal misalignment because it doesn't share the pipeline's layout grid or time-span calculations.

## Implementation

### Overview

Move the heatstrip rendering into `ThreadPipeline` as a row that shares the same layout and time calculations as `PlanRow`. Replace fixed 4px cells with percentage-based widths derived from `(BUCKET_MS / totalSpan) * 100%`. Delete the standalone component file.

### Key Decisions

1. **Inline the heatstrip logic into `thread-pipeline.tsx`** rather than importing the old component — the old component uses fixed widths and its own container, which conflicts with the pipeline layout. The density color logic and bucket computation are simple enough to inline.
2. **Render as a row above the Compile row** inside the `flex-col gap-1.5` container, using the same `140px label + flex-1 timeline` structure as `PlanRow`.
3. **Use percentage-based bucket widths** (`(BUCKET_MS / totalSpan) * 100%`) so buckets align temporally with Gantt bars. Each bucket is absolutely positioned within the flex-1 timeline container.

## Scope

### In Scope
- Remove `ActivityHeatstrip` import and usage from `app.tsx`
- Pass `events` prop into `ThreadPipeline`
- Add `HeatstripRow` inside `ThreadPipeline` above the Compile row, sharing the 140px label + flex-1 timeline layout
- Compute buckets using percentage widths relative to `totalSpan`
- Preserve density colors, tooltip content, and pulse animation on the last bucket

### Out of Scope
- Changes to density color thresholds or tooltip content format
- Changes to `PlanRow` or other pipeline rows
- Changes to `SummaryCards` or other components in `app.tsx`

## Files

### Delete
- `src/monitor/ui/src/components/common/activity-heatstrip.tsx` — standalone component replaced by inline row

### Modify
- `src/monitor/ui/src/app.tsx` — Remove `ActivityHeatstrip` import and rendering. Pass `events` to `ThreadPipeline`.
- `src/monitor/ui/src/components/pipeline/thread-pipeline.tsx` — Accept `events` prop. Add `HeatstripRow` component that computes 30-second buckets with percentage-based widths and renders above the Compile row using the same 140px label + flex-1 layout.

## Verification

- [ ] No import of `ActivityHeatstrip` or reference to `activity-heatstrip` exists in `app.tsx`
- [ ] `activity-heatstrip.tsx` file does not exist on disk
- [ ] `ThreadPipeline` accepts an `events` prop typed as `StoredEvent[]`
- [ ] A heatstrip row renders inside `ThreadPipeline` before the Compile `PlanRow`
- [ ] The heatstrip row uses a `w-[140px]` label element and a `flex-1` timeline container, matching `PlanRow` layout
- [ ] Each bucket's width is calculated as `(BUCKET_MS / totalSpan) * 100` percent
- [ ] Each bucket's left position is calculated as `(bucketIndex * BUCKET_MS / totalSpan) * 100` percent
- [ ] Density color function uses 5 tiers: zero/empty, <25%, <50%, <75%, >=75%
- [ ] Tooltip on each bucket displays event count and elapsed minutes
- [ ] The last bucket pulses when `endTime` is null (session still running)
- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm --filter monitor-ui type-check` passes with zero errors
- [ ] `pnpm --filter monitor-ui build` succeeds
