---
id: plan-01-update-constant
name: Update MIN_TIMELINE_WINDOW_MS to 5 minutes
depends_on: []
branch: increase-minimum-timeline-span-to-5-minutes/update-constant
---

# Update MIN_TIMELINE_WINDOW_MS to 5 minutes

## Architecture Context

The monitor UI's pipeline view uses `MIN_TIMELINE_WINDOW_MS` to enforce a minimum visual width for the timeline. The constant is defined once and consumed by `computeTimeSpan` via `Math.max(maxEnd - start, MIN_TIMELINE_WINDOW_MS)`. Changing the constant from `60_000` to `300_000` is the only modification needed.

## Implementation

### Overview

Update the `MIN_TIMELINE_WINDOW_MS` constant in `thread-pipeline.tsx` from `60_000` (1 minute) to `300_000` (5 minutes).

### Key Decisions

1. No other code changes required — `computeTimeSpan` already references the constant dynamically.

## Scope

### In Scope
- Updating `MIN_TIMELINE_WINDOW_MS` from `60_000` to `300_000`

### Out of Scope
- Any other timeline, heatstrip, or pipeline behavior changes
- Bucket size or density color changes

## Files

### Modify
- `src/monitor/ui/src/components/pipeline/thread-pipeline.tsx` — Change `MIN_TIMELINE_WINDOW_MS` from `60_000` to `300_000` on line 171

## Verification

- [ ] `MIN_TIMELINE_WINDOW_MS` equals `300_000` in `src/monitor/ui/src/components/pipeline/thread-pipeline.tsx`
- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` exits with code 0
