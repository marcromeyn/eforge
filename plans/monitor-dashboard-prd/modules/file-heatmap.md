# File Change Heatmap

## Architecture Reference

This module implements the [File Change Heatmap] feature from the architecture, consuming the `build:files_changed` event added by the `engine-events` module and rendering within the React foundation established by `react-foundation`.

Key constraints from architecture:
- All monitor state derives from `EforgeEvent`s — the heatmap reconstructs from stored `build:files_changed` events, no separate data source
- Feature modules consume shared state from `useEforgeEvents()` and render within the layout's content areas — no independent SSE connections
- Component organization by feature domain — heatmap components live in `components/heatmap/`
- No external state library — heatmap state derives from `RunState.fileChanges` populated by the reducer

## Scope

### In Scope
- Grid visualization: rows = files, columns = plans, cells colored by overlap
- Conflict risk classification: same-wave overlap (high risk) vs. cross-wave overlap (lower risk)
- Real-time updates as `build:files_changed` events arrive via SSE
- Only shown for multi-plan runs (excursion/expedition) — hidden for errand mode
- Summary statistics: total files changed, number of overlapping files, highest-risk files

### Out of Scope
- Diff content preview (clicking a file does not show the actual diff)
- Historical conflict data across runs
- File-level merge conflict resolution suggestions
- Integration with the plan-preview panel (clicking a plan column does not open preview — that's plan-preview's concern)

## Implementation Approach

### Overview

The heatmap renders a matrix where each row is a unique file path and each column is a plan. Cells are colored to indicate whether a plan touched that file, with stronger colors for files touched by multiple plans in the same wave (high merge conflict risk). The component consumes `RunState.fileChanges` (a `Map<string, string[]>` of planId → files) and `RunState.waves` to determine wave co-membership. Files are sorted by overlap count (most overlapping first), and plans are ordered by wave assignment.

### Key Decisions

1. **CSS grid for the matrix (not SVG or canvas)** — The file count per plan is typically small (tens to low hundreds of files). A CSS grid with Tailwind classes is simpler, more accessible, and style-consistent with shadcn/ui. Tooltip on hover shows file path and plan names. If a run has 200+ unique files, show top 50 by overlap with an expandable "show all" toggle.

2. **Color scale: 3 tiers** — Single-plan file (neutral/dim), cross-wave overlap (amber/warning), same-wave overlap (red/danger). This directly maps to merge conflict risk: same-wave plans run in parallel on separate worktrees, so overlapping files will conflict at merge time. Cross-wave plans merge sequentially, so Git can often auto-resolve.

3. **Derive wave membership from RunState** — The reducer already tracks `waves: WaveInfo[]` with `planIds` per wave. The heatmap cross-references this to classify overlap risk without needing additional server endpoints or data.

4. **Tab in main content area (not a panel)** — The heatmap is a top-level view alongside the timeline/graph, selectable via tab. It needs horizontal space for the plan columns and vertical space for the file list — a slide-out panel would be too narrow.

5. **Graceful empty states** — Before any `build:files_changed` events arrive, show a placeholder message. For errand runs (single plan), the heatmap tab is hidden entirely since there's no overlap to visualize.

## Files

### Create

- `src/monitor/ui/src/components/heatmap/file-heatmap.tsx` — Main heatmap container component. Reads `fileChanges` and `waves` from `RunState` via the SSE hook. Computes the overlap matrix, sorts files by risk, renders the grid. Handles the "show all" expansion for large file sets.

- `src/monitor/ui/src/components/heatmap/heatmap-cell.tsx` — Individual cell component. Accepts `touched: boolean`, `riskLevel: 'none' | 'single' | 'cross-wave' | 'same-wave'`. Renders a colored square with tooltip (file path, plan name, risk label). Uses shadcn `Tooltip` for hover.

- `src/monitor/ui/src/components/heatmap/heatmap-legend.tsx` — Color legend explaining the 3 risk tiers. Compact horizontal bar below the grid header.

- `src/monitor/ui/src/components/heatmap/heatmap-summary.tsx` — Summary card above the grid: total unique files, files with overlap, highest-risk files (same-wave overlaps). Uses shadcn `Card`.

- `src/monitor/ui/src/components/heatmap/use-heatmap-data.ts` — Custom hook that transforms `RunState.fileChanges` + `RunState.waves` into the heatmap's derived data model:
  ```typescript
  interface HeatmapData {
    files: HeatmapFile[];       // Sorted by overlap count desc
    plans: HeatmapPlan[];       // Ordered by wave, then alphabetical
    matrix: Map<string, Map<string, RiskLevel>>; // file → planId → risk
    stats: { totalFiles: number; overlappingFiles: number; sameWaveOverlaps: number };
  }

  interface HeatmapFile {
    path: string;
    overlapCount: number;       // Number of plans touching this file
    maxRisk: RiskLevel;         // Highest risk level across all plan pairs
  }

  interface HeatmapPlan {
    id: string;
    name: string;
    waveIndex: number;
  }

  type RiskLevel = 'none' | 'single' | 'cross-wave' | 'same-wave';
  ```
  Memoized with `useMemo` to avoid recomputation on unrelated state changes.

- `src/monitor/ui/src/components/heatmap/index.ts` — Barrel export for `FileHeatmap` component.

### Modify

- `src/monitor/ui/src/lib/reducer.ts` — Add `build:files_changed` case to the reducer. On receiving the event, update `state.fileChanges` map (set `planId → files`). The `fileChanges` field should already be declared in `RunState` by the react-foundation module (initialized as empty `Map`); if not, add `fileChanges: Map<string, string[]>` to the interface and initialize it in the initial state.

- `src/monitor/ui/src/app.tsx` (or the layout component that manages tabs/views) — Add "Heatmap" tab to the main content area tab bar. Conditionally render only when `runState.plans.size > 1` (multi-plan run). Import and render `FileHeatmap` when the tab is active.

## Testing Strategy

### Unit Tests

- **`use-heatmap-data` hook logic** — Test the overlap computation and risk classification as a pure function (extract the computation logic into a testable function, test the hook via `renderHook` or test the computation directly):
  - Single plan, no overlaps → all files `single` risk
  - Two plans in the same wave sharing files → `same-wave` risk
  - Two plans in different waves sharing files → `cross-wave` risk
  - Mixed scenario with some same-wave and some cross-wave overlaps
  - Empty fileChanges map → empty heatmap data
  - Files sorted by overlap count descending

- **Reducer `build:files_changed` case** — Test that dispatching the event correctly populates `fileChanges` map, handles multiple events for different plans, and is idempotent for duplicate events.

### Integration Tests

- **Component rendering** — Verify `FileHeatmap` renders the correct number of rows/columns given mock `RunState` data. Verify cells have correct risk-level styling. Verify the heatmap is hidden for single-plan runs.

## Verification

- [ ] Heatmap renders a file-by-plan grid for multi-plan runs with correct cell coloring
- [ ] Files touched by 2+ plans in the same wave are highlighted as high risk (red)
- [ ] Files touched by plans in different waves are highlighted as lower risk (amber)
- [ ] Heatmap updates in real-time as `build:files_changed` events arrive via SSE
- [ ] Summary card shows accurate counts (total files, overlapping files, same-wave overlaps)
- [ ] Legend clearly explains the 3 risk tiers
- [ ] Heatmap tab is hidden for errand (single-plan) runs
- [ ] Large file sets (100+ files) are handled gracefully with "show all" expansion
- [ ] Tooltip on cell hover shows file path, plan name, and risk classification
- [ ] `pnpm type-check` passes with all new components
- [ ] Unit tests pass for overlap computation and risk classification logic
