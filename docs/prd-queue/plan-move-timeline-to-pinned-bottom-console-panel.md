---
title: Plan: Move Timeline to Pinned Bottom Console Panel
created: 2026-03-23
status: running
---

# Move Timeline to Pinned Bottom Console Panel

## Problem / Motivation

The Timeline currently lives inside a tab group alongside Changes, Plans, and Graph. As the primary "what's happening now" event stream, it gets hidden whenever the user navigates to another tab. This is analogous to burying a terminal or console behind other panels — the user loses real-time visibility into the event stream while inspecting changes, plans, or the graph. The expected UX pattern (matching VS Code's terminal panel or Chrome DevTools' console) is for the live event stream to remain always visible at the bottom of the viewport.

## Goal

Pin the Timeline to a dedicated, always-visible bottom console panel so users can monitor the live event stream while freely navigating Changes, Plans, and Graph tabs in the upper area.

## Approach

Introduce a two-zone vertical split within the existing `AppLayout` children slot using shadcn's `Resizable` component (wrapping `react-resizable-panels`). The `AppLayout` grid itself stays unchanged — the split happens entirely within its children slot.

**Layout structure (before → after):**

- **Before:** Single scrollable `<main>` with tabs (Timeline | Changes | Plans | Graph) at the bottom of the content area.
- **After:** Two-zone vertical split:
  - **Upper panel** — scrollable: SummaryCards, ActivityHeatstrip, ThreadPipeline, tab group (Changes | Plans | Graph)
  - **Bottom console panel** — pinned: Timeline with its own scroll, resizable via drag handle, collapsible

**Key technical decisions:**

- `react-resizable-panels` added as a dependency; shadcn `Resizable` wrapper created as `src/monitor/ui/src/components/ui/resizable.tsx`.
- `autoSaveId="monitor-console"` on the `ResizablePanelGroup` persists panel sizes to localStorage automatically.
- `ConsolePanel` is a thin chrome wrapper (header bar + scroll area), not responsible for sizing — that's handled by the parent `ResizablePanel`.
- `showVerbose` state is lifted from `Timeline` into `App.tsx` so `TimelineControls` (rendered in the console header) and `Timeline` (rendered in the console body) can share it.
- `useAutoScroll` hook is reused unchanged; its `containerRef` is repointed to the console panel's scroll div.
- The fixed-position auto-scroll button moves inside `ConsolePanel`.

### Implementation Steps

#### 1. Install `react-resizable-panels` + add shadcn Resizable component

```bash
cd src/monitor/ui && pnpm add react-resizable-panels
```

**New file:** `src/monitor/ui/src/components/ui/resizable.tsx`

Standard shadcn wrapper exporting `ResizablePanelGroup`, `ResizablePanel`, `ResizableHandle`.

#### 2. Create `ConsolePanel` component

**New file:** `src/monitor/ui/src/components/console/console-panel.tsx`

Thin chrome wrapper providing console panel header + scroll area:

```
┌─ Header bar: "Timeline" label | TimelineControls | collapse chevron button ─┐
├─ Scrollable content area (ref for auto-scroll) ─────────────────────────────┤
│  {children} (Timeline event list)                                            │
└──────────────────────────────────────────────────────────────────────────────┘
```

Uses existing shadcn components:
- `Button` (ghost variant, icon size) for collapse toggle
- `Tooltip` for hover hint on collapse button

Props: `scrollRef`, `showVerbose`, `onToggleVerbose`, `isCollapsed`, `onToggleCollapsed`, `autoScroll`, `onEnableAutoScroll`, `hasEvents`, `children`

#### 3. Modify `App.tsx` — restructure layout

The main content area (AppLayout children slot) becomes a vertical `ResizablePanelGroup`:

```tsx
<ResizablePanelGroup direction="vertical" autoSaveId="monitor-console">
  <ResizablePanel defaultSize={65} minSize={30}>
    <main className="overflow-y-auto h-full px-6 py-5 flex flex-col gap-4">
      {/* SummaryCards, ActivityHeatstrip, ThreadPipeline */}
      {/* Tab bar: Changes | Plans | Graph */}
      {/* Tab content */}
    </main>
  </ResizablePanel>
  <ResizableHandle withHandle />
  <ResizablePanel
    defaultSize={35}
    minSize={5}
    collapsible
    collapsedSize={5}
    onCollapse={() => setConsoleCollapsed(true)}
    onExpand={() => setConsoleCollapsed(false)}
    ref={consolePanelRef}
  >
    <ConsolePanel ...>
      <Timeline events={runState.events} startTime={runState.startTime} showVerbose={showVerbose} />
    </ConsolePanel>
  </ResizablePanel>
</ResizablePanelGroup>
```

