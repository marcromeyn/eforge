---
id: plan-06-wave-timeline
name: Collapsible wave-level timeline grouping for multi-plan orchestrations
depends_on:
  - plan-02-react-foundation
branch: monitor-dashboard-prd/wave-timeline
---

# Wave-Level Timeline Grouping

## Architecture Reference

This module implements [Core Architectural Principles → 1. Event-Driven Data Flow] and [Component Architecture → timeline/] from the architecture.

Key constraints from architecture:
- All monitor state derives from `EforgeEvent`s — wave grouping is computed from `wave:start`, `wave:complete`, and per-plan build events already in the SSE stream
- Feature modules consume the shared `RunState` from the foundation's `useEforgeEvents()` hook — no separate SSE connections
- Single-plan (errand) runs skip wave grouping and show the flat timeline as today
- React components organized by feature domain — wave-timeline components live in `components/timeline/`

## Scope

### In Scope
- Collapsible wave sections that group events by wave number
- Wave header showing wave number, plan count, and aggregate status (e.g., "Wave 2 — 3/4 plans complete, 1 running")
- Per-plan pipeline rows nested within each wave section
- Progress indicators: per-wave completion tracking from build events
- Automatic fallback to flat timeline for errand (single-plan) runs
- Pre-wave events (planning phase: `plan:*`, `eforge:start`, `expedition:*`) rendered outside wave sections
- Post-wave events (`merge:*`, `validation:*`, `eforge:end`) rendered after the last wave section
- Real-time updates as `wave:start`, `wave:complete`, `build:*`, and `merge:*` events arrive

### Out of Scope
- Dependency graph visualization (module: `dependency-graph`)
- Plan file preview panel (module: `plan-preview`)
- File change heatmap (module: `file-heatmap`)
- `build:files_changed` event type (module: `engine-events`)
- Any engine or server changes — this is purely a frontend rendering module
- Mobile-responsive layout

## Implementation Approach

### Overview

The wave-timeline module adds a grouped view mode to the event timeline for multi-plan orchestrations. It leverages the `RunState` already computed by the foundation's reducer, which tracks waves and plan statuses. The implementation introduces a `WaveTimeline` component that wraps the existing timeline/pipeline components with collapsible wave sections.

The module partitions the event stream into three zones: (1) pre-wave events (planning phase), (2) per-wave sections containing their plan pipeline rows and events, and (3) post-wave events (merging, validation, completion). Each wave section is a shadcn Collapsible with a summary header. Events are assigned to waves by matching their `planId` against the `wave:start` event's `planIds` array.

For errand runs (no `wave:start` events), the component renders the flat timeline from the foundation module unchanged — no wave headers, no nesting.

### Key Decisions

1. **Event-to-wave assignment via `RunState.waves`** — The foundation reducer already accumulates `WaveInfo[]` from `wave:start`/`wave:complete` events including `planIds`. The wave-timeline component uses this data to partition events: each event with a `planId` is assigned to the wave containing that plan. Events without `planId` are assigned to the pre-wave or post-wave zone based on their position relative to `wave:start`/`wave:complete` events.

