---
id: plan-02-ui-diff-viewer
name: UI Diff Viewer
dependsOn: [plan-01-backend-diff-api]
branch: monitor-diff-viewer-heatmap-integration/ui-diff-viewer
---

# UI Diff Viewer

## Architecture Context

With the backend diff API in place (plan-01), this plan adds the UI layer: a Shiki-highlighted diff viewer component integrated into the heatmap as a split-pane layout. Users click a heatmap cell to see the actual diff for that plan+file combination, or click a file name to see stacked diffs from all plans that touched it.

The Shiki pattern is established in `plan-body-highlight.tsx` - lazy dynamic import, `github-dark` theme, `dangerouslySetInnerHTML` rendering. The diff viewer follows the same approach using `lang: 'diff'` for unified diff syntax highlighting.

## Implementation

### Overview

Five changes: (1) track `mergeCommits` (planId→SHA map) in the reducer from `merge:complete` events, (2) add `fetchFileDiff()` and `fetchPlanDiffs()` API functions, (3) create a `DiffViewer` component with Shiki highlighting, (4) restructure `FileHeatmap` as a split-pane layout with selection state, (5) make `HeatmapCell` clickable with visual selection feedback.

### Key Decisions

1. **`mergeCommits` in RunState** - maps planId to commitSha so the UI knows which plans have diffs available. Cells for plans without a commit SHA in `mergeCommits` remain non-clickable.
2. **Shiki `lang: 'diff'`** - Shiki natively supports unified diff syntax highlighting. No new dependencies needed - shiki is already installed (`^3.2.1`).
3. **Split-pane layout via flex** - heatmap grid on the left (existing), diff panel on the right. The diff panel appears when a file is selected and takes `flex-1` while the grid has a fixed/min width. No drag-to-resize - the split is automatic.
4. **Two click targets** - clicking a cell (blue/yellow square) shows the diff for that specific plan+file. Clicking a file name label shows stacked diffs from all plans that touched it, each with a plan header divider. Same cell click or Escape dismisses.
5. **Lazy-loaded Shiki instance** - the diff viewer creates and caches a Shiki highlighter on first open, same pattern as `plan-body-highlight.tsx`. The `diff` language is registered on init.

## Scope

### In Scope
- `mergeCommits` map in RunState populated from `merge:complete` events
- `fetchFileDiff()` and `fetchPlanDiffs()` API client functions
- `DiffViewer` component with Shiki `lang: 'diff'` highlighting
- Split-pane layout in `FileHeatmap` (grid left, diff right)
- Cell click → single plan+file diff
- File name click → stacked diffs from all plans
- Toggle/Escape to close diff panel
- `cursor-pointer` on touched cells, visual ring on selected cell
- Loading spinner, empty state ("No changes"), error state ("Commit not found"), "Diff too large" state, "Binary file" state
- `sessionId` prop threaded from `app.tsx` to `FileHeatmap`

### Out of Scope
- Diffs during active builds (before merge)
- Drag-to-resize split pane
- Inline diff view (only unified diff)

## Files

### Create
- `src/monitor/ui/src/components/heatmap/diff-viewer.tsx` — Shiki-highlighted diff viewer component. Props: `sessionId`, `planId`, `filePath`, `onClose`, and an optional `allPlanDiffs` mode for file-name clicks. Fetches diff from `/api/diff/...`, renders with Shiki `lang: 'diff'`, handles loading/error/empty/too-large/binary states. Close via X button or Escape key.

### Modify
- `src/monitor/ui/src/lib/reducer.ts` — Add `mergeCommits: Record<string, string>` to `RunState` and `initialRunState`. In the `merge:complete` handler, extract `commitSha` from event data and populate the map.
- `src/monitor/ui/src/lib/api.ts` — Add `fetchFileDiff(sessionId, planId, filePath)` returning `Promise<{ diff: string | null; commitSha: string; tooLarge?: boolean; binary?: boolean }>` and `fetchPlanDiffs(sessionId, planId)` returning `Promise<{ files: Array<{ path: string; diff: string | null; tooLarge?: boolean; binary?: boolean }>; commitSha: string }>`.
- `src/monitor/ui/src/components/heatmap/file-heatmap.tsx` — Add `sessionId` prop. Add `selectedFile: { path: string; planId: string | null } | null` state (null planId = file-name click showing all plans). Wrap the grid and a conditional `DiffViewer` panel in a flex row. Pass `onCellClick` and `onFileNameClick` callbacks down. Add Escape key listener.
- `src/monitor/ui/src/components/heatmap/heatmap-cell.tsx` — Add `onClick` and `isSelected` props. Apply `cursor-pointer` when `touched` is true. Show a `ring-2 ring-blue` highlight when `isSelected`. Call `onClick` on click when touched.
- `src/monitor/ui/src/app.tsx` — Pass `currentSessionId` as `sessionId` prop to `FileHeatmap`.

## Verification

- [ ] `pnpm build` succeeds (engine + monitor UI compile cleanly)
- [ ] `pnpm test` — all existing tests pass
- [ ] Clicking a touched (blue or yellow) heatmap cell opens a diff panel on the right with Shiki-highlighted unified diff content
- [ ] Clicking a file name label on the left shows stacked diffs from all plans that touched that file, each separated by a plan ID header
- [ ] Clicking the same cell again closes the diff panel
- [ ] Pressing Escape closes the diff panel
- [ ] Selected cell shows a `ring-2` visual highlight
- [ ] Touched cells show `cursor-pointer`, untouched cells show `cursor-default`
- [ ] Diff panel shows a loading spinner while the fetch is in progress
- [ ] Empty diff (file touched but no diff content) shows "No changes" message
- [ ] Missing/unreachable commit SHA shows "Commit not found" error message
- [ ] Large diffs (server returns `tooLarge: true`) show "Diff too large to display" message
- [ ] Binary files (server returns `binary: true`) show "Binary file" message
- [ ] `mergeCommits` in RunState is populated from `merge:complete` events that include `commitSha`
- [ ] `DiffViewer` component lazy-loads Shiki only on first render (not at import time)
