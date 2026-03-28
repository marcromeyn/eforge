---
id: plan-01-refine-profile-guidance
name: Refine Profile Selection Guidance and Descriptions
depends_on: []
branch: refine-planner-profile-selection-guidance-and-update-eval-scenario-expectations/refine-profile-guidance
---

# Refine Profile Selection Guidance and Descriptions

## Architecture Context

The planner agent selects a workflow profile (errand, excursion, expedition) that determines the compile pipeline. The current guidance in `planner.md` frames expedition vs excursion around subsystem independence and build-time isolation ("can every piece pass type-check independently?"), when the real architectural distinction is planning complexity - whether one planner session can handle the full scope or needs delegated module planning with architecture/cohesion reviews.

The profile descriptions in `config.ts` `BUILTIN_PROFILES` similarly use build-time framing. Both need to be rewritten to lead with planning complexity as the primary criterion.

## Implementation

### Overview

Update two text sections:
1. The profile selection guidance in `planner.md` (lines 66-74) - the section between errand criteria and the `<profile>` XML example
2. The `excursion` and `expedition` description strings in `BUILTIN_PROFILES` in `config.ts` (lines 327-333)

### Key Decisions

1. **Lead with planning complexity, not build isolation.** The core question is "can one planner session enumerate all plans, list all file changes, and resolve cross-plan dependencies?" not "can each module pass type-check independently?"
2. **Preserve existing negative signals.** The type refactor, field change, and rename-all-callers anti-patterns for expedition are still correct and must be kept.
3. **Refine the "foundation module" heuristic** rather than removing it. A foundation + independent verticals CAN be expedition if the total planning scope demands delegated planning, but is typically excursion when the planner can handle all plans in one session.
4. **Add positive expedition signals.** 4+ subsystems each requiring dedicated codebase exploration, shared files needing region coordination, total scope where the planner would run out of turns before producing quality plans for all modules.
5. **Add sizing heuristic.** Concrete decision aid: if you can enumerate all plans, list all file changes, and resolve cross-plan dependencies within your current session, use excursion. If you'd need to defer detailed planning for some modules, that signals expedition.

## Scope

### In Scope
- `src/engine/prompts/planner.md` lines 66-74 (profile selection guidance for excursion/expedition)
- `src/engine/config.ts` lines 327-333 (`BUILTIN_PROFILES` description strings for excursion and expedition)

### Out of Scope
- Errand or docs profile descriptions (unchanged)
- Compile stage lists (unchanged - only descriptions change)
- Any other prompt files

## Files

### Modify
- `src/engine/prompts/planner.md` - Replace lines 66-74 with planning-complexity-framed guidance. Preserve the existing errand criteria above (lines 59-65) and the `<profile>` XML example below (lines 76+). The new guidance must: lead with planning complexity as the primary criterion, keep the negative expedition signals (type refactors, field changes, rename-all-callers), refine the foundation module heuristic, add positive expedition signals (4+ subsystems needing dedicated exploration, shared files needing region coordination, scope exceeding single session capacity), and include a concrete sizing heuristic.
- `src/engine/config.ts` - Update the `description` field for `excursion` (line 328) to focus on "planning fits in one session" rather than "tightly coupled changes" and "type-check independently." Update the `description` field for `expedition` (line 332) to focus on "planning scope requires delegated module planning with architecture and cohesion review" rather than "independently buildable modules" and "pass type-check on its own branch."

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes with zero failures
- [ ] The planner prompt (lines 66-74 replacement) contains "planning complexity" or equivalent phrasing as the lead criterion for expedition vs excursion
- [ ] Negative expedition signals are preserved: type/interface refactors, adding/removing required fields, rename-and-update-all-callers
- [ ] Positive expedition signals are present: 4+ subsystems each requiring dedicated codebase exploration, shared files needing region coordination, total scope exceeding single session capacity
- [ ] A sizing heuristic is present: use excursion if you can enumerate all plans and resolve dependencies in the current session; use expedition if detailed planning for some modules would need to be deferred
- [ ] The foundation module heuristic is refined to note it CAN be expedition if planning scope demands it, but is typically excursion
- [ ] `BUILTIN_PROFILES.excursion.description` references planning-in-one-session rather than type-check independence
- [ ] `BUILTIN_PROFILES.expedition.description` references delegated module planning rather than independently buildable modules
