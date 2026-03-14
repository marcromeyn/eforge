---
id: plan-05-plan-preview
name: Slide-out plan file preview panel with shiki syntax highlighting
depends_on:
  - plan-02-react-foundation
branch: monitor-dashboard-prd/plan-preview
---

# Plan Preview

## Architecture Reference

This module implements [Component Architecture → preview/], [Integration Contracts → react-foundation → feature modules], and [Technical Decisions → 3. shiki for Syntax Highlighting] from the architecture.

Key constraints from architecture:
- shiki for syntax highlighting (VS Code TextMate grammars, async loading, pre-highlighted HTML)
- Plan content fetched once via `useApi()` hook calling `GET /api/plans/:runId` — no separate data fetch logic
- All state derives from `RunState` provided by the foundation's reducer — no separate SSE connection
- Feature modules render within the foundation's layout content area
- Dark theme aligns with the monitor's existing aesthetic (shiki's dark theme)
- Server-side data extraction: the `/api/plans/:runId` endpoint (added by react-foundation) extracts plan data from the `plan:complete` event JSON already in the DB

## Scope

### In Scope
- Slide-out panel component triggered by clicking a plan identifier (pipeline row or plan reference in the timeline)
- Rendering of plan file content: YAML frontmatter + markdown body with syntax highlighting via shiki
- Frontmatter metadata display: plan id, name, dependencies, branch, migrations (structured, not raw YAML)
- Panel open/close animation and keyboard dismiss (Escape key)
- Backdrop overlay that dims the main content when the panel is open
- Plan selection state: which plan is currently previewed, exposed via a context/callback so other modules can trigger it
- Loading and error states for plan data fetching
- Empty state when no plans are available (errand runs may have plan data, but the panel should handle missing data gracefully)

### Out of Scope
- Editing plan files from the monitor UI
- Syntax highlighting for languages other than YAML and markdown (plans are always YAML frontmatter + markdown)
- Plan diffing or version comparison
- File tree view of the plan set directory
- Dependency graph visualization (module: `dependency-graph`)
- Wave timeline grouping (module: `wave-timeline`)

## Implementation Approach

### Overview

The plan preview is a slide-out panel that overlays from the right side of the main content area. When a user clicks a plan identifier anywhere in the UI (pipeline row, graph node), the panel slides in with the selected plan's content rendered with syntax highlighting.

The implementation has three layers: (1) a shared plan selection mechanism (context + callback) so any component can trigger the preview, (2) the panel shell with slide animation and dismiss behavior, (3) the content renderer using shiki for highlighting the plan body.

Plan data is fetched once per run via the foundation's `useApi()` hook calling `GET /api/plans/:runId`. The response is a `PlanFileContent[]` array. The panel looks up the selected plan by ID from this cached data — no per-plan fetch.

### Key Decisions

1. **Slide-out panel (not modal)** — A right-side slide-out panel keeps the main content partially visible, allowing users to reference the timeline or graph while reading a plan. Modals would fully occlude the content. The panel width is fixed at `640px` (wide enough for code/YAML readability without covering the entire viewport).

2. **Shared plan selection via React context** — A `PlanPreviewContext` provides `{ selectedPlanId, openPreview(planId), closePreview() }`. Any component (pipeline row, graph node) can call `openPreview(planId)` without prop drilling. The context lives in the plan-preview module, and the provider wraps the main content area in `app.tsx`.

3. **shiki with lazy grammar loading** — shiki grammars are loaded asynchronously on first panel open, not at app startup. Only `yaml` and `markdown` grammars are loaded. The highlighter instance is cached in a ref so subsequent opens are instant. This avoids adding to initial page load time.

4. **Split rendering: structured metadata + highlighted body** — Rather than highlighting the entire file as one block, the panel parses the plan content to separate YAML frontmatter from the markdown body. Frontmatter fields (id, name, dependencies, branch) are rendered as a structured metadata card with labels and values. The markdown body is highlighted as a single code block. This gives better UX than a raw file dump.