2. **Collapsible sections via shadcn Collapsible** — Each wave is wrapped in a `<Collapsible>` (already included in the foundation's shadcn setup). The trigger is a styled wave header. Waves default to expanded for running/failed waves and collapsed for completed waves, so users focus on active work.

3. **Reuse existing timeline components** — The `EventCard` and `PipelineRow` components from the foundation render inside wave sections unchanged. The wave-timeline module adds grouping structure around them, not replacements. This preserves the verbose toggle, event detail expansion, and all existing timeline behavior.

4. **Replace vs. augment the timeline** — The wave-timeline component replaces the flat `<Timeline>` when wave data is present (multi-plan runs). It imports and delegates to the existing `EventCard` for rendering individual events and `PipelineRow` for per-plan progress. The foundation's `Timeline` component should be refactored to accept a `groupByWave` prop or the main content area should conditionally render `WaveTimeline` vs `Timeline`.

5. **Derive wave aggregate status from plan statuses** — A wave's aggregate status is computed from its constituent plan statuses in `RunState.plans`: all complete → "complete", any failed → "failed", any running → "running", otherwise "pending". This avoids duplicating status tracking logic.

## Files

### Create

- `src/monitor/ui/src/components/timeline/wave-timeline.tsx` — Top-level wave-grouped timeline component. Partitions `RunState.events` into pre-wave, per-wave, and post-wave sections. Conditionally renders when `RunState.waves.length > 0`; falls back to flat timeline otherwise.

- `src/monitor/ui/src/components/timeline/wave-section.tsx` — Single wave section: collapsible container with wave header trigger. Renders nested pipeline rows for wave's plans and filtered event cards. Props: `wave: WaveInfo`, `plans: Map<string, PlanStatus>`, `events: EforgeEvent[]`, `startTime: Date | null`, `showVerbose: boolean`.

- `src/monitor/ui/src/components/timeline/wave-header.tsx` — Wave header displayed as the Collapsible trigger. Shows wave number, plan count, aggregate status badge, and progress text (e.g., "3/4 complete, 1 running"). Includes expand/collapse chevron indicator.

- `src/monitor/ui/src/lib/wave-utils.ts` — Utility functions for wave-timeline:
  - `partitionEventsByWave(events, waves)` — Assigns events to pre-wave, per-wave buckets, or post-wave based on `planId` and wave assignment. Returns `{ preWave: EforgeEvent[], waveEvents: Map<number, EforgeEvent[]>, postWave: EforgeEvent[] }`.
  - `computeWaveStatus(wave, planStatuses)` — Derives aggregate wave status from constituent plan statuses.
  - `isMultiPlanRun(waves)` — Returns `true` if wave data is present (convenience for conditional rendering).

### Modify

- `src/monitor/ui/src/lib/reducer.ts` — Extend `RunState.waves` type (if not already present) to include `planIds` in `WaveInfo`. Ensure the reducer captures `wave:start` events with `{ wave: number, planIds: string[] }` and `wave:complete` events with `{ wave: number }`. The foundation module likely already handles this, but verify the `WaveInfo` type includes all fields needed by wave-timeline.

- `src/monitor/ui/src/components/timeline/timeline.tsx` — Add conditional rendering: when `RunState.waves.length > 0`, render `<WaveTimeline>` instead of the flat event list. Pass through all relevant props (events, showVerbose, startTime, autoScroll ref). The flat timeline remains the default for errand runs.

- `src/monitor/ui/src/components/timeline/timeline-controls.tsx` — No structural changes needed, but verify the verbose toggle applies correctly to events nested inside wave sections (events are still rendered via `EventCard`, which already respects the verbose flag).

- `src/monitor/ui/src/app.tsx` — May need to pass `orchestration` data (from `useApi('/api/orchestration/:runId')`) into the timeline area so wave-timeline can access wave metadata. If the foundation already passes `RunState` down, this may be unnecessary — verify during implementation.

## Testing Strategy

### Unit Tests

- **Wave utilities** (`test/monitor-wave-utils.test.ts`):
  - `partitionEventsByWave()` — Test with: (a) no waves (all events in preWave), (b) single wave, (c) multiple waves with interleaved events, (d) events with no planId assigned to correct zone, (e) merge/validation events in postWave
  - `computeWaveStatus()` — Test all status combinations: all pending, mixed running, all complete, any failed
  - `isMultiPlanRun()` — Trivial boolean test for empty vs. populated waves array

- **Wave-timeline component rendering** (if React testing is set up):
  - Renders flat timeline when no waves present
  - Renders wave sections when waves exist
  - Wave headers show correct plan counts and status text
  - Collapsible behavior: completed waves start collapsed, running waves start expanded

### Integration Tests

- **Visual verification**: Multi-plan run shows collapsible wave sections; errand run shows flat timeline
- **Real-time updates**: Wave headers update status as build events stream in
- **Verbose toggle**: Agent events hidden/shown within wave sections

## Verification

- [ ] Multi-plan orchestration run shows collapsible wave sections in the timeline
- [ ] Wave headers display "Wave N — X/Y plans complete, Z running" with correct counts
- [ ] Clicking a wave header collapses/expands the section
- [ ] Running/failed waves default to expanded; completed waves default to collapsed
- [ ] Per-plan pipeline rows render nested within their wave section
- [ ] Events are correctly partitioned: planning events before waves, build events within waves, merge/validation events after waves
- [ ] Errand (single-plan) runs display the flat timeline with no wave grouping
- [ ] Verbose toggle correctly hides/shows agent events inside wave sections
- [ ] Auto-scroll still works with wave-grouped timeline
- [ ] Real-time SSE events update wave headers and nested content as they arrive
- [ ] `pnpm type-check` passes
- [ ] `pnpm build` succeeds with wave-timeline components included
