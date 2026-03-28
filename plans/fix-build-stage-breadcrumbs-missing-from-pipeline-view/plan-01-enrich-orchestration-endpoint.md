---
id: plan-01-enrich-orchestration-endpoint
name: Enrich Orchestration Endpoint with Build and Review Fields
dependsOn: []
branch: fix-build-stage-breadcrumbs-missing-from-pipeline-view/enrich-orchestration-endpoint
---

# Enrich Orchestration Endpoint with Build and Review Fields

## Architecture Context

The monitor's `/api/orchestration` endpoint (`serveOrchestration()` in `src/monitor/server.ts`) reconstructs orchestration data from `plan:complete` events but only maps `id`, `name`, `dependsOn`, and `branch`. The `BuildStageProgress` component in `thread-pipeline.tsx` expects `build` and `review` fields on each plan entry to render breadcrumbs, but never receives them.

The `/api/plans` endpoint already solves this exact problem using `readBuildConfigFromOrchestration()` (line 357-387), which reads `orchestration.yaml` and returns a map of plan ID to `{ build, review }`. The same enrichment must be applied to `/api/orchestration`.

## Implementation

### Overview

Make `serveOrchestration()` async, call `readBuildConfigFromOrchestration()` after building the base orchestration object, and merge `build`/`review` into each plan entry.

### Key Decisions

1. Reuse `readBuildConfigFromOrchestration()` rather than duplicating YAML parsing logic - it already handles all edge cases (missing file, malformed YAML, missing fields).
2. Make `serveOrchestration()` async since `readBuildConfigFromOrchestration()` is async (reads file from disk).

## Scope

### In Scope
- Making `serveOrchestration()` async
- Calling `readBuildConfigFromOrchestration(sessionId)` to get build/review data
- Enriching each plan entry in the response with `build` and `review` fields from the map

### Out of Scope
- Changes to `BuildStageProgress` component (already works, just needs data)
- Changes to `readBuildConfigFromOrchestration()` helper (already correct)
- Any frontend changes

## Files

### Modify
- `src/monitor/server.ts` — Make `serveOrchestration()` async, call `readBuildConfigFromOrchestration(sessionId)` after building the base orchestration object, and spread `build`/`review` from the returned map onto each plan entry. Also update the route handler call site to await the returned promise if needed.

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm build` completes with exit code 0
- [ ] The `/api/orchestration/{sessionId}` response includes `build` and `review` fields on each plan entry when `orchestration.yaml` has them
- [ ] When `orchestration.yaml` is missing or has no build/review data, the endpoint still returns plan entries without `build`/`review` (no regression)
