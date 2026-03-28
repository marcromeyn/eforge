---
title: Refine Planner Profile Selection Guidance and Update Eval Scenario Expectations
created: 2026-03-28
status: pending
---

# Refine Planner Profile Selection Guidance and Update Eval Scenario Expectations

## Problem / Motivation

Eval analysis of the `workspace-api-expedition-engagement` scenario revealed the planner chose excursion instead of the expected expedition mode. Investigation showed the planner made the right call - the planning scope fits in one session - but the current prompt guidance frames the expedition/excursion decision around **subsystem independence** when the actual architectural distinction is **planning complexity** (can one planner session handle the full scope, or does it need delegated module planning?).

The current guidance works in common cases but for the wrong reasons, and has failure modes for large-coupled work or moderate-independent work. The profile descriptions in `config.ts` similarly frame the distinction around build-time isolation rather than planning complexity.

## Goal

Refine the planner's profile selection guidance and built-in profile descriptions to match the real distinction - planning complexity - so the planner chooses the right profile for the right reasons, and update eval scenario expectations to reflect correct planner behavior.

## Approach

### 1. Refine profile selection guidance in planner prompt

**File:** `src/engine/prompts/planner.md` (lines 66-74)

Replace the current expedition/excursion guidance with planning-complexity framing:

- **Lead with the real criterion:** Expedition is for when planning scope exceeds what one agent session can handle - either because codebase exploration is too broad, or because cross-module coordination benefits from dedicated architecture/cohesion review passes.
- **Keep the negative signals** (lines 69-71: type refactors, field changes, rename-all-callers) - these are still correct.
- **Refine line 72** ("foundation module" heuristic): Instead of "sign the split is artificial", clarify that a foundation + independent verticals CAN be expedition if the total planning scope demands it, but is typically excursion when the planner can handle all plans in one session.
- **Add positive expedition signals:** 4+ subsystems each requiring dedicated codebase exploration, shared files needing region coordination, total scope where the planner would run out of turns before producing quality plans for all modules.
- **Add a sizing heuristic:** If you can enumerate all plans, list all file changes, and resolve cross-plan dependencies within your current session, use excursion. If you'd need to defer detailed planning for some modules, that signals expedition.

### 2. Update profile descriptions in config.ts

**File:** `src/engine/config.ts` (lines 327-333)

Update the `excursion` and `expedition` descriptions in `BUILTIN_PROFILES` to reflect planning complexity rather than build-time isolation:

- **excursion:** Focus on "planning fits in one session" rather than "tightly coupled changes" and "type-check independently."
- **expedition:** Focus on "planning scope requires delegated module planning with architecture and cohesion review" rather than "independently buildable modules" and "pass type-check on its own branch."

## Scope

**In scope:**

- `src/engine/prompts/planner.md` - Profile selection guidance (lines 66-74)
- `src/engine/config.ts` - `BUILTIN_PROFILES` descriptions (lines 327-333)
- Re-running the `workspace-api-expedition-engagement` eval scenario to confirm the planner still chooses excursion with better-aligned reasoning

**Out of scope:**

- N/A

## Acceptance Criteria

1. `pnpm type-check` passes with no errors after `config.ts` changes.
2. `pnpm test` passes with no regressions.
3. The `workspace-api-expedition-engagement` eval scenario, when re-run after changes, confirms the planner still chooses excursion.
4. Langfuse trace for the planner's `<profile>` or `<generated-profile>` output shows reasoning that references planning complexity rather than subsystem independence.
5. Planner prompt guidance leads with planning complexity as the primary criterion for expedition vs. excursion selection.
6. Negative signals (type refactors, field changes, rename-all-callers) are preserved in the updated guidance.
7. Positive expedition signals are present: 4+ subsystems each requiring dedicated codebase exploration, shared files needing region coordination, total scope exceeding a single session's capacity.
8. A sizing heuristic is included: use excursion if you can enumerate all plans, list all file changes, and resolve cross-plan dependencies in the current session; use expedition if detailed planning for some modules would need to be deferred.
