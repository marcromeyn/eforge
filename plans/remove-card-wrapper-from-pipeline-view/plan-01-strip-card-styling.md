---
id: plan-01-strip-card-styling
name: Strip Card Styling from Pipeline View
dependsOn: []
branch: remove-card-wrapper-from-pipeline-view/strip-card-styling
---

# Strip Card Styling from Pipeline View

## Architecture Context

The pipeline section in `thread-pipeline.tsx` is wrapped in a card container (`bg-card border border-border rounded-lg px-4 py-3 shadow-sm shadow-black/20`) that adds padding and visual boundaries, misaligning its content with the heatmap above it. An internal separator (`border-t border-border/50`) only exists because of the card boundary and is no longer needed once the card is removed.

## Implementation

### Overview

Remove the card wrapper's visual styling classes and the internal separator line so pipeline content sits flush with surrounding elements.

### Key Decisions

1. Replace the card-styled `<div>` with a plain `<div>` (no classes) to preserve the DOM structure while removing visual styling.
2. Remove the `border-t border-border/50` separator entirely since it served as an internal card divider.

## Scope

### In Scope
- Removing `bg-card`, `border border-border`, `rounded-lg`, `px-4 py-3`, `shadow-sm shadow-black/20` from the pipeline wrapper div (line 257)
- Removing the `<div className="border-t border-border/50 mb-2" />` separator (line 271)

### Out of Scope
- Changes to the heatmap or other surrounding components
- Any functional or behavioral changes to the pipeline view
- Changes to PlanRow, ProfileHeader, or other sub-components

## Files

### Modify
- `src/monitor/ui/src/components/pipeline/thread-pipeline.tsx` — Remove card wrapper classes from the outer `<div>` on line 257 and remove the `border-t border-border/50` separator on line 271.

## Verification

- [ ] The `<div>` wrapping the pipeline content in `ThreadPipeline` has no `bg-card`, `border`, `rounded-lg`, `px-4`, `py-3`, or `shadow-sm` classes
- [ ] No element with `border-t border-border/50` exists inside `ThreadPipeline`
- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm build` completes with exit code 0
