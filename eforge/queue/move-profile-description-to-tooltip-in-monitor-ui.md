---
title: Move profile description to tooltip in monitor UI
created: 2026-03-29
status: pending
---



# Move profile description to tooltip in monitor UI

## Problem / Motivation

The `ProfileHeader` component in the monitor UI displays the profile description text inline, which clutters the header area. The description (e.g., "Multi-file feature work or refactors. Use when the full scope can be planned in a single planner session...") takes up significant horizontal space and isn't needed at a glance.

## Goal

Keep the profile header compact by removing inline description text while preserving the information on hover via tooltips.

## Approach

Modify the `ProfileHeader` component in `src/monitor/ui/src/components/pipeline/thread-pipeline.tsx` (lines 147-169):

1. **Remove** the inline description `<span>` (line 165):
   ```
   <span className="text-[11px] text-text-dim">{profileInfo.config.description}</span>
   ```

2. **Add description tooltip to the "extends" badge** - When `profileInfo.config.extends` exists, wrap the "extends \<base\>" text in a `Tooltip` that shows `profileInfo.config.description` on hover.

3. **Add description to the profile name tooltip** - When there is no `extends` (i.e., a base profile like `errand`/`excursion`/`expedition` is used directly), append the description below the rationale in the existing profile name badge tooltip.

The resulting header layout will be: `[profile-badge] [extends base]` + the stage overview, with descriptions accessible via hover.

A build is currently running for the "add-backend-and-model-info-to-monitor-ui" PRD, which modifies `thread-pipeline.tsx` (adding model to agent tooltips) and `summary-cards.tsx` (adding backend label). This change touches a different part of `thread-pipeline.tsx` (the `ProfileHeader` component, not the agent tooltip area) so there should be no conflict.

## Scope

**In scope:**
- Removing inline description text from `ProfileHeader`
- Adding tooltip with description to the "extends \<base\>" badge
- Adding description to the profile name badge tooltip for profiles without `extends`

**Out of scope:**
- N/A

## Acceptance Criteria

- `pnpm type-check` passes
- `pnpm build` produces clean bundle
- No inline description text is visible in the header
- Hovering the "extends \<base\>" text shows the profile description
- For profiles without `extends`, hovering the profile badge shows description alongside rationale
