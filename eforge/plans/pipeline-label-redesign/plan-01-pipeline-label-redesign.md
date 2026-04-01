---
id: plan-01-pipeline-label-redesign
name: Pipeline Label Redesign
dependsOn: []
branch: pipeline-label-redesign/label-redesign
---

# Pipeline Label Redesign

## Architecture Context

The monitor UI's `ThreadPipeline` component renders plan rows with monospace text labels in a 140px left column, while a separate `ArtifactsStrip` component renders clickable pills (PRD, Plan 01, Plan 02) as a distinct row below the pipeline. The compile stage breadcrumb (`StageOverview`) renders inside `ProfileHeader` above the entire pipeline. This creates vertical waste and label duplication.

This plan consolidates: pills replace text labels in the left column, `StageOverview` moves into the Compile row, and `ArtifactsStrip` is deleted.

## Implementation

### Overview

Replace PlanRow left-side text labels with colored pills, move compile StageOverview into the Compile row's right column, pass artifact data through ThreadPipeline, and remove ArtifactsStrip.

### Key Decisions

1. **Inline `abbreviatePlanId` into thread-pipeline.tsx** rather than creating a shared utility - it's a 4-line function used in one place after ArtifactsStrip deletion.
2. **Pill styling constants copied from artifacts-strip.tsx** - same visual language, just relocated.
3. **Compile StageOverview rendered in PlanRow's right column** above thread bars, same position as `BuildStageProgress` for plan rows. This reuses the existing `StageOverview` component with no changes to its internals.
4. **Dependency indentation via `pl-4`** on the pill container when `dependsOn` has entries. Single level only.
5. **Fallback to monospace label** when no matching artifact data exists (before `plan:complete` events arrive).

## Scope

### In Scope
- Replace PlanRow left labels with colored pills (PRD yellow, Plan cyan)
- Add dependency indentation (`pl-4`) for plans with `dependsOn`
- Move `StageOverview` from `ProfileHeader` into the Compile `PlanRow` right column
- Pass `prdSource` and `planArtifacts` from `app.tsx` through `ThreadPipeline` to `PlanRow`
- Shrink left column from `w-[140px]` to `w-[100px]`
- Remove `ArtifactsStrip` component and its usage
- Add tooltips: PRD pill shows PRD label, plan pills show full plan name + dependency info

### Out of Scope
- Recursive/multi-level dependency nesting
- Changes to `StageOverview` internals or styling
- Changes to `BuildStageProgress` component

## Files

### Modify
- `src/monitor/ui/src/components/pipeline/thread-pipeline.tsx` - Replace left-side text labels with pill buttons; add new props (`prdSource`, `planArtifacts`) to `ThreadPipelineProps` and `PlanRowProps`; compute `planArtifactMap` and `dependsByPlan` memos; add `compileStages`/`activeStages`/`completedStages` props to the Compile `PlanRow`; render `StageOverview` in `PlanRow` right column when `compileStages` is provided; remove `StageOverview` rendering from `ProfileHeader`; shrink left column to `w-[100px]`; add `abbreviatePlanId` function and pill class constants
- `src/monitor/ui/src/app.tsx` - Pass `prdSource` and `planArtifacts` props to `ThreadPipeline`; remove `ArtifactsStrip` import and usage

### Delete
- `src/monitor/ui/src/components/common/artifacts-strip.tsx` - No longer needed; functionality moved into thread-pipeline.tsx

## Detail

### thread-pipeline.tsx changes

#### 1. Add pill constants and `abbreviatePlanId` (top of file)

```typescript
const pillClass =
  'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium cursor-pointer transition-colors border-none';
const prdPillClass = `${pillClass} bg-yellow/15 text-yellow/70 hover:bg-yellow/25`;
const planPillClass = `${pillClass} bg-cyan/15 text-cyan/70 hover:bg-cyan/25`;

function abbreviatePlanId(id: string): string {
  const match = id.match(/^plan-(\d+)/);
  if (match) return `Plan ${match[1]}`;
  return id;
}
```

#### 2. Update `ThreadPipelineProps`

Add new props:
```typescript
prdSource?: { label: string; content: string } | null;
planArtifacts?: Array<{ id: string; name: string; body: string }>;
```

#### 3. Add memos inside `ThreadPipeline`

```typescript
const planArtifactMap = useMemo(() => {
  const map = new Map<string, { name: string; body: string }>();
  if (planArtifacts) {
    for (const p of planArtifacts) {
      map.set(p.id, { name: p.name, body: p.body });
    }
  }
  return map;
}, [planArtifacts]);

const dependsByPlan = useMemo(() => {
  const map = new Map<string, string[]>();
  if (orchestration) {
    for (const plan of orchestration.plans) {
      if (plan.dependsOn.length > 0) {
        map.set(plan.id, plan.dependsOn);
      }
    }
  }
  return map;
}, [orchestration]);
```

#### 4. Remove `StageOverview` from `ProfileHeader`

