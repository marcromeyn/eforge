---
title: Remove card wrapper from pipeline view
created: 2026-03-25
status: pending
---



# Remove card wrapper from pipeline view

## Problem / Motivation

The pipeline section in `thread-pipeline.tsx` is wrapped in a card container with styling (`bg-card border border-border rounded-lg px-4 py-3 shadow-sm shadow-black/20`) that adds padding, causing its content to be misaligned with the heatmap above it. The card boundary also necessitates an internal separator line (`border-t border-border/50`) that would be unnecessary without the wrapper.

## Goal

Remove the card styling from the pipeline view so its content sits flush left, naturally aligned with surrounding elements like the heatmap.

## Approach

- In `src/monitor/ui/src/components/pipeline/thread-pipeline.tsx`, strip the card wrapper's visual styling: background (`bg-card`), border (`border border-border`), rounded corners (`rounded-lg`), padding (`px-4 py-3`), and shadow (`shadow-sm shadow-black/20`).
- Remove the internal separator line (`border-t border-border/50`), since it only served as a visual divider within the card boundary.

## Scope

**In scope:**
- Removing card styling (background, border, rounded corners, padding, shadow) from the pipeline section wrapper in `thread-pipeline.tsx`
- Removing the internal separator line (`border-t border-border/50`)

**Out of scope:**
- Changes to the heatmap or other surrounding components
- Any functional or behavioral changes to the pipeline view

## Acceptance Criteria

- The pipeline section in `thread-pipeline.tsx` no longer has `bg-card`, `border border-border`, `rounded-lg`, `px-4 py-3`, or `shadow-sm shadow-black/20` classes applied.
- The internal `border-t border-border/50` separator line is removed.
- Pipeline content is flush left and visually aligned with the heatmap above it.
