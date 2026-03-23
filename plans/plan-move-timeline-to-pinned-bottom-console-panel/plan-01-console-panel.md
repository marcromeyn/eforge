---
id: plan-01-console-panel
name: Move Timeline to Pinned Bottom Console Panel
depends_on: []
branch: plan-move-timeline-to-pinned-bottom-console-panel/console-panel
---

# Move Timeline to Pinned Bottom Console Panel

## Architecture Context

The monitor UI uses an `AppLayout` grid (280px sidebar + 1fr content) with a children slot that currently renders a single scrollable `<main>` containing summary widgets, a tab bar (Timeline | Changes | Plans | Graph), and tab content. The Timeline is one of four tabs, meaning it disappears when users navigate to other tabs.

This plan introduces a two-zone vertical split within the `AppLayout` children slot using `react-resizable-panels`. The `AppLayout` grid itself is untouched — all changes happen inside its children slot.

## Implementation

### Overview

Install `react-resizable-panels`, create the shadcn `Resizable` wrapper, build a `ConsolePanel` chrome component, then restructure `App.tsx` to split the content area into an upper panel (summary + tabs) and a bottom console panel (Timeline). Lift `showVerbose` state from `Timeline` to `App.tsx` so `TimelineControls` (in the console header) and `Timeline` (in the console body) share it.

### Key Decisions

1. **shadcn Resizable wrapper** — Follow the standard shadcn pattern (thin re-export with consistent class names) so all future panel splits reuse the same component. Source: https://ui.shadcn.com/docs/components/resizable
2. **`autoSaveId="monitor-console"`** on `ResizablePanelGroup` — Persists panel sizes to localStorage automatically via the library, no custom persistence code needed.
3. **ConsolePanel is a thin chrome wrapper** — It provides header bar + scroll area but does not own sizing. The parent `ResizablePanel` handles height via the resize system.
4. **State lifting for `showVerbose`** — Currently `Timeline` owns this state via `useState`. Moving it to `App.tsx` lets `TimelineControls` render in the console header while `Timeline` renders in the console body, both sharing the same boolean.
5. **`useAutoScroll` repointing** — The hook's `containerRef` currently targets `<main>`. It will target the console panel's scroll div instead, since that's where the Timeline event list lives. The `<main>` in the upper panel gets its own `overflow-y-auto` without auto-scroll behavior.
6. **Collapse via `react-resizable-panels` API** — The `ResizablePanel` has `collapsible` and `collapsedSize` props. The chevron button in the console header calls `panel.collapse()` / `panel.expand()` via an imperative handle ref (`ImperativePanelHandle`).

## Scope

### In Scope
- Install `react-resizable-panels` dependency in `src/monitor/ui/`
- Create `src/monitor/ui/src/components/ui/resizable.tsx` (shadcn wrapper)
- Create `src/monitor/ui/src/components/console/console-panel.tsx` (header + scroll chrome)
- Restructure `App.tsx`: vertical `ResizablePanelGroup` split, remove `'timeline'` from `ContentTab`, default tab to `'plans'`, lift `showVerbose` state, rewire `useAutoScroll`, move auto-scroll button into console panel
- Modify `Timeline` component: accept `showVerbose` as prop, remove `TimelineControls` render
- Add resize handle dark-theme styling to `globals.css`
- Document shadcn/ui convention in root `CLAUDE.md`

### Out of Scope
- Changes to `AppLayout` grid structure
- Changes to `useAutoScroll` hook internals
- Changes to `TimelineControls` component API or implementation
- Changes to `EventCard` component
- Any backend or engine changes

## Files

### Create
- `src/monitor/ui/src/components/ui/resizable.tsx` — shadcn Resizable wrapper exporting `ResizablePanelGroup`, `ResizablePanel`, `ResizableHandle` from `react-resizable-panels` with consistent class names
- `src/monitor/ui/src/components/console/console-panel.tsx` — Console panel chrome: header bar with "Timeline" label, `TimelineControls`, collapse chevron button; scrollable content area with `ref` for auto-scroll; auto-scroll button rendered inside when not at bottom

### Modify
- `src/monitor/ui/package.json` — Add `react-resizable-panels` to dependencies
- `src/monitor/ui/src/app.tsx` — Major restructure:
  - Remove `'timeline'` from `ContentTab` type → `'plans' | 'graph' | 'changes'`
  - Change `activeTab` default from `'timeline'` to `'plans'`
  - Add `showVerbose` / `setShowVerbose` state (lifted from Timeline)
  - Add `consoleCollapsed` state + `consolePanelRef` (`useRef<ImperativePanelHandle>`)
  - Wrap content in `ResizablePanelGroup direction="vertical" autoSaveId="monitor-console"`
  - Upper `ResizablePanel` (defaultSize=65, minSize=30): summary widgets + tab bar (Changes | Plans | Graph) + tab content
  - `ResizableHandle withHandle`
  - Lower `ResizablePanel` (defaultSize=35, minSize=5, collapsible, collapsedSize=5): `ConsolePanel` wrapping `Timeline`
  - Repoint `useAutoScroll` `containerRef` — pass to `ConsolePanel` `scrollRef` prop instead of `<main>` ref
  - Move auto-scroll button from fixed-position into `ConsolePanel`
  - Remove Timeline tab button from the tab bar
  - Update tab reset fallback (lines 175-177): `'timeline'` → `'plans'`
  - Remove the catch-all `else` branch that rendered `<Timeline>` as default tab content
- `src/monitor/ui/src/components/timeline/timeline.tsx` — Accept `showVerbose` as a prop (add to `TimelineProps`), remove internal `useState(false)`, remove `<TimelineControls>` render from the component body
- `src/monitor/ui/src/globals.css` — Add resize handle styling for dark theme (border color matching `border-border`, hover/active states)
- `CLAUDE.md` (project root) — Add a note under Conventions that the monitor UI uses shadcn/ui components (Button, ScrollArea, Checkbox, Tooltip, Resizable, etc.) rather than custom UI primitives

## Verification

- [ ] `cd src/monitor/ui && pnpm type-check` exits with code 0
- [ ] `cd src/monitor/ui && pnpm build` exits with code 0
- [ ] `ContentTab` type in `app.tsx` does not include `'timeline'`
- [ ] `activeTab` default value in `app.tsx` is `'plans'`
- [ ] Tab bar in `app.tsx` renders exactly three buttons: Changes, Plans, Graph (no Timeline button)
- [ ] `ResizablePanelGroup` in `app.tsx` has `autoSaveId="monitor-console"` attribute
- [ ] Lower `ResizablePanel` has `collapsible` prop set
- [ ] `Timeline` component accepts `showVerbose` prop and does not render `TimelineControls`
- [ ] `ConsolePanel` component renders `TimelineControls` in its header
- [ ] `useAutoScroll` `containerRef` is passed to `ConsolePanel` `scrollRef`, not to `<main>`
- [ ] `resizable.tsx` exists at `src/monitor/ui/src/components/ui/resizable.tsx`
- [ ] `react-resizable-panels` is listed in `src/monitor/ui/package.json` dependencies
- [ ] `globals.css` contains styles for `[data-panel-resize-handle-id]` or `[data-resize-handle-active]`
- [ ] Root `CLAUDE.md` contains a mention of shadcn/ui convention for the monitor UI