Remove the `<StageOverview ...>` JSX line from `ProfileHeader` (currently line 190). Remove the `activeStages`, `completedStages`, `hoveredStage`, `onStageHover` props from `ProfileHeader` since they're only used for StageOverview. Keep the profile badge and extends info.

#### 5. Pass new props to Compile `PlanRow`

```tsx
<PlanRow
  key="__compile__"
  planId="Compile"
  threads={globalThreads}
  sessionStart={sessionStart}
  totalSpan={totalSpan}
  endTime={endTime}
  disablePreview
  hoveredStage={hoveredStage}
  onStageHover={setHoveredStage}
  events={events}
  prdSource={prdSource}
  compileStages={profileInfo?.config.compile}
  compileActiveStages={activeStages}
  compileCompletedStages={completedStages}
/>
```

#### 6. Pass new props to plan `PlanRow`s

```tsx
<PlanRow
  key={planId}
  planId={planId}
  threads={threadsByPlan.get(planId) ?? EMPTY_THREADS}
  sessionStart={sessionStart}
  totalSpan={totalSpan}
  endTime={endTime}
  issues={reviewIssues?.[planId]}
  hoveredStage={hoveredStage}
  onStageHover={setHoveredStage}
  events={events}
  buildStages={buildStagesByPlan.get(planId)}
  currentStage={planStatuses[planId]}
  planArtifact={planArtifactMap.get(planId)}
  dependsOn={dependsByPlan.get(planId)}
/>
```

#### 7. Update `PlanRowProps`

Add:
```typescript
prdSource?: { label: string; content: string } | null;
planArtifact?: { name: string; body: string };
dependsOn?: string[];
compileStages?: string[];
compileActiveStages?: Set<string>;
compileCompletedStages?: Set<string>;
```

#### 8. Update `PlanRow` left column rendering

Replace the current 140px monospace span with conditional pill rendering:

- **When `prdSource` is provided** (Compile row): Render yellow PRD pill, clickable via `openContentPreview(prdSource.label, prdSource.content)`, tooltip shows `prdSource.label`
- **When `planArtifact` is provided** (plan row with artifact): Render cyan plan pill with `abbreviatePlanId(planId)` label, clickable via `openContentPreview(planArtifact.name || planId, planArtifact.body)`, tooltip shows full plan name + "Depends on: Plan XX" if `dependsOn` has entries
- **Fallback**: Keep monospace text label as today (for compile row without PRD or plan rows before `plan:complete`)

Container gets `pl-4` when `dependsOn` has entries.

Change width from `w-[140px]` to `w-[100px]`.

#### 9. Render `StageOverview` in Compile `PlanRow`

When `compileStages` is provided, render `StageOverview` in the right column above the thread bars (same position as `BuildStageProgress` for plan rows):

```tsx
{compileStages && (
  <StageOverview
    compile={compileStages}
    activeStages={compileActiveStages ?? new Set()}
    completedStages={compileCompletedStages ?? new Set()}
    hoveredStage={hoveredStage}
    onStageHover={onStageHover}
  />
)}
```

### app.tsx changes

1. Add `prdSource` and `planArtifacts` props to `ThreadPipeline` invocation:
```tsx
<ThreadPipeline
  agentThreads={runState.agentThreads}
  startTime={runState.startTime}
  endTime={runState.endTime}
  planStatuses={runState.planStatuses}
  reviewIssues={runState.reviewIssues}
  profileInfo={runState.profileInfo}
  events={runState.events}
  orchestration={effectiveOrchestration}
  prdSource={prdSource}
  planArtifacts={planArtifacts}
/>
```

2. Remove `<ArtifactsStrip prdSource={prdSource} plans={planArtifacts} />` (line 328)
3. Remove the `ArtifactsStrip` import

### artifacts-strip.tsx deletion

Delete `src/monitor/ui/src/components/common/artifacts-strip.tsx` entirely.

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm build` completes with exit code 0
- [ ] No import references to `artifacts-strip` remain in any `.tsx` or `.ts` file
- [ ] The left column uses `w-[100px]` (not `w-[140px]`)
- [ ] `PlanRow` renders a yellow pill with text "PRD" when `prdSource` is provided
- [ ] `PlanRow` renders a cyan pill with text "Plan 01" (abbreviated) when `planArtifact` is provided
- [ ] `PlanRow` falls back to monospace text label when neither `prdSource` nor `planArtifact` is provided
- [ ] Plan pills have a tooltip showing the full plan name (e.g., "plan-01-event-types-and-schemas")
- [ ] Plan pills with `dependsOn` entries show "Depends on: Plan XX" in tooltip
- [ ] Plans with `dependsOn` entries have `pl-4` left padding on the pill container
- [ ] `StageOverview` renders in the Compile row's right column (above thread bars), not in `ProfileHeader`
- [ ] `ProfileHeader` renders only the profile badge and extends info (no stage breadcrumb)
- [ ] PRD pill click opens content preview with the PRD label and content
- [ ] Plan pill click opens content preview with the plan name and body
