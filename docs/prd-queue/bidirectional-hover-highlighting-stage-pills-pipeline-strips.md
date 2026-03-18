---
title: Bidirectional Hover Highlighting: Stage Pills ↔ Pipeline Strips
created: 2026-03-18
status: pending
---

## Problem / Motivation

The monitor's profile card shows stage chips (e.g. "implement", "review") in the header and agent timeline strips (e.g. "builder", "reviewer") below, but there's no visual connection between them. Users can't discover which stages map to which agents without prior knowledge.

## Goal

Add bidirectional hover highlighting so hovering a stage pill lights up its corresponding agent strips, and hovering a strip lights up its stage pill - making the stage-to-agent mapping discoverable at a glance.

## Approach

Single `hoveredStage: string | null` state in `ThreadPipeline`, threaded down to `StagePill` and `PlanRow`. Both set the state on mouse enter/leave. Matched elements brighten, non-matched elements dim.

**File:** `src/monitor/ui/src/components/pipeline/thread-pipeline.tsx` (only change)

### State and prop threading

- Add `useState<string | null>(null)` for `hoveredStage` in `ThreadPipeline`
- Thread `hoveredStage` and `onStageHover: (stage: string | null) => void` through:
  - `ThreadPipeline` → `ProfileHeader` → `StageOverview` → `StagePill`
  - `ThreadPipeline` → `PlanRow` → strip divs

### StagePill behavior

- `onMouseEnter` → `onStageHover(stage)`
- `onMouseLeave` → `onStageHover(null)`
- Highlighted (`hoveredStage === stage`): `ring-1 ring-foreground/40 brightness-125`
- Dimmed (`hoveredStage !== null && !== stage`): `opacity-40`
- Base: add `transition-all duration-150`

### PlanRow strip div behavior

- Compute `stripStage = AGENT_TO_STAGE[thread.agent]`
- `onMouseEnter` → `onStageHover(stripStage)`
- `onMouseLeave` → `onStageHover(null)`
- Highlighted (`hoveredStage === stripStage`): `brightness-150 ring-1 ring-foreground/30`
- Dimmed (`hoveredStage !== null && !== stripStage`): `opacity-30`
- Base: add `transition-all duration-150`

### Edge cases

- Agents not in `AGENT_TO_STAGE` → `stripStage` is `undefined`, dim when anything else is hovered (correct behavior)
- Parallel stages (implement + doc-update) → each pill highlights independently
- Tooltip `asChild` propagation → no conflict with mouse events

## Scope

**In scope:**
- Hover state management in `ThreadPipeline`
- Bidirectional highlighting between stage pills and agent timeline strips
- Visual feedback via brightness, ring, and opacity transitions

**Out of scope:**
- N/A

## Acceptance Criteria

- `pnpm build` succeeds with no type errors
- Hovering a stage pill highlights (brightens + ring) all corresponding agent strips and dims non-matching strips
- Hovering an agent strip highlights its corresponding stage pill and dims non-matching pills
- Mouse leave resets all elements to their base visual state
- Agents without a stage mapping dim when any stage is hovered
- Parallel stages (e.g. implement + doc-update) highlight independently
- Transitions animate smoothly (`transition-all duration-150`)
