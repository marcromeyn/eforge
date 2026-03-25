---
id: plan-01-sidebar-refresh
name: Unconditional Sidebar Refresh on Poll
depends_on: []
branch: fix-enqueuing-section-not-clearing-in-sidebar-after-formatter-completes/sidebar-refresh
---

# Unconditional Sidebar Refresh on Poll

## Architecture Context

The monitor sidebar polls `/api/runs` to display session/run status. The poll interval (2s) already exists, but the sidebar refresh (`setSidebarRefresh`) only fires when a *new* session ID appears. This means DB state changes within existing sessions (like enqueue run completion) are invisible until a browser refresh.

## Implementation

### Overview

Move the `setSidebarRefresh((c) => c + 1)` call outside the `if (latestId && latestId !== knownLatestRef.current)` guard so the sidebar refetches `/api/runs` on every 2-second poll cycle, not just when a new session appears.

### Key Decisions

1. **Unconditional refresh over targeted event handling** — Rather than adding specific event listeners for `enqueue:complete`, making the poll unconditional catches all DB state changes (enqueue completion, phase transitions, status updates) with zero additional complexity. The `/api/runs` endpoint is a lightweight SQLite query, so the cost is negligible.

## Scope

### In Scope
- Moving `setSidebarRefresh` call outside the new-session `if` guard in `src/monitor/ui/src/app.tsx`

### Out of Scope
- Changes to the backend event recording
- Changes to the SSE event stream
- Adding new API endpoints

## Files

### Modify
- `src/monitor/ui/src/app.tsx` — Move `setSidebarRefresh((c) => c + 1)` before the `if` guard in the 2s poll interval callback (lines 106-120), so it fires unconditionally on every poll cycle

## Verification

- [ ] `pnpm build` completes with zero errors
- [ ] `pnpm type-check` passes with zero errors
- [ ] The `setInterval` callback in `app.tsx` calls `setSidebarRefresh((c) => c + 1)` before the `if (latestId && latestId !== knownLatestRef.current)` check
- [ ] The new-session auto-switch logic (`setCurrentSessionId`) remains inside the `if` guard — only the sidebar refresh moves outside