Specific changes to `App.tsx`:
- Remove `'timeline'` from `ContentTab` type → `'plans' | 'graph' | 'changes'`
- Default `activeTab` to `'plans'`
- Add `showVerbose` state (lifted from Timeline)
- Add `consoleCollapsed` state + `consolePanelRef` (for programmatic collapse/expand via the chevron button)
- Rewire `useAutoScroll` `containerRef` → passed to ConsolePanel's scroll div
- Remove the fixed-position auto-scroll button (moves inside ConsolePanel)
- Update tab reset logic (lines 166-169): fallback to `'plans'` instead of `'timeline'`
- Remove Timeline tab button from the tab bar

#### 4. Modify `Timeline` component

**File:** `src/monitor/ui/src/components/timeline/timeline.tsx`

- Accept `showVerbose` as a prop instead of internal `useState`
- Remove `<TimelineControls>` from render (it moves to the console header)
- The component just renders the event card list

#### 5. Style the resize handle

**File:** `src/monitor/ui/src/globals.css`

Add styling for the `react-resizable-panels` handle to match the dark theme:

```css
[data-panel-group-direction="vertical"] > [data-resize-handle-active],
[data-panel-group-direction="vertical"] > [data-panel-resize-handle-id] {
  /* match border-border color, subtle grip indicator */
}
```

#### 6. Update CLAUDE.md — document shadcn convention

Add a note under the **Conventions** section in `CLAUDE.md` that the monitor UI should use shadcn/ui components wherever possible (Button, ScrollArea, Collapsible, Checkbox, Tooltip, Resizable, etc.) rather than building custom UI primitives from scratch.

### Files Changed

| File | Type | Description |
|------|------|-------------|
| `src/monitor/ui/src/components/ui/resizable.tsx` | New | shadcn Resizable component wrapper |
| `src/monitor/ui/src/components/console/console-panel.tsx` | New | Console panel header + scroll chrome |
| `src/monitor/ui/src/app.tsx` | Modify | Vertical ResizablePanelGroup split, remove timeline tab, lift state, rewire auto-scroll |
| `src/monitor/ui/src/components/timeline/timeline.tsx` | Modify | Accept `showVerbose` prop, remove controls |
| `src/monitor/ui/src/globals.css` | Modify | Resize handle dark theme styling |
| `src/monitor/ui/package.json` | Modify | Add `react-resizable-panels` dependency |
| `CLAUDE.md` | Modify | Add shadcn/ui convention for monitor UI |

### Reused Existing Code

- `useAutoScroll` hook (`src/monitor/ui/src/hooks/use-auto-scroll.ts`) — unchanged, just repoint `containerRef`
- `TimelineControls` component (`src/monitor/ui/src/components/timeline/timeline-controls.tsx`) — unchanged, rendered in console header
- `Timeline` and `EventCard` components — minimal changes
- `Button` component (`src/monitor/ui/src/components/ui/button.tsx`) — ghost variant for collapse toggle
- `Tooltip` component (`src/monitor/ui/src/components/ui/tooltip.tsx`) — hover hint on collapse
- Lucide icons (`PanelBottomClose`/`PanelBottomOpen` or `ChevronUp`/`ChevronDown`) from existing `lucide-react` dependency

## Scope

**In scope:**
- Installing `react-resizable-panels` and creating the shadcn `Resizable` wrapper
- Creating the `ConsolePanel` component with header bar, scroll area, and collapse toggle
- Restructuring `App.tsx` to use a vertical `ResizablePanelGroup` split
- Removing Timeline from the tab group; updating `ContentTab` type and default tab
- Lifting `showVerbose` state from `Timeline` to `App.tsx`
- Repointing `useAutoScroll` and the auto-scroll button into the console panel
- Styling the resize handle for the dark theme
- Documenting the shadcn/ui convention in `CLAUDE.md`

**Out of scope:**
- Changes to the `AppLayout` grid itself
- Changes to `useAutoScroll` hook internals
- Changes to `TimelineControls` component
- Changes to `EventCard` component
- Any backend or engine changes

## Acceptance Criteria

1. `cd src/monitor/ui && pnpm build` completes with no build errors.
2. Timeline appears as a bottom console panel, always visible regardless of which tab is selected in the upper area.
3. Remaining tabs (Changes, Plans, Graph) work correctly in the upper area; the Timeline tab is no longer present in the tab bar.
4. The default active tab is Plans (not Timeline).
5. The drag handle between upper and lower panels resizes the console panel vertically.
6. The collapse toggle (chevron button in the console header) hides and shows the console content.
7. Auto-scroll follows new events in the console panel.
8. "Show agent events" checkbox (via `TimelineControls`) works from the console header.
9. Panel sizes persist across page refreshes via localStorage (`autoSaveId`).
