---
title: Fix: Graph dependency edges not showing in monitor
created: 2026-03-19
status: pending
---

## Problem / Motivation

The monitor's Graph tab shows plan nodes but no dependency edges. The orchestrator correctly schedules plans with dependencies (e.g., plan-01 builds first, plan-02 and plan-03 wait), but the graph renders no edges because the data sources diverge:

- The **orchestrator** reads `orchestration.yaml`, which has correct `depends_on` per plan, and schedules execution correctly.
- The **monitor** reads `plan:complete` events, where plans are parsed from individual `.md` files via `parsePlanFile()`. The `depends_on` field is empty because the planner agent writes dependencies only in `orchestration.yaml`, not in each plan file's frontmatter.

Confirmed by querying the live API - all three plans return `dependsOn: []`.

## Goal

Ensure `plan:complete` events carry accurate `dependsOn` data so the monitor's Graph tab renders dependency edges between plans.

## Approach

In the pipeline's `planner` stage (`src/engine/pipeline.ts`, ~lines 405-412), after receiving a `plan:complete` event, cross-reference with `orchestration.yaml` to backfill any missing `dependsOn` data before yielding the event.

Specifically:

1. Read and parse `orchestration.yaml` via `parseOrchestrationConfig()` (add to imports from `src/engine/plan.ts`).
2. Build a map of `planId → dependsOn` from the parsed orchestration config.
3. Merge `dependsOn` from `orchestration.yaml` into each plan in the event, preferring `orchestration.yaml` as the authoritative source for inter-plan dependencies.
4. Yield the enriched event instead of the original.

The change is localized to the existing `if (event.type === 'plan:complete')` block. On parse failure, fall back to the original plans gracefully.

```typescript
if (event.type === 'plan:complete') {
  const orchYamlPath = resolve(ctx.cwd, 'plans', ctx.planSetName, 'orchestration.yaml');
  await injectProfileIntoOrchestrationYaml(orchYamlPath, ctx.profile);

  // Backfill dependsOn from orchestration.yaml (authoritative source for inter-plan deps)
  try {
    const orchConfig = await parseOrchestrationConfig(orchYamlPath);
    const depMap = new Map(orchConfig.plans.map((p) => [p.id, p.dependsOn]));
    const enrichedPlans = event.plans.map((plan) => ({
      ...plan,
      dependsOn: depMap.get(plan.id) ?? plan.dependsOn,
    }));
    ctx.plans = enrichedPlans;
    yield { type: 'plan:complete', plans: enrichedPlans };
    continue; // skip the default yield below
  } catch {
    // Fall back to original plans if orchestration.yaml can't be parsed
    ctx.plans = event.plans;
  }
}
```

The `prd-passthrough` stage is already covered since it writes `orchestration.yaml` with `depends_on: []` explicitly (single-plan errands have no deps). The expedition `compile-expedition` stage already reads `orchestration.yaml` to build its plans, so it is already correct.

### Files to modify

- `src/engine/pipeline.ts` — add `parseOrchestrationConfig` to imports, enrich `plan:complete` event in the planner stage

## Scope

**In scope:**

- Enriching `plan:complete` events with `dependsOn` data from `orchestration.yaml` in the planner compile stage
- Adding `parseOrchestrationConfig` to imports in `src/engine/pipeline.ts`

**Out of scope:**

- Changes to the monitor itself
- Changes to how the planner agent writes plan files or `orchestration.yaml`
- Changes to the `prd-passthrough` or `compile-expedition` stages
- Modifying `parsePlanFile()` to extract dependencies differently

## Acceptance Criteria

- `pnpm build` completes with no type errors
- `pnpm test` passes with no regressions
- Running an excursion with multiple dependent plans shows dependency edges in the monitor's Graph tab
- Querying `curl localhost:4567/api/orchestration/<sessionId>` returns populated `dependsOn` arrays for plans that have dependencies
- When `orchestration.yaml` cannot be parsed, the pipeline falls back to the original plans without crashing
