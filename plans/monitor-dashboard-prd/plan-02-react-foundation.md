---
id: plan-02-react-foundation
name: Vite+React+shadcn SPA setup, server updates for static assets and new API
  endpoints, feature parity with existing vanilla JS UI
depends_on: []
branch: monitor-dashboard-prd/react-foundation
---

# React Foundation

## Architecture Reference

This module implements [Core Architectural Principles → 1-5], [Integration Contracts → react-foundation → feature modules], and [Integration Contracts → server → feature modules] from the architecture.

Key constraints from architecture:
- Feature parity first — reproduce every existing feature before adding new ones
- Vite builds to static assets served by the existing `node:http` server (no separate dev server in production)
- SSE consumption moves from raw `EventSource` to a React hook
- `useReducer` for run state, `useState` for UI state, Context only for cross-cutting concerns
- React components organized by feature domain, not atomic design hierarchy
- Monorepo-style UI package at `src/monitor/ui/` with its own `package.json`
- Two new REST endpoints (`/api/orchestration/:runId`, `/api/plans/:runId`) added server-side
- Dark theme carried forward using shadcn/ui theming

## Scope

### In Scope
- Vite + React + TypeScript project scaffold at `src/monitor/ui/`
- shadcn/ui initialization with dark theme matching current monitor aesthetic
- `useEforgeEvents()` hook — SSE subscription with reconnection, replay, and state accumulation via `useReducer`
- `useApi()` hook — REST data fetching for orchestration config and plan content
- `RunState` reducer that processes `EforgeEvent`s into normalized state
- Layout shell: header (title, connection status), sidebar (run list), main content area
- Summary cards (duration, events, tokens, cost, plans)
- Pipeline visualization (per-plan stage progress)
- Event timeline with event cards, verbose toggle, auto-scroll
- Run list sidebar with status badges, auto-selection of latest run
- New run polling (2s interval, same as current)
- Server updates: static asset serving for Vite-built files, 2 new REST endpoints
- Build pipeline: `pnpm build` runs both tsup and Vite, tsup `onSuccess` updated
- Dev workflow: `pnpm dev:monitor` script for Vite dev server with SSE proxy
- Shared types re-exported from engine's `events.ts` for UI consumption

### Out of Scope
- Dependency graph visualization (module: `dependency-graph`)
- Wave-level timeline grouping (module: `wave-timeline`)
- Plan file preview panel (module: `plan-preview`)
- File change heatmap (module: `file-heatmap`)
- `build:files_changed` event type (module: `engine-events`)
- Mobile-responsive layout
- Any engine changes

## Implementation Approach

### Overview

The implementation proceeds in four phases: (1) scaffold the Vite+React project, (2) update the server to serve static assets and add REST endpoints, (3) build the React app with feature-parity to the existing vanilla JS UI, (4) integrate the build pipeline.

The React app is a faithful port of the ~770-line `index.html` into structured components. All existing behavior is preserved: SSE streaming with reconnection, run list with auto-selection, summary cards, pipeline visualization, event timeline with verbose toggle, and auto-scroll. The component structure is designed to accommodate the feature modules (graph, preview, wave-timeline, heatmap) that depend on this foundation.

### Key Decisions

1. **pnpm workspaces for the UI package** — The UI at `src/monitor/ui/` gets its own `package.json` with React, ReactFlow, shadcn/ui, and Vite as dependencies. A `pnpm-workspace.yaml` at the root declares `src/monitor/ui` as a workspace member. This keeps UI dependencies out of the engine's dependency tree while allowing direct TypeScript imports from the engine via relative paths.

2. **Tailwind CSS v4 + shadcn/ui** — shadcn/ui provides the component library. Tailwind CSS handles utility styling. The dark theme uses CSS custom properties that map to the existing monitor's color palette (`--bg: #0d1117`, etc.) for visual continuity. shadcn's `new-york` style variant matches the compact, developer-tool aesthetic.

3. **Event reducer as the state backbone** — A single `useReducer` processes every SSE event into a `RunState` object. This is the core data structure that all components consume. The reducer handles plan status tracking, token/cost accumulation, wave tracking, and event storage — everything the existing vanilla JS does in mutable variables. Feature modules will extend this reducer (or compose alongside it) for their specialized state needs.

4. **SSE hook with built-in reconnection** — The `useEforgeEvents()` hook wraps `EventSource`, handles `Last-Event-ID` for replay after reconnection, parses events, and dispatches to the reducer. It tracks connection status (connected/connecting/disconnected) exposed via context for the header indicator.

5. **Server serves `dist/monitor-ui/` with content-type detection** — Replace the single-file HTML cache with `node:http` static file serving that handles `.js`, `.css`, `.html`, and other asset types with correct MIME types. Falls back to `index.html` for SPA client-side routing (though currently no router is needed). The `UI_DIR` constant already points to `dist/monitor-ui/`, which is where Vite outputs its build.

6. **REST endpoints extract data from existing event JSON** — The two new endpoints (`/api/orchestration/:runId` and `/api/plans/:runId`) query the `events` table for `plan:complete` events belonging to the run, parse the JSON `data` column, and extract the relevant fields. No DB schema changes needed.

