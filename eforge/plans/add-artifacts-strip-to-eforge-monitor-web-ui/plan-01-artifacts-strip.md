---
id: plan-01-artifacts-strip
name: Add Artifacts Strip Component
depends_on: []
branch: add-artifacts-strip-to-eforge-monitor-web-ui/artifacts-strip
---

# Add Artifacts Strip Component

## Architecture Context

The monitor web UI renders sessions in a vertical layout: SummaryCards at top, ThreadPipeline below, then a tab bar (Changes/Graph). The Build PRD link currently lives in the top-right corner alongside SummaryCards. Plan files and architecture docs are only accessible via swim lane labels in ThreadPipeline or the plan preview panel.

The `usePlanPreview()` context provides `openPreview(planId)` and `openContentPreview(title, content)` for opening artifacts. Plan data (including type: `'architecture' | 'module' | 'plan'`) is fetched via `/api/plans/{sessionId}` using the `useApi` hook. The PRD source is derived from the first `plan:start` event in app.tsx.

## Implementation

### Overview

Create a new `ArtifactsStrip` component that renders a compact horizontal bar of clickable artifact links. The component fetches plan data via `useApi` and uses the `usePlanPreview()` context to open artifacts. It replaces the existing PRD link in app.tsx and is inserted between ThreadPipeline and the tab bar.

### Key Decisions

1. The component accepts `sessionId` and `prdSource` as props rather than deriving them internally - app.tsx already computes these values and passing them avoids duplicated logic.
2. Plan data is fetched with `useApi<PlanData[]>` inside the component, gated on `sessionId` being non-null. This matches the pattern used by `PlanPreviewPanel`.
3. Artifacts are categorized by type: PRD first, then architecture doc, then plan files - ordered by specificity (broadest context first).
4. The strip renders nothing (returns `null`) when there are no artifacts to show (no PRD and no plans fetched yet).

## Scope

### In Scope
- New `artifacts-strip.tsx` component at `src/monitor/ui/src/components/common/`
- Move PRD link from top-right (app.tsx lines 287-294) into the strip
- Insert strip in app.tsx between ThreadPipeline and tab bar
- Clicking PRD calls `openContentPreview(label, content)`
- Clicking a plan/architecture doc calls `openPreview(planId)`

### Out of Scope
- Reducer changes
- New API endpoints
- Changes to `usePlanPreview()` context
- Changes to plan data fetching logic

## Files

### Create
- `src/monitor/ui/src/components/common/artifacts-strip.tsx` - Horizontal bar component rendering artifact links grouped by type (PRD, architecture, plans). Uses `useApi` to fetch plan data and `usePlanPreview()` to handle clicks.

### Modify
- `src/monitor/ui/src/app.tsx` - (1) Remove the PRD link `<span>` from the SummaryCards row (lines 287-294). (2) Import `ArtifactsStrip`. (3) Insert `<ArtifactsStrip>` between the `<ThreadPipeline>` (line 296) and the content tabs `<div>` (line 299), passing `sessionId={currentSessionId}` and `prdSource={prdSource}`.

## Verification

- [ ] `ArtifactsStrip` component file exists at `src/monitor/ui/src/components/common/artifacts-strip.tsx`
- [ ] The PRD link no longer appears in the top-right corner next to SummaryCards in app.tsx
- [ ] `ArtifactsStrip` is rendered in app.tsx between `ThreadPipeline` and the tab bar div
- [ ] When `prdSource` is non-null, the strip renders a "Build PRD" link that calls `openContentPreview`
- [ ] When plans are fetched, the strip renders a link for each plan file that calls `openPreview(planId)`
- [ ] When an architecture doc exists (plan with `type === 'architecture'`), the strip renders an "Architecture" link
- [ ] The strip returns `null` when there are no artifacts (no PRD and no plans)
- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm build` completes with exit code 0
