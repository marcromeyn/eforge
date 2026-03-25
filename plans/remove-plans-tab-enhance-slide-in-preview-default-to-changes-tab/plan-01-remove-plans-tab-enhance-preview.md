---
id: plan-01-remove-plans-tab-enhance-preview
name: Remove Plans Tab, Enhance Slide-in Preview, Default to Changes Tab
depends_on: []
branch: remove-plans-tab-enhance-slide-in-preview-default-to-changes-tab/remove-plans-tab-enhance-preview
---

# Remove Plans Tab, Enhance Slide-in Preview, Default to Changes Tab

## Architecture Context

The monitor UI has three content tabs (Changes, Plans, Graph) and a slide-in `PlanPreviewPanel` triggered by clicking plan IDs in the pipeline. The Plans tab and the slide-in panel show overlapping plan information. This plan removes the Plans tab, makes the slide-in panel the single surface for plan details (with full parity), and makes the Changes tab always-enabled and the default.

The key data flow: `App` holds `runState` (from `useEforgeEvents`) which contains `planStatuses`, `fileChanges`, and `moduleStatuses`. The `PlanPreviewPanel` currently only receives `sessionId` — it fetches plan data via API but has no access to runtime state. The `PlanPreviewContext` needs to be extended to carry this runtime data so the panel can render status badges and file changes.

## Implementation

### Overview

Four files are modified in a single cohesive change:

1. **Export `StatusBadge` and `ModuleStatusBadge`** from `plan-card.tsx` so they can be imported by the preview panel.
2. **Extend `PlanPreviewContext`** with runtime data fields (`planStatuses`, `fileChanges`, `moduleStatuses`) and a `setRuntimeData` setter.
3. **Enhance `PlanPreviewPanel`** to render `BuildConfigSection`, `StatusBadge`, `ModuleStatusBadge`, and file change pills for the selected plan.
4. **Update `App`** to remove the Plans tab, make Changes tab always-enabled with placeholder, call `setRuntimeData` to feed runtime state into the context, and update tab fallback logic.

### Key Decisions

1. **Runtime data via context setter** — Rather than prop-drilling `planStatuses`/`fileChanges`/`moduleStatuses` through the preview panel component tree, extend `PlanPreviewContext` with a `setRuntimeData` function. `App` calls this in a `useEffect` to keep the context in sync with `runState`. This avoids changing the `PlanPreviewPanel` props interface and keeps the existing `PlanPreviewProvider` wrapping pattern intact.
2. **Export existing badge components** — `StatusBadge` and `ModuleStatusBadge` already exist in `plan-card.tsx` with the exact styling needed. Export them directly rather than moving to a new file, minimizing diff size. The PRD explicitly says keeping `plan-card.tsx` is fine.
3. **Changes tab always enabled** — Remove the `changesEnabled` guard, `disabled` prop, and the `useEffect` that resets activeTab when `changesEnabled` becomes false. Show a placeholder `<div>` when `fileChanges.size === 0`.

## Scope

### In Scope
- Exporting `StatusBadge` and `ModuleStatusBadge` from `plan-card.tsx`
- Adding `planStatuses`, `fileChanges`, `moduleStatuses`, and `setRuntimeData` to `PlanPreviewContext`
- Rendering `BuildConfigSection`, status badges, and file change pills in `PlanPreviewPanel`
- Removing the Plans tab button and content from `App`
- Making Changes tab the default (`useState<ContentTab>('changes')`)
- Making Changes tab always enabled (remove `disabled` prop, remove `changesEnabled` guard)
- Adding placeholder text when no file changes exist
- Removing `PlanCards` import from `App`
- Removing `hasAnyPlanContent` variable from `App`
- Updating tab fallback: graph unavailable falls back to `'changes'`
- Removing the `useEffect` that resets tab when `changesEnabled` becomes false
- Updating `ContentTab` type to `'changes' | 'graph'`

### Out of Scope
- Deleting `plan-card.tsx` or `plan-cards.tsx` files
- Changes to Graph tab behavior
- Changes to pipeline plan ID click interaction
- Changes to the `PlanMetadata` or `PlanBodyHighlight` components

## Files

### Modify
- `src/monitor/ui/src/components/plans/plan-card.tsx` — Export `StatusBadge` and `ModuleStatusBadge` (add `export` keyword to both function declarations)
- `src/monitor/ui/src/components/preview/plan-preview-context.tsx` — Add `planStatuses: Record<string, PipelineStage>`, `fileChanges: Map<string, string[]>`, `moduleStatuses: Record<string, ModuleStatus>` to context value interface; add `setRuntimeData` callback; provide defaults in Provider state
- `src/monitor/ui/src/components/preview/plan-preview-panel.tsx` — Import and render `BuildConfigSection`, `StatusBadge`, `ModuleStatusBadge` from plan components; consume runtime data from context; render file change pills; add status badges to header
- `src/monitor/ui/src/app.tsx` — Remove `PlanCards` import; change `ContentTab` to `'changes' | 'graph'`; default `activeTab` to `'changes'`; remove Plans tab button; remove Plans tab content branch; remove `hasAnyPlanContent`; remove `changesEnabled` variable; make Changes tab always enabled; add placeholder when `fileChanges.size === 0`; update graph fallback to `'changes'`; remove useEffect that resets tab on `changesEnabled` change; call `setRuntimeData` via useEffect to sync runtime state into PlanPreviewContext

## Verification

- [ ] `pnpm build` completes with exit code 0 (includes monitor UI build)
- [ ] `pnpm type-check` passes with no errors
- [ ] `ContentTab` type in `app.tsx` is `'changes' | 'graph'` (no `'plans'` variant)
- [ ] Default `activeTab` state is initialized to `'changes'`
- [ ] No `<button>` element with text content "Plans" exists in the tab bar JSX in `app.tsx`
- [ ] No `activeTab === 'plans'` conditional exists in `app.tsx`
- [ ] No `PlanCards` import exists in `app.tsx`
- [ ] No `hasAnyPlanContent` variable exists in `app.tsx`
- [ ] No `disabled={!changesEnabled}` prop exists on the Changes tab button
- [ ] No `changesEnabled` variable exists in `app.tsx`
- [ ] When `activeTab === 'changes'` and `fileChanges.size === 0`, a div with text "Changes will appear here once files are modified..." is rendered
- [ ] When `activeTab === 'changes'` and `fileChanges.size > 0`, `FileHeatmap` is rendered
- [ ] `useEffect` fallback sets `activeTab` to `'changes'` (not `'plans'`) when graph becomes unavailable
- [ ] `StatusBadge` and `ModuleStatusBadge` are exported from `plan-card.tsx`
- [ ] `PlanPreviewPanel` imports and renders `BuildConfigSection` for the selected plan
- [ ] `PlanPreviewPanel` renders `StatusBadge` in the header area for plan-type selections
- [ ] `PlanPreviewPanel` renders file change pills when file changes exist for the selected plan
- [ ] `PlanPreviewContext` exposes `planStatuses`, `fileChanges`, `moduleStatuses` via `usePlanPreview()`
