---
title: Fix plan artifacts not appearing in monitor artifacts strip
created: 2026-03-31
status: pending
---



# Fix plan artifacts not appearing in monitor artifacts strip

## Problem / Motivation

The monitor UI's artifacts strip shows "Build PRD" but not plan artifacts (like `plan-01`). The PRD is reactive (derived from the SSE event stream), but plan files are fetched via a one-time REST API call that fires when `sessionId` is first set. If the session is selected before compile emits `plan:complete`, the fetch returns empty and never retries.

The root cause is that `ArtifactsStrip` uses `useApi`, which only fires on `sessionId` change - there is no refetch mechanism when `plan:complete` arrives via SSE.

Additionally, the current artifacts strip has UX issues: items don't look clickable (plain text with hover-only underline), and long plan names cause visual clutter.

## Goal

Derive plan artifacts reactively from SSE events (eliminating the unreliable one-time REST fetch) and redesign the artifacts strip with pill-style chips, abbreviated labels, tooltips, and clear clickability affordances.

## Approach

### 1. Derive plan artifacts from SSE events (`src/monitor/ui/src/app.tsx`)

Add a `useMemo` next to the existing `prdSource` derivation (~line 216) that extracts plan data from the `plan:complete` event:

```tsx
const planArtifacts = useMemo(() => {
  const ev = runState.events.find((e) => e.event.type === 'plan:complete');
  if (!ev || ev.event.type !== 'plan:complete') return [];
  return (ev.event.plans ?? []).map((p: { id: string; name: string; body: string }) => ({
    id: p.id,
    name: p.name,
    body: p.body,
  }));
}, [runState.events]);
```

Pass to `ArtifactsStrip`:

```tsx
<ArtifactsStrip prdSource={prdSource} plans={planArtifacts} />
```

### 2. Redesign ArtifactsStrip (`src/monitor/ui/src/components/common/artifacts-strip.tsx`)

**Props change**: Replace `sessionId` with `plans` prop. Remove `useApi` fetch entirely - plans are now SSE-derived.

```tsx
interface ArtifactsStripProps {
  prdSource: { label: string; content: string } | null;
  plans: Array<{ id: string; name: string; body: string }>;
}
```

**Abbreviated labels**: Extract plan number from ID (e.g., `plan-01-some-long-name` -> `Plan 01`). Show full plan name in a Tooltip on hover.

Helper to abbreviate plan IDs:

```tsx
function abbreviatePlanId(id: string): string {
  const match = id.match(/^plan-(\d+)/);
  return match ? `Plan ${match[1]}` : id;
}
```

**Visual style**: Use pill-style chips matching the existing `StagePill` pattern (small rounded pill with background color, `text-[10px]` or `text-xs`). Use a distinct color (e.g., `bg-cyan/15 text-cyan/70`) to distinguish artifacts from pipeline stages. Use `cursor-pointer` and hover brightness/ring to signal clickability.

**Click behavior**: Use `openContentPreview(label, body)` for both PRD and plans - content is embedded in the event, works even after post-merge cleanup when files no longer exist on disk.

Each artifact renders as a pill button with Tooltip (using existing shadcn Tooltip):

```tsx
<Tooltip>
  <TooltipTrigger asChild>
    <button className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-cyan/15 text-cyan/70 cursor-pointer hover:brightness-125 hover:ring-1 hover:ring-foreground/40 transition-all duration-150" onClick={...}>
      {abbreviatePlanId(plan.id)}
    </button>
  </TooltipTrigger>
  <TooltipContent>{plan.name}</TooltipContent>
</Tooltip>
```

Wrap entire strip in `<TooltipProvider>`.

### Files to modify

- `src/monitor/ui/src/app.tsx` - derive `planArtifacts` from SSE, pass to `ArtifactsStrip`
- `src/monitor/ui/src/components/common/artifacts-strip.tsx` - redesign with pills, tooltips, abbreviated names, remove API fetch

## Scope

**In scope:**
- Deriving plan artifacts reactively from SSE `plan:complete` events
- Removing the unreliable `useApi` one-time REST fetch for plans
- Redesigning artifact items as pill-style chips with abbreviated labels
- Adding shadcn Tooltip with full plan name on hover
- Making artifacts visually clickable with cursor, hover brightness, and ring
- Using `openContentPreview(label, body)` for click behavior on both PRD and plans

**Out of scope:**
- N/A

## Acceptance Criteria

1. `pnpm build` completes with no type errors.
2. `pnpm test` passes with no regressions.
3. Starting a build with `--foreground` and opening the monitor shows plan artifacts as pill chips after compile emits `plan:complete`.
4. Navigating to a completed session from the sidebar loads plans immediately.
5. Hovering a plan pill displays a tooltip showing the full plan name.
6. Clicking a plan pill opens the content preview displaying the plan body.
