---
id: plan-01-strip-card-styles
name: Strip Card Wrapper Styles from Timeline Rows
depends_on: []
branch: remove-timeline-card-wrappers-for-compact-rows/strip-card-styles
---

# Strip Card Wrapper Styles from Timeline Rows

## Architecture Context

The monitor timeline renders each event as a card with background, border, rounded corners, shadow, and inter-card gap. This adds visual noise and wastes vertical space. The fix is purely cosmetic — remove card styling classes and tighten spacing.

## Implementation

### Overview

Remove card-related CSS classes from the event row outer `div` in `event-card.tsx` and remove the `gap-1` between rows in `timeline.tsx`.

### Key Decisions

1. Keep `px-2 py-1` padding on rows for readable spacing without card chrome.
2. Remove `gap-1` from the timeline container since row padding provides sufficient separation.
3. Simplify the verbose variant conditional to only `opacity-50` since card-specific overrides (`border-border/50`, `bg-card/50`, `shadow-none`) no longer apply.

## Scope

### In Scope
- Removing card wrapper classes (`bg-card`, `border`, `rounded-md`, `shadow-sm`) from `event-card.tsx` line 214
- Simplifying verbose variant conditional on line 215
- Removing `gap-1` from `timeline.tsx` line 12

### Out of Scope
- Functional or behavioral changes to timeline events
- Changes to event type badge styling or content layout
- Any other timeline component changes

## Files

### Modify
- `src/monitor/ui/src/components/timeline/event-card.tsx` — Replace card wrapper classes with compact padding-only classes; simplify verbose variant conditional
- `src/monitor/ui/src/components/timeline/timeline.tsx` — Remove `gap-1` from the flex column container

## Verification

- [ ] `pnpm build` completes with zero errors
- [ ] The outer `div` in `EventCard` has classes `px-2 py-1 flex items-start gap-2.5` with no `bg-card`, `border`, `rounded-md`, `shadow-sm`, or `shadow-black/10`
- [ ] The verbose variant conditional applies only `opacity-50` (no `border-border/50`, `bg-card/50`, or `shadow-none`)
- [ ] The timeline container `div` has classes `flex flex-col flex-1` with no `gap-1`
