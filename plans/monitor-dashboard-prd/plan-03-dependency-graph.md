---
id: plan-03-dependency-graph
name: Interactive ReactFlow DAG visualization with wave swim lanes and status
  coloring
depends_on:
  - plan-02-react-foundation
branch: monitor-dashboard-prd/dependency-graph
---

# Dependency Graph

## Architecture Reference

This module implements [Component Architecture → graph/], [Integration Contracts → react-foundation → feature modules], and [Technical Decisions → 2. ReactFlow for DAG] from the architecture.

Key constraints from architecture:
- ReactFlow is the rendering library (React-native, dagre/elkjs for automatic layout, custom nodes)
- All state derives from `EforgeEvent`s via the shared `RunState` from the foundation's `useReducer` — no separate SSE connection
- Orchestration config fetched once via `useApi()` hook calling `GET /api/orchestration/:runId`
- Live status updates flow through the existing SSE stream (`wave:start`, `build:*`, `merge:*` events)
- Feature modules render within the foundation's layout content area
- Graceful degradation: errand runs (single node, no waves) render a minimal graph; the graph is simply absent if orchestration data is unavailable

## Scope

### In Scope
- ReactFlow DAG rendering: plan nodes, dependency edges as directed arrows
- Automatic layout via dagre (top-to-bottom, grouped by wave)
- Wave swim lanes: visual grouping of nodes by wave with labeled lane backgrounds
- Node status coloring: pending, running, completed, failed, blocked, merged — updated in real-time from `RunState.plans`
- Click-to-highlight: clicking a node highlights its direct dependencies and dependents, dims others
- Real-time updates: node colors and statuses change as `wave:start`, `build:*`, and `merge:*` events arrive
- Custom node component showing plan name, status icon, and brief info (wave number)
- Edge styling: animated edges for active dependencies (running plan), solid for completed, dashed for pending
- Tab or panel integration within the foundation's main content area
- Support for all three modes: errand (1 node), excursion (flat graph, 1 wave), expedition (multi-wave DAG)

### Out of Scope
- Plan file preview on node click (module: `plan-preview` — this module only highlights dependencies)
- Wave-level timeline grouping (module: `wave-timeline`)
- File change heatmap overlay (module: `file-heatmap`)
- Editing the graph or reordering plans
- 3D or animated graph transitions beyond ReactFlow built-ins
- Custom edge routing algorithms (dagre defaults are sufficient)

## Implementation Approach

### Overview

The dependency graph consumes the `OrchestrationConfig` (fetched via REST on run selection) and live `RunState` (from the SSE-driven reducer) to render an interactive DAG. On mount, the component fetches orchestration data, computes layout with dagre, and renders nodes grouped by wave. As events stream in, node colors update reactively from `RunState.plans` without re-layout.

The implementation has three layers: (1) data transformation — converting `OrchestrationConfig` + `RunState` into ReactFlow nodes/edges, (2) layout — dagre positioning with wave grouping, (3) rendering — custom node/edge components with status-driven styling.

### Key Decisions

1. **dagre for layout (not elkjs)** — dagre is lighter, well-tested with ReactFlow, and sufficient for the expected graph sizes (< 50 nodes for large expeditions). elkjs would add bundle size for features we don't need (compound nodes, ports). dagre's top-to-bottom rankdir naturally maps to wave ordering.

2. **Wave swim lanes as background group nodes** — ReactFlow supports group/parent nodes. Each wave is a transparent background node spanning the width of its children, with a label ("Wave 1", "Wave 2"). dagre assigns ranks that align with waves since all nodes in a wave have the same topological depth. This is simpler and more maintainable than SVG overlays.

