---
title: "Per-Plan Build Config: Schema Change"
created: 2026-03-20
status: pending
depends_on: ["per-plan-build-config-foundation"]
---

# Per-Plan Build Config: Schema Change

## Problem / Motivation

The foundation PRD added per-plan `build`/`review` as optional fields and updated all build stage reads. But profiles still carry `build`/`review`/`agents` fields, and per-plan fields are still optional. This PRD makes the breaking type change and fixes all consumers atomically.

## Goal

Remove `build`/`review`/`agents` from the profile type, make per-plan `build`/`review` required, and update every file that constructs these types so type-check and tests pass.

## Approach

### `src/engine/config.ts`

- Remove `build`, `review`, `agents` from `resolvedProfileConfigSchema` — becomes `{ description, extends?, compile }`
- Same for `partialProfileConfigSchema`
- Update `BUILTIN_PROFILES` — remove `build`, `agents`, `review` from each profile
- Remove `DEFAULT_BUILD_STAGES` and `ERRAND_BUILD_STAGES` constants
- Simplify `resolveProfileExtensions` — remove agents/review/build merging
- Simplify `mergePartialConfigs` — remove agents/review merging from profiles
- Simplify `resolveGeneratedProfile` — remove build/review/agents handling
- Simplify `validateProfileConfig` — remove build stage and agents validation

### `src/engine/events.ts`

- Make `build` and `review` required (remove `?`) on `OrchestrationConfig.plans` entries

### `src/engine/agents/common.ts`

- Update `GeneratedProfileBlock` — remove `build`, `agents`, `review` from overrides interface

### `src/engine/index.ts`

- Remove `formatParallelLanes` from exports if present

### All test files that construct profiles or orchestration configs

Every test that constructs `ResolvedProfileConfig` with `build`/`review`/`agents` must be updated. Every test that constructs `OrchestrationConfig.plans` entries must add `build`/`review`.

Files: `test/pipeline.test.ts`, `test/dynamic-profile-generation.test.ts`, `test/config-profiles.test.ts`, `test/plan-parsing.test.ts`, `test/agent-wiring.test.ts`, `test/orchestration-logic.test.ts`, `test/plan-complete-depends-on.test.ts`, `test/adopt.test.ts`

### `test/fixtures/orchestration/valid.yaml`

- Remove build/review/agents from profile section
- Add per-plan build/review to plan entries

### `src/monitor/ui/src/lib/types.ts`

- Remove `build`, `review`, `agents` from `ProfileConfig` type

### `src/monitor/mock-server.ts`

- Update mock profile objects to `{ description, compile }` shape
- Add per-plan build/review to mock plan entries

## Out of scope (deferred to follow-on PRD)

- Prompt updates (planner.md, module-planner.md)
- `parseBuildConfigBlock` + module planning interception
- `formatParallelLanes` removal from planner agent
- Monitor UI component changes (ProfileHeader, StageOverview, event-card)
- Plugin docs update
- New test file for per-plan config parsing

## Acceptance Criteria

1. `pnpm type-check` passes
2. `pnpm test` passes — all tests green
3. `pnpm build` succeeds
4. `ResolvedProfileConfig` has only `description`, `extends?`, `compile`
5. `OrchestrationConfig.plans` entries have required `build` and `review`
6. No test constructs `ResolvedProfileConfig` with `build`, `review`, or `agents`
