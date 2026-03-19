---
title: Plan: Improve planner guidance for doc-update stage inclusion
created: 2026-03-19
status: pending
---

## Problem / Motivation

During an eval run (`todo-api-health-check` — adding a `GET /health` endpoint), the planner generated a custom profile extending `errand` but did not add the `doc-update` stage. Adding an API endpoint is the kind of change that warrants documentation updates, even for small-scoped work.

The root cause is in the Stage Customization guidance in `src/engine/agents/planner.ts` (lines 110-118). The current framing creates a contradictory signal:

1. "Include `doc-update` when the work changes public APIs, configuration, or user-facing behavior" → says ADD it
2. "For errands, `doc-update` is omitted because the overhead rarely produces meaningful updates" → says DON'T bother

When the planner extends `errand`, rule 2 wins — the "errands skip doc-update" heuristic overrides the "API changes need doc-update" heuristic. The planner needs guidance that frames doc-update as a **work-characteristics** decision, not a **profile-tier** decision.

## Goal

Rewrite the Stage Customization section of the planner prompt so that the doc-update inclusion decision is driven by the characteristics of the work (does it change user-facing surface area?) rather than by which base profile is being extended.

## Approach

**File**: `src/engine/agents/planner.ts` — `formatProfileGenerationSection()` function, lines 110-118

Rewrite the `### Stage Customization` section to:

1. **Lead with the decision criteria** — doc-update is warranted when the work adds/changes APIs, endpoints, CLI behavior, configuration, or other user-facing surface area. This applies regardless of which base profile is extended.
2. **Remove the blanket "errands skip doc-update" framing** — instead, note that purely internal changes (refactors, bug fixes with no API surface change) can skip it to save token overhead.
3. **Keep the mechanical guidance** — how to place it in a parallel group with implement, the `[["implement", "doc-update"], ...]` syntax.

Proposed replacement for the Stage Customization section:

```
### Stage Customization

Build stages control the post-implementation pipeline. You can add, remove, or reorder stages in your generated profile to match the work's needs.

**Adding `doc-update`**: Include `doc-update` when the work adds or changes user-facing surface area — new API endpoints, modified request/response contracts, CLI flags, configuration options, or behavioral changes that users or integrators would notice. This applies regardless of which base profile you extend. Place it in a parallel group with `implement`: `[["implement", "doc-update"], "review", "review-fix", "evaluate"]`.

**Omitting `doc-update`**: Skip it for purely internal changes — refactors, bug fixes with no API surface change, test-only additions, or dependency updates. The overhead (~100k tokens) isn't justified when there's nothing user-facing to document.

**Parallel groups**: Wrap stage names in an inner array to run them concurrently. Only stages with no data dependencies should be parallelized. Example: `[["implement", "doc-update"], "review"]` runs implement and doc-update in parallel, then review sequentially after both complete.
```

## Scope

**In scope:**
- Rewriting the `### Stage Customization` section in `formatProfileGenerationSection()` within `src/engine/agents/planner.ts`

**Out of scope:**
- Changes to other planner prompt sections
- Changes to the stage registry, pipeline logic, or profile resolution
- Changes to built-in profile definitions in `src/engine/config.ts`

## Acceptance Criteria

- The `### Stage Customization` section in `formatProfileGenerationSection()` is replaced with the proposed text
- `doc-update` inclusion guidance is framed around work characteristics (user-facing surface area changes), not profile tier
- The blanket "errands skip doc-update" framing is removed
- Mechanical guidance for parallel group syntax is preserved
- `pnpm build` compiles successfully
- `pnpm test` passes with no regressions
- Re-running the `todo-api-health-check` eval scenario produces a planner output that includes `doc-update` in the generated profile