3. **Reactive status updates without re-layout** — The dagre layout runs once when orchestration data loads (or when the graph structure changes, which it doesn't during a run). Status changes only update node `data` props, causing ReactFlow to re-render individual nodes without recalculating positions. This keeps the graph stable during execution.

4. **Highlight via local component state** — Clicking a node sets a `selectedNodeId` state. The `useMemo` that builds nodes/edges reads this to apply highlight/dim classes. No global state needed — the interaction is purely visual and local to the graph component.

5. **Fit view on initial render** — Use ReactFlow's `fitView` to ensure the entire graph is visible regardless of node count. Users can pan and zoom from there.

## Files

### Create

- `src/monitor/ui/src/components/graph/dependency-graph.tsx` — Main graph component. Accepts `orchestration: OrchestrationConfig | null` and `planStatuses: Map<string, PlanStatus>` props. Orchestrates data flow: computes layout, renders `<ReactFlow>` with custom nodes/edges. Manages `selectedNodeId` state for highlight interaction. Handles the empty/loading states (no orchestration data, errand mode with single node). Uses `useMemo` to derive ReactFlow nodes/edges from props, avoiding unnecessary re-layout.

- `src/monitor/ui/src/components/graph/dag-node.tsx` — Custom ReactFlow node component. Renders plan name, status icon (spinner for running, checkmark for completed, X for failed, lock for blocked, git-merge icon for merged, circle for pending), and wave label. Background color derived from status. Handles highlight/dim styling via a `highlighted` data prop. Uses `Handle` components for source (bottom) and target (top) connection points.

- `src/monitor/ui/src/components/graph/dag-edge.tsx` — Custom ReactFlow edge component. Extends `BezierEdge` with status-aware styling: animated dashes for edges where the target is running, solid colored for completed paths, muted for pending. Uses ReactFlow's `BaseEdge` + `getBezierPath` for rendering.

- `src/monitor/ui/src/components/graph/use-graph-layout.ts` — Hook encapsulating dagre layout logic. Takes `OrchestrationConfig` plans and returns positioned ReactFlow nodes and edges. Configures dagre with `rankdir: 'TB'` (top-to-bottom), `ranksep` and `nodesep` for spacing. Creates wave group nodes as ReactFlow parent nodes. Assigns each plan node to its wave group via `parentId`. Returns `{ nodes, edges, isLayoutReady }`. Layout runs only when the plan list reference changes (not on status updates).

- `src/monitor/ui/src/components/graph/graph-status.ts` — Pure utility mapping `PlanStatus` (from `RunState`) to visual properties: `{ color: string; bgColor: string; icon: string; animated: boolean }`. Centralizes the status-to-style mapping so `dag-node.tsx` and `dag-edge.tsx` stay simple.

- `src/monitor/ui/src/components/graph/index.ts` — Barrel export for the graph module: re-exports `DependencyGraph` component.

### Modify

- `src/monitor/ui/src/app.tsx` — Add the dependency graph as a tab or panel in the main content area. Import `DependencyGraph` from `./components/graph`. Pass `orchestration` data (from `useApi('/api/orchestration/' + runId)`) and `runState.plans` as props. Add a "Graph" tab alongside the existing "Timeline" view (using a simple tab state or shadcn Tabs component). Only render the Graph tab for multi-plan runs (excursion/expedition mode), or show a minimal single-node graph for errands.

- `src/monitor/ui/src/lib/types.ts` — Add `GraphNode` and `GraphEdge` type aliases if needed for the dagre layout hook, and ensure `PlanStatus` type includes all statuses referenced by the graph (pending, running, completed, failed, blocked, merged). These types likely already exist from the foundation module's reducer work; verify and extend if needed.

- `src/monitor/ui/package.json` — Add `@dagrejs/dagre` as a dependency (the dagre layout library). `@xyflow/react` should already be listed from the foundation module's scaffold. Verify and add if missing.

## Testing Strategy

### Unit Tests

- **Graph layout hook** (`test/monitor-graph-layout.test.ts`): Test `useGraphLayout` (or the pure layout function it wraps) with various plan configurations:
  - Single plan (errand): 1 node, 0 edges, 1 wave group
  - Three independent plans (excursion): 3 nodes, 0 edges, 1 wave group
  - Linear dependency chain (A → B → C): 3 nodes, 2 edges, 3 wave groups
  - Diamond pattern (A → B, A → C, B → D, C → D): 4 nodes, 4 edges, 3 wave groups
  - Verify node positions are assigned (non-zero x/y) and wave group nodes contain their children
  - Verify edges reference valid source/target node IDs

- **Status mapping** (`test/monitor-graph-status.test.ts`): Test `getStatusStyle()` for each plan status value. Verify all 6 statuses return valid color/icon values. Test that unknown statuses fall back gracefully.

- **Node/edge derivation**: Test the `useMemo` logic that combines layout positions with live plan statuses — ensure status changes produce new node data without changing positions.

### Integration Tests

- **Visual smoke test**: `pnpm build` succeeds with the graph module included. The ReactFlow component renders without console errors when given sample orchestration data.
- **Type checking**: `pnpm type-check` passes across both workspaces.

## Verification

- [ ] `pnpm type-check` passes with all new graph component files
- [ ] `pnpm test` passes — new graph layout and status mapping tests pass
- [ ] `pnpm build` succeeds — Vite bundles the ReactFlow dependency graph component
- [ ] Errand run (single plan): renders one node with correct status, no edges, no wave lanes
- [ ] Excursion run (multiple independent plans): renders nodes in a single wave lane, no edges between them
- [ ] Expedition run (multi-wave DAG): renders nodes grouped by wave swim lanes, directed edges showing dependencies
- [ ] Node colors update in real-time as `build:start`, `build:complete`, `build:failed`, `merge:complete` events arrive
- [ ] Clicking a node highlights its dependencies (upstream) and dependents (downstream), dimming unrelated nodes
- [ ] Clicking the background or the same node again clears the highlight
- [ ] Wave swim lane labels show "Wave 1", "Wave 2", etc. with correct node grouping
- [ ] Graph auto-fits to viewport on initial render; pan and zoom work via mouse/trackpad
- [ ] Edge animation: edges leading to a currently-running node show animated dashes; completed edges are solid
- [ ] Graph tab only appears when orchestration data is available (hidden for runs without orchestration config)
