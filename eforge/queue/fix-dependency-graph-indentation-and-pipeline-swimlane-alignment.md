---
title: Fix dependency graph indentation and pipeline swimlane alignment
created: 2026-04-01
---

# Fix dependency graph indentation and pipeline swimlane alignment

## Problem / Motivation

Two visual issues exist in the monitor UI pipeline view:

1. **Pipeline swimlanes**: When plans have dependencies, the `ThreadLineGutter` reserves a fixed-width gutter for ALL rows (including PRD and independent plans), pushing everything right. Only dependent plans should be indented - PRD and depth-0 plans should stay flush left. The eforge build added `depth={0} maxDepth={maxDepth}` to the PRD row which "fixed" alignment by making everything equally offset, but that is wrong.

2. **Graph tab**: Dependent plans are not indented in the ReactFlow dependency graph. A simple A->B chain places both nodes at the same X position, making the bezier edge look like a straight vertical bar. The desired result is tree-like indentation with proper connectors.

## Goal

PRD and independent plan rows render flush left with no gutter, dependent plan rows are indented proportionally to their dependency depth, and the graph tab shows tree-like horizontal indentation with L-shaped step connectors.

## Approach

### Fix 1: Pipeline swimlane indentation

**File**: `src/monitor/ui/src/components/pipeline/thread-pipeline.tsx`

1. **Remove `ThreadLineGutter` component entirely** (lines 702-721).
2. **Remove `maxDepth` prop** from `PlanRowProps` and all call sites - it is no longer needed.
3. **Remove `depth={0} maxDepth={maxDepth}` from the PRD PlanRow** (lines 626-627) - PRD should never be indented.
4. **In PlanRow render** (line 817), replace the gutter with a simple left margin on the row's outer div when `depth > 0`:

```tsx
// In PlanRow return, wrap the existing content
return (
  <div className="flex flex-col gap-1" style={{ marginLeft: (depth ?? 0) * 20 }}>
    {/* optional: vertical connector line for depth > 0 */}
    <div className="flex items-start gap-2 text-xs">
      {leftLabel}
      <div className="flex-1 flex flex-col gap-0.5">
        ...
      </div>
    </div>
  </div>
);
```

5. **Use `DEPTH_LEVEL_WIDTH = 20`** (increase from 8) for clearly visible indentation per level.

This produces:
- PRD (always depth undefined/0): flush left
- Plan 01 (depth=0, independent): flush left, aligns with PRD
- Plan 02 (depth=1, depends on Plan 01): indented 20px

**Vertical connector line** (optional): For depth > 0 rows, render a thin left border on the margin area to visually connect to the parent. This could be a `::before` pseudo-element or a small absolute-positioned div. Can be skipped if too complex - indentation alone communicates the dependency clearly enough.

### Fix 2: Graph tab - indent dependent plans with tree connectors

#### 2a. Add depth-based horizontal indentation

**File**: `src/monitor/ui/src/components/graph/use-graph-layout.ts`

After Dagre computes the layout, calculate dependency depth and apply horizontal offset:

- **Depth calc**: `depth(root) = 0`, `depth(node) = max(depth(dep) for dep in dependsOn) + 1`
- **Apply offset**: Add `DEPTH_INDENT * depth` (50px per level) to each node's X position
- Handles diamond dependencies correctly (max of all dependency depths + 1)
- Root nodes stay at their original X, children shift right progressively

#### 2b. Switch to step-style edges

**File**: `src/monitor/ui/src/components/graph/dag-edge.tsx`

Replace `getBezierPath` with `getSmoothStepPath` from `@xyflow/react`:

- Creates L-shaped connectors with rounded corners (`borderRadius: 8`)
- With the indentation from 2a, source and target are at different X positions, producing visible horizontal/vertical step segments
- No changes to the animated edge overlay - it uses the same path string

## Scope

**In scope:**
- Removing `ThreadLineGutter` component and `maxDepth` prop from pipeline view
- Reverting PRD depth/maxDepth props
- Replacing gutter with per-row `marginLeft` based on depth
- Increasing `DEPTH_LEVEL_WIDTH` from 8 to 20
- Computing dependency depth in graph layout and applying X offset (50px per level)
- Replacing `getBezierPath` with `getSmoothStepPath` in `dag-edge.tsx`

**Out of scope:**
- Vertical connector lines in the pipeline view (optional, skip if complex)

**Files to modify:**
1. `src/monitor/ui/src/components/pipeline/thread-pipeline.tsx`
2. `src/monitor/ui/src/components/graph/use-graph-layout.ts`
3. `src/monitor/ui/src/components/graph/dag-edge.tsx`

## Acceptance Criteria

1. `pnpm build` completes with no type errors.
2. In a build with dependent plans: PRD pill and independent plan pills align flush left; dependent plan pills are indented proportionally to their dependency depth.
3. In a build with NO dependencies: all pills render flush left with no gutter space.
4. Graph tab: root plans render at the left, dependent plans are indented rightward, and edges are L-shaped step connectors (not straight vertical bars).
5. Single-plan builds (no edges) render unchanged.