7. **Vite dev proxy for local development** — `vite.config.ts` configures a proxy from `/api` to `http://localhost:4567` so the Vite dev server can connect to a running eforge monitor server for SSE and REST data during development.

## Files

### Create

#### UI Project Scaffold
- `src/monitor/ui/package.json` — UI workspace package with dependencies: react, react-dom, @types/react, @types/react-dom, @xyflow/react, shiki, tailwindcss, vite, @vitejs/plugin-react, typescript
- `src/monitor/ui/vite.config.ts` — Vite config: React plugin, `outDir: '../../../dist/monitor-ui'`, dev proxy for `/api` to `http://localhost:4567`
- `src/monitor/ui/tsconfig.json` — TypeScript config extending the root, with JSX support and path aliases for engine types
- `src/monitor/ui/index.html` — Vite entry HTML (minimal, mounts React app)
- `src/monitor/ui/postcss.config.js` — PostCSS config for Tailwind
- `src/monitor/ui/components.json` — shadcn/ui config (new-york style, dark theme defaults)

#### React App Core
- `src/monitor/ui/src/main.tsx` — React entry point, renders `<App />` into `#root`
- `src/monitor/ui/src/app.tsx` — Top-level `<App />` component: wraps layout with providers, manages selected run state, initiates SSE connection
- `src/monitor/ui/src/globals.css` — Tailwind directives + shadcn/ui CSS variables mapped to existing monitor color palette

#### Hooks
- `src/monitor/ui/src/hooks/use-eforge-events.ts` — SSE hook: `EventSource` management, reconnection with `Last-Event-ID`, event parsing, dispatches to reducer. Returns `{ runState, connectionStatus }`. Cleans up on unmount or runId change.
- `src/monitor/ui/src/hooks/use-api.ts` — REST fetching hook: `useApi<T>(url)` returns `{ data, loading, error, refetch }`. Used for orchestration config and plan content endpoints.
- `src/monitor/ui/src/hooks/use-auto-scroll.ts` — Auto-scroll hook: monitors scroll position on a ref'd container, provides `{ autoScroll, enableAutoScroll }` state.

#### State Management
- `src/monitor/ui/src/lib/reducer.ts` — `RunState` type definition and `eforgeReducer` function. Processes each `EforgeEvent` into normalized state: plan statuses, token/cost accumulation, event list, duration tracking. Mirrors the logic in the current `processEvent()` and `renderMain()` functions.
- `src/monitor/ui/src/lib/types.ts` — Shared UI types: `PlanStatus`, `ConnectionStatus`, `SummaryStats`, etc. Re-exports key types from engine `events.ts`.
- `src/monitor/ui/src/lib/api.ts` — API client: typed functions for `fetchRuns()`, `fetchLatestRunId()`, `fetchOrchestration(runId)`, `fetchPlans(runId)`.
- `src/monitor/ui/src/lib/format.ts` — Formatting utilities ported from vanilla JS: `formatTime()`, `formatDuration()`, `formatNumber()`, `escapeHtml()`.

#### Layout Components
- `src/monitor/ui/src/components/layout/app-layout.tsx` — Grid layout shell: header, sidebar, main content. Mirrors existing `.layout` grid (`260px 1fr`).
- `src/monitor/ui/src/components/layout/header.tsx` — Header bar: "eforge monitor" title + connection status dot (green/yellow/gray with pulse animation).
- `src/monitor/ui/src/components/layout/sidebar.tsx` — Run list sidebar: fetches runs from `/api/runs`, renders run items with command, plan set, status badge, time. Highlights active run. Handles run selection via callback.
- `src/monitor/ui/src/components/layout/run-item.tsx` — Individual run entry in the sidebar list.

#### Common Components
- `src/monitor/ui/src/components/common/summary-cards.tsx` — Summary cards row: duration, events, tokens, cost, plans. Accepts `SummaryStats` props.
- `src/monitor/ui/src/components/common/status-badge.tsx` — Status badge component (running/completed/failed) with color styling.

#### Pipeline Components
- `src/monitor/ui/src/components/pipeline/pipeline.tsx` — Pipeline container: renders pipeline rows for each tracked plan.
- `src/monitor/ui/src/components/pipeline/pipeline-row.tsx` — Per-plan pipeline row: label + 4 stage indicators (implement → review → evaluate → complete) with active/done/failed coloring.

#### Timeline Components
- `src/monitor/ui/src/components/timeline/timeline.tsx` — Event timeline container: renders event cards, manages verbose filter.
- `src/monitor/ui/src/components/timeline/event-card.tsx` — Individual event card: type badge (colored by category), summary text, expandable detail section, elapsed time. Handles verbose (agent:*) event hiding.
- `src/monitor/ui/src/components/timeline/timeline-controls.tsx` — Controls bar: "Show agent events" checkbox toggle.

