---
title: Fix planner prompt to stop encouraging test-only plans and add test stage guidance to profile generation
created: 2026-03-27
status: pending
---

# Fix planner prompt to stop encouraging test-only plans and add test stage guidance to profile generation

## Problem / Motivation

The planner creates redundant test-only plans (e.g. `plan-02-tests`) instead of including `test-cycle` in the main plan's build stages. Two remaining root causes:

1. `planner.md` line 100 still explicitly suggests "Source changes first (plan-01), then test updates (plan-02)" as a "common split pattern."
2. The `formatProfileGenerationSection()` in `src/engine/agents/planner.ts` only has Stage Customization guidance for `doc-update` - no mention of `test-cycle`, `test-write`, or when to include test stages.

Note: `planner.md` already has comprehensive test stage guidance in the "Per-Plan Build and Review Configuration" section (lines 346-358), including `test-cycle`, `test-write`, TDD patterns, and when to omit test stages. The issue is that the split pattern suggestion on line 100 contradicts this guidance, and the dynamic `formatProfileGenerationSection()` output doesn't reinforce it.

## Goal

The planner should (a) stop creating separate test-only plans and (b) have test stage awareness in the profile generation section.

## Approach

### 1. Update `src/engine/prompts/planner.md` (line 99-101)

In the "Split large plans" section, replace the common split pattern on line 100 that suggests "test updates (plan-02)" with guidance that tests belong in the same plan via `test-cycle`. Add an explicit anti-pattern note.

Current text (line 100):
```
- Source changes first (plan-01), then test updates (plan-02) and UI/docs (plan-03) in parallel
```

Replace with something like:
```
- Do NOT create separate test-only plans. Include `test-cycle` in the plan's build stages instead - the tester agent handles test validation and fixes automatically.
- Source changes first (plan-01), then UI/docs (plan-02) in parallel if needed.
```

Keep the critical rule about not splitting type changes from consumers (line 101).

### 2. Update `src/engine/agents/planner.ts` - `formatProfileGenerationSection()`

In the "Stage Customization" section (around line 122-130), add test stage guidance parallel to the existing `doc-update` guidance:

- **Adding `test-cycle`**: When the plan has testable behavior (new features, bug fixes, refactors that change behavior), include `test-cycle`. The tester agent runs tests, classifies failures, and fixes test bugs automatically. Place after implement: `["implement", "test-cycle", "review-cycle"]` or parallelized: `["implement", ["test-cycle", "review-cycle"]]`.
- **TDD with `test-write`**: For well-specified features with clear acceptance criteria, use `test-write` before `implement`: `["test-write", "implement", "test-cycle"]`.
- **Omitting test stages**: Skip for config changes, simple refactors with no behavioral change, doc-only work, or dependency updates.

## Scope

**In scope:**
- `src/engine/prompts/planner.md` (line 99-101 only)
- `src/engine/agents/planner.ts` (`formatProfileGenerationSection()` only)

**Out of scope:**
- `planner.md` "Per-Plan Build and Review Configuration" section - already has correct test guidance
- `pipeline.ts` - no changes needed
- Tester agents - no changes needed
- Test stage implementations - already correct

## Acceptance Criteria

1. `planner.md` no longer suggests test-only plans as a split pattern.
2. `formatProfileGenerationSection()` includes `test-cycle` and `test-write` guidance in the Stage Customization section.
3. `pnpm build` passes.
4. `pnpm type-check` passes.
5. Existing tests pass.