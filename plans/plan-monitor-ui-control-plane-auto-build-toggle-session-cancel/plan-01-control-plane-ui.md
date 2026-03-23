---
id: plan-01-control-plane-ui
name: Monitor UI Control Plane — Auto-build Toggle + Session Cancel
depends_on: []
branch: plan-monitor-ui-control-plane-auto-build-toggle-session-cancel/control-plane-ui
---

# Monitor UI Control Plane — Auto-build Toggle + Session Cancel

## Architecture Context

The monitor UI (`src/monitor/ui/`) is a React SPA served by the monitor server. The daemon server already exposes `GET/POST /api/auto-build` and `POST /api/cancel/:sessionId` endpoints, but the UI has no controls wired to them. This plan adds the first interactive controls to the dashboard — an auto-build toggle in the header and a cancel button on running sessions in the sidebar.

The existing `use-api.ts` hook provides a generic `useApi()` pattern with refetch support. The `api.ts` module has 6 endpoint functions following a consistent pattern: fetch with base URL from `window.location.origin`, return parsed JSON or null on error. The sidebar's `SessionItem` already renders status-specific icons and handles click events with `onSelect`.

All three daemon endpoints return 503 when the daemon is not active (non-persistent mode). The UI must treat 503 as "daemon not available" and hide controls gracefully.

## Implementation

### Overview

1. Add three API client functions and one type to `api.ts`
2. Create a `useAutoBuild()` hook that polls auto-build state every 5s
3. Wire the hook into `App` and thread props to `Header` and `Sidebar`
4. Add auto-build toggle button to `Header` (left of connection status)
5. Add cancel button to `SessionItem` in `Sidebar` (visible on running sessions when daemon is active)

### Key Decisions

1. **Polling over SSE for auto-build state** — The daemon does not broadcast auto-build state changes via SSE. Polling at 5s matches the queue poll cadence and is sufficient for a toggle that changes infrequently. No backend changes required.
2. **`state === null` as daemon-inactive signal** — All three API functions return `null` on 503. The hook surfaces this as `state: null`, which consumers use to conditionally render controls. This is consistent with how the shutdown banner already handles daemon-only features.
3. **`cancelSession` in sidebar, not via hook** — Cancel is a fire-and-forget action (no polling needed), so it's called directly from the sidebar component via the imported API function rather than through a hook.
4. **Stop propagation on cancel click** — The `SessionItem` parent div has an `onSelect` click handler for session navigation. The cancel button must call `e.stopPropagation()` to prevent triggering session selection.

## Scope

### In Scope
- `AutoBuildState` type and three API functions (`fetchAutoBuild`, `setAutoBuild`, `cancelSession`)
- `useAutoBuild()` hook with 5s polling interval
- Auto-build toggle button in Header (green/dim dot, label, disabled while toggling)
- Cancel button (Square icon) on running session items in Sidebar
- Graceful handling of daemon unavailability (503 → hide controls)
- Error handling: toggle resets `toggling` on failure, cancel is fire-and-forget

### Out of Scope
- Backend/daemon endpoint changes
- SSE-based auto-build state broadcasting
- Any control plane features beyond toggle and cancel
- Queue management controls

## Files

### Create
- `src/monitor/ui/src/hooks/use-auto-build.ts` — Custom hook encapsulating auto-build state polling and toggle action

### Modify
- `src/monitor/ui/src/lib/api.ts` — Add `AutoBuildState` type and three functions: `fetchAutoBuild()`, `setAutoBuild()`, `cancelSession()`
- `src/monitor/ui/src/app.tsx` — Call `useAutoBuild()`, pass `autoBuildState`/`autoBuildToggling`/`onToggleAutoBuild` to Header, pass `daemonActive` to Sidebar
- `src/monitor/ui/src/components/layout/header.tsx` — Accept new props, render auto-build toggle button left of connection status (green dot when enabled, dim when disabled, disabled while toggling)
- `src/monitor/ui/src/components/layout/sidebar.tsx` — Accept `daemonActive` prop, add `Square` icon button to `SessionItem` when `group.status === 'running' && group.isSession && daemonActive`, call `cancelSession(group.key)` on click with `e.stopPropagation()`