#### shadcn/ui Components (generated via CLI)
- `src/monitor/ui/src/components/ui/card.tsx` — shadcn Card component
- `src/monitor/ui/src/components/ui/badge.tsx` — shadcn Badge component
- `src/monitor/ui/src/components/ui/button.tsx` — shadcn Button component
- `src/monitor/ui/src/components/ui/checkbox.tsx` — shadcn Checkbox component
- `src/monitor/ui/src/components/ui/scroll-area.tsx` — shadcn ScrollArea component
- `src/monitor/ui/src/components/ui/collapsible.tsx` — shadcn Collapsible component (for event detail expand/collapse)

#### Build Integration
- `pnpm-workspace.yaml` — Workspace config declaring `src/monitor/ui` as a member package

### Modify

- `src/monitor/server.ts` — Three changes:
  1. Replace `serveHTML()` with generic static file serving: read files from `UI_DIR`, detect MIME types by extension (`.js` → `application/javascript`, `.css` → `text/css`, `.html` → `text/html`, `.json` → `application/json`, `.svg` → `image/svg+xml`, `.woff2` → `font/woff2`), add cache headers for hashed assets. Fall back to `index.html` for unmatched paths (SPA routing).
  2. Add `GET /api/orchestration/:runId` endpoint: query events table for `plan:complete` type with matching run_id, parse JSON data, extract and return orchestration-relevant fields (plan ids, names, dependencies, branches, mode). Return `null` if no plan:complete event found.
  3. Add `GET /api/plans/:runId` endpoint: same query as orchestration, but extract and return plan file content (id, name, body). Return empty array if no plan:complete event found.
  4. Add CORS headers to new endpoints (matching existing pattern).

- `src/monitor/db.ts` — Add two new query methods to the `MonitorDB` interface and implementation:
  - `getEventsByType(runId: string, type: string): EventRecord[]` — Query events by run_id and type. Used by new REST endpoints to find `plan:complete` events without loading all events.
  - Add corresponding prepared statement.

- `tsup.config.ts` — Remove the `cp("src/monitor/ui", "dist/monitor-ui")` from `onSuccess`. The Vite build now outputs directly to `dist/monitor-ui/`. Keep the prompt copy as-is.

- `package.json` — Add scripts:
  - Update `"build"` to `"tsup && pnpm --filter monitor-ui build"` (or use a workspace run command)
  - Add `"dev:monitor": "pnpm --filter monitor-ui dev"` for Vite dev server with HMR
  - Add `"build:ui": "pnpm --filter monitor-ui build"` for standalone UI builds

## Testing Strategy

### Unit Tests
- **Reducer tests** (`test/monitor-reducer.test.ts`): Test `eforgeReducer` with sequences of `EforgeEvent`s, verifying correct state transitions for plan statuses, token accumulation, duration tracking, event storage. Test edge cases: empty events, unknown event types, duplicate events.
- **Format utility tests** (`test/monitor-format.test.ts`): Test `formatDuration()`, `formatNumber()`, `formatTime()` with various inputs including edge cases (0ms, negative, very large numbers).
- **API client tests** — Not unit tested (thin fetch wrappers). Covered by integration tests.

### Integration Tests
- **Build integration**: `pnpm build` produces `dist/monitor-ui/index.html` and `dist/monitor-ui/assets/` with JS/CSS bundles
- **Server static serving**: Start the monitor server, verify it serves the SPA `index.html` for `/`, serves JS/CSS assets with correct MIME types, returns JSON from `/api/runs`, `/api/orchestration/:runId`, `/api/plans/:runId`
- **Type checking**: `pnpm type-check` passes for both the engine and the UI workspace

## Verification

- [ ] `pnpm build` succeeds — both tsup (engine) and Vite (monitor UI) complete without errors
- [ ] `dist/monitor-ui/index.html` exists and references hashed JS/CSS assets
- [ ] `pnpm type-check` passes for both root and monitor-ui workspaces
- [ ] `pnpm test` passes — existing tests unaffected, new reducer tests pass
- [ ] Monitor server at `http://localhost:4567` serves the React SPA
- [ ] Run list sidebar loads and displays runs from `/api/runs`
- [ ] Selecting a run establishes SSE connection and streams events in real-time
- [ ] Summary cards update live: duration, event count, tokens, cost, plan progress
- [ ] Pipeline visualization shows per-plan stage progress (implement → review → evaluate → complete)
- [ ] Event timeline renders all event types with correct categorization and coloring
- [ ] Verbose toggle hides/shows `agent:*` events
- [ ] Auto-scroll follows new events; scrolling up disables it; "Auto-scroll" button re-enables
- [ ] Connection status indicator shows green (connected), yellow pulsing (connecting), gray (disconnected)
- [ ] SSE reconnection works: kill and restart server, verify events resume with replay
- [ ] New run auto-detection: start a new eforge run while monitor is open, verify it switches to the new run
- [ ] `/api/orchestration/:runId` returns orchestration config extracted from plan:complete event
- [ ] `/api/plans/:runId` returns plan file content extracted from plan:complete event
- [ ] `pnpm dev:monitor` starts Vite dev server with HMR and proxies API requests to eforge server
- [ ] Dark theme matches existing monitor aesthetic (dark backgrounds, monospace font, color-coded elements)