5. **Frontmatter parsing on the client** — The plan `body` field contains the full file content (YAML frontmatter delimited by `---` + markdown body). The panel splits on `---` delimiters client-side to extract metadata and body. This is simple string parsing (no YAML library needed — the metadata fields are displayed from the API response's structured `id`, `name`, `dependsOn`, `branch` fields, not parsed from raw YAML). The raw YAML block is still shown highlighted for reference.

## Files

### Create

- `src/monitor/ui/src/components/preview/plan-preview-context.tsx` — React context for plan selection. Exports `PlanPreviewProvider`, `usePlanPreview()` hook returning `{ selectedPlanId: string | null, openPreview: (planId: string) => void, closePreview: () => void }`. The provider manages `selectedPlanId` state via `useState`. Closing the panel sets it to `null`.

- `src/monitor/ui/src/components/preview/plan-preview-panel.tsx` — The slide-out panel component. Renders as a fixed-position overlay on the right side of the viewport, `640px` wide, full height. Contains: close button (X) in the header, structured metadata card, highlighted plan body. Consumes `usePlanPreview()` for open/close state and `useApi('/api/plans/' + runId)` for plan data. Looks up the selected plan from the fetched plan array by ID. Handles loading (skeleton), error (message), and not-found (plan ID doesn't match any fetched plan) states. Slide-in/out animation via CSS `transform: translateX()` transition. Listens for `Escape` keydown to close. Renders a semi-transparent backdrop overlay behind the panel that also closes on click.

- `src/monitor/ui/src/components/preview/plan-body-highlight.tsx` — Component that renders a plan's markdown body with shiki syntax highlighting. Accepts `content: string` (the markdown body portion, after frontmatter). Lazily initializes a shiki highlighter on first render (stored in a `useRef`), loading only `yaml` and `markdown` themes/grammars. Splits the content at `---` delimiters: if frontmatter is detected, highlights the YAML block and the markdown body separately. Returns pre-highlighted HTML via `dangerouslySetInnerHTML`. Shows a loading spinner while shiki initializes. Uses a dark theme (e.g., `github-dark` or `one-dark-pro`) consistent with the monitor aesthetic.

- `src/monitor/ui/src/components/preview/plan-metadata.tsx` — Structured metadata card for a plan. Accepts the plan's structured fields: `id`, `name`, `dependsOn`, `branch`, `migrations`. Renders as a compact card with labeled rows: Name (bold), ID (monospace), Branch (monospace with copy button), Dependencies (comma-separated list or "none"), Migrations (count + expandable list if present). Uses shadcn `Card` and `Badge` components for styling.

- `src/monitor/ui/src/components/preview/index.ts` — Barrel export: re-exports `PlanPreviewProvider`, `usePlanPreview`, and `PlanPreviewPanel`.

### Modify

- `src/monitor/ui/src/app.tsx` — Three changes:
  1. Import `PlanPreviewProvider` and `PlanPreviewPanel` from `./components/preview`.
  2. Wrap the main content area with `<PlanPreviewProvider>`.
  3. Render `<PlanPreviewPanel runId={selectedRunId} />` inside the provider (it self-manages visibility based on `selectedPlanId`).

- `src/monitor/ui/src/components/pipeline/pipeline-row.tsx` — Make the plan label clickable. Import `usePlanPreview()` and call `openPreview(planId)` on click. Add a hover cursor and subtle underline/highlight to indicate interactivity.

- `src/monitor/ui/src/components/timeline/event-card.tsx` — For events that have a `planId` field, make the plan ID text clickable. Import `usePlanPreview()` and call `openPreview(planId)` on click. Style consistently with the pipeline row click target.

- `src/monitor/ui/package.json` — Verify `shiki` is listed as a dependency (should already be included from the foundation module's scaffold). Add if missing.

## Testing Strategy

### Unit Tests

- **Plan body splitting** (`test/monitor-plan-preview.test.ts`): Test the frontmatter/body split logic with:
  - Standard plan file (YAML frontmatter + markdown body)
  - Plan file with no frontmatter (just markdown)
  - Plan file with empty body (frontmatter only)
  - Plan file with multiple `---` delimiters in the body (only the first pair delimits frontmatter)
  - Empty string input

- **Plan metadata rendering**: Test that the metadata component correctly displays all fields, handles missing optional fields (no migrations, no dependencies), and renders dependency lists.

### Integration Tests

- **Build integration**: `pnpm build` succeeds with shiki bundled — Vite tree-shakes unused grammars
- **Type checking**: `pnpm type-check` passes across both workspaces
- **Panel interaction**: Open panel via pipeline row click, verify plan content renders, close via Escape and backdrop click

## Verification

- [ ] `pnpm type-check` passes with all new preview component files
- [ ] `pnpm test` passes — plan body splitting tests pass
- [ ] `pnpm build` succeeds — Vite bundles shiki with only YAML + markdown grammars
- [ ] Clicking a plan ID in the pipeline row opens the preview panel with that plan's content
- [ ] Clicking a plan ID in an event card opens the preview panel
- [ ] Panel slides in from the right with smooth CSS transition
- [ ] Panel header shows plan name and a close button (X)
- [ ] Metadata card displays: plan name, ID, branch, dependencies list, migration count
- [ ] Plan body renders with syntax highlighting: YAML frontmatter block + markdown body block
- [ ] Syntax highlighting uses a dark theme consistent with the monitor aesthetic
- [ ] Pressing Escape closes the panel
- [ ] Clicking the backdrop overlay closes the panel
- [ ] Loading state shows while shiki initializes (first open only — subsequent opens are instant)
- [ ] Error state displays if `/api/plans/:runId` fails
- [ ] Panel handles missing plan gracefully (plan ID not found in fetched data)
- [ ] Panel works for errand runs (single plan) and multi-plan runs (excursion/expedition)
- [ ] shiki grammars load lazily — no impact on initial page load time
- [ ] Panel does not interfere with other components (timeline scrolling, graph interaction continue to work behind the backdrop)
