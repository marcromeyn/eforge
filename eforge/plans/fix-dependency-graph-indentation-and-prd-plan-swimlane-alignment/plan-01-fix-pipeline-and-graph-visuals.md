---
id: plan-01-fix-pipeline-and-graph-visuals
name: Fix pipeline swimlane alignment and graph indentation
dependsOn: []
branch: fix-dependency-graph-indentation-and-prd-plan-swimlane-alignment/fix-pipeline-and-graph-visuals
---

# Fix pipeline swimlane alignment and graph indentation

## Architecture Context

The monitor UI has two visualization modes for builds with dependencies: a pipeline view (thread-pipeline.tsx) and a graph view (dependency-graph with dag-edge/dag-node). Both have visual bugs when plans have dependencies. The pipeline view's PRD row lacks depth/maxDepth props causing horizontal misalignment with Plan rows. The graph view places all nodes at the same X coordinate regardless of dependency depth and uses bezier curves that appear as vertical bars when source/target share the same X.

## Implementation

### Overview

Three targeted changes across three files:

1. Pass `depth={0}` and `maxDepth={maxDepth}` to the PRD `PlanRow` in thread-pipeline.tsx so ThreadLineGutter renders the correct gutter width (empty at depth 0, but reserving space).
2. Compute dependency depth in use-graph-layout.ts and apply a horizontal offset (`DEPTH_INDENT * depth`) to each node's X position after Dagre layout.
3. Replace `getBezierPath` with `getSmoothStepPath` in dag-edge.tsx to produce L-shaped step connectors with rounded corners.

### Key Decisions

1. **Depth offset applied post-Dagre** - Dagre computes the base layout (vertical ranks), then we shift X by depth. This preserves Dagre's vertical spacing while adding horizontal structure. `DEPTH_INDENT = 50` px per level matches the visual weight of the 200px-wide nodes.
2. **`getSmoothStepPath` with borderRadius 8** - @xyflow/react exports this function alongside getBezierPath, so no new dependencies. The rounded corners match the existing node border-radius aesthetic.
3. **Depth 0 for PRD row** - At depth 0, `ThreadLineGutter` renders an empty gutter (the `Array.from({length: depth})` loop produces zero items) but still takes up `maxDepth * DEPTH_LEVEL_WIDTH` horizontal space via the container width calculation, matching Plan rows.

## Scope

### In Scope
- Passing depth/maxDepth props to PRD PlanRow in thread-pipeline.tsx
- Computing dependency depth map and applying X offset in use-graph-layout.ts
- Replacing getBezierPath with getSmoothStepPath in dag-edge.tsx

### Out of Scope
- Any other monitor UI changes
- Backend or data model changes
- Changes to the animated edge overlay logic
- dag-node.tsx styling changes

## Files

### Modify
- `src/monitor/ui/src/components/pipeline/thread-pipeline.tsx` - Add `depth={0}` and `maxDepth={maxDepth}` props to the PRD PlanRow call (~line 611)
- `src/monitor/ui/src/components/graph/use-graph-layout.ts` - After Dagre layout, compute dependency depth for each node and add `DEPTH_INDENT * depth` to each node's X position. Depth(root)=0, depth(node)=max(depth(dep) for dep in dependsOn)+1
- `src/monitor/ui/src/components/graph/dag-edge.tsx` - Replace `getBezierPath` import and call with `getSmoothStepPath`, adding `borderRadius: 8`

## Verification

- [ ] `pnpm build` completes with exit code 0 (covers both engine and monitor-ui type-check + vite build)
- [ ] In thread-pipeline.tsx, the PRD PlanRow receives `depth={0}` and `maxDepth={maxDepth}` - confirmed by code inspection
- [ ] In use-graph-layout.ts, nodes with no dependencies have depth 0 (X unchanged from Dagre), nodes depending on depth-0 nodes have depth 1 (X shifted by 50px), etc.
- [ ] In use-graph-layout.ts, diamond dependencies (node depending on two parents at different depths) use `max(parent depths) + 1`
- [ ] In dag-edge.tsx, `getSmoothStepPath` is called instead of `getBezierPath` with `borderRadius: 8`
- [ ] Single-plan builds (no edges, no dependencies) produce identical layout since depth=0 for all nodes and no edges use getSmoothStepPath