## Implementation Details

### API Functions (`api.ts`)

```typescript
export interface AutoBuildState {
  enabled: boolean;
  watcher: { running: boolean; pid: number | null; sessionId: string | null };
}

export async function fetchAutoBuild(): Promise<AutoBuildState | null> {
  // GET /api/auto-build, return null on 503
}

export async function setAutoBuild(enabled: boolean): Promise<AutoBuildState | null> {
  // POST /api/auto-build with { enabled }, return null on 503
}

export async function cancelSession(sessionId: string): Promise<{ status: string; sessionId: string } | null> {
  // POST /api/cancel/{sessionId}, return null on 503 or 404
}
```

Follow the existing pattern in `api.ts`: use `fetch()` with relative URLs (e.g., `'/api/auto-build'`), parse JSON. Unlike existing functions which throw on error, these functions should catch errors and return `null` on non-ok responses (especially 503) since they target daemon-only endpoints that may not be available.

### useAutoBuild Hook (`use-auto-build.ts`)

```typescript
export function useAutoBuild(): {
  state: AutoBuildState | null;
  toggling: boolean;
  toggle: () => void;
}
```

- Use `useState` for `state` and `toggling`
- Use `useEffect` with `setInterval(fetchAutoBuild, 5000)` for polling, plus initial fetch
- `toggle()` sets `toggling = true`, calls `setAutoBuild(!state.enabled)`, updates `state` from response, sets `toggling = false`. On error, resets `toggling` to false without changing state.

### Header Toggle

- Position: flex item left of the existing connection status `<div className="ml-auto ...">`. Remove `ml-auto` from connection status and add it to a wrapper containing both toggle and connection status, or add the toggle before the `ml-auto` div.
- Visual: small button with a colored dot (green `bg-green-500` when enabled, gray `bg-zinc-600` when disabled), "Auto-build" text label, `disabled` attribute when `toggling` is true
- Title tooltip: `"Auto-build: ${state.enabled ? 'ON' : 'OFF'}"`
- Only render when `autoBuildState !== null`

### Sidebar Cancel Button

- Import `Square` from `lucide-react` (already imported: `CheckCircle2`, `XCircle`, `Loader2`)
- In `SessionItem`, after the existing content, conditionally render when `group.status === 'running' && group.isSession && daemonActive`
- Small icon button with `Square` icon (stop symbol), size 14
- `onClick={(e) => { e.stopPropagation(); cancelSession(group.key); }}` — fire-and-forget, sidebar refreshes naturally via polling
- Red hover state: `hover:text-red-400` or similar
- Title tooltip: "Cancel this session"
- Pass `daemonActive` from `Sidebar` props through to `SessionItem`

## Verification

- [ ] `pnpm type-check` exits with code 0 and zero type errors
- [ ] `pnpm build` exits with code 0
- [ ] `AutoBuildState` type exported from `api.ts` has `enabled: boolean` and `watcher: { running: boolean; pid: number | null; sessionId: string | null }`
- [ ] `fetchAutoBuild()` calls `GET /api/auto-build` and returns `null` on non-ok response
- [ ] `setAutoBuild(enabled)` calls `POST /api/auto-build` with JSON body `{ enabled }` and returns `null` on non-ok response
- [ ] `cancelSession(sessionId)` calls `POST /api/cancel/{sessionId}` and returns `null` on non-ok response (503 or 404)
- [ ] `useAutoBuild()` hook polls `fetchAutoBuild()` every 5000ms and returns `{ state, toggling, toggle }`
- [ ] `useAutoBuild().toggle()` sets `toggling` to `true` during the POST and resets to `false` on completion or error
- [ ] Header renders auto-build toggle only when `autoBuildState !== null`
- [ ] Header toggle button has `disabled` attribute when `toggling` is `true`
- [ ] Sidebar `SessionItem` renders cancel button only when `group.status === 'running' && group.isSession && daemonActive`
- [ ] Cancel button click calls `e.stopPropagation()` before calling `cancelSession(group.key)`
- [ ] Neither toggle nor cancel controls render when all API calls return `null` (daemon inactive / 503)
