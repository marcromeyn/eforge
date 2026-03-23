---
title: Untitled PRD
created: 2026-03-23
status: pending
---

## Problem / Motivation

The Changes tab diff viewer in the monitor UI is clipped rather than scrolling when content overflows. The root cause is a missing height constraint chain — the resizable panel's bounded height is not propagated down through the layout to the diff content container, so `overflow-auto` on the diff viewer div never activates.

## Goal

Make the Changes tab diff viewer scroll properly when content exceeds the visible area, by establishing a complete height constraint chain from the resizable panel down to the diff content div.

## Approach

Two targeted CSS/layout changes to propagate bounded height through the flex column:

1. **`src/monitor/ui/src/app.tsx`** (around line 304): Wrap `<FileHeatmap>` in a `<div className="flex-1 min-h-0">` so it fills remaining space in the flex column with a bounded height.

2. **`src/monitor/ui/src/components/heatmap/file-heatmap.tsx`** (line 80): Add `h-full` to the flex container: `<div className="flex gap-3 h-full">`.

These changes propagate the bounded height from the resizable panel down through the layout so that the existing `overflow-auto` on the diff content div in `diff-viewer.tsx` (line 160) can activate and scroll.

## Scope

**In scope:**
- Height constraint fix in `app.tsx` (wrapping `<FileHeatmap>`)
- Height propagation fix in `file-heatmap.tsx` (adding `h-full`)

**Out of scope:**
- N/A

## Acceptance Criteria

- The diff viewer in the Changes tab scrolls vertically when diff content exceeds the visible panel area, rather than being clipped.
- The existing `overflow-auto` on the diff content div in `diff-viewer.tsx` (line 160) activates correctly.
- The `<FileHeatmap>` component fills remaining space in its flex column with a bounded height (`flex-1 min-h-0`).
- The flex container in `file-heatmap.tsx` has `h-full` applied (`<div className="flex gap-3 h-full">`).
