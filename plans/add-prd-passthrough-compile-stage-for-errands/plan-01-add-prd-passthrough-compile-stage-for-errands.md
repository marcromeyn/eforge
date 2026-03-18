---
id: plan-01-add-prd-passthrough-compile-stage-for-errands
name: Add prd-passthrough compile stage for errands
depends_on: []
branch: add-prd-passthrough-compile-stage-for-errands/main
---

# Add prd-passthrough compile stage for errands

## Architecture Context

The pipeline stage registry in `pipeline.ts` holds named compile and build stages. Profiles in `config.ts` declare which stages run. The errand profile currently uses `['planner', 'plan-review-cycle']` - identical to excursion - which invokes three agents (planner, plan-reviewer, plan-evaluator) before building. For small errands, the PRD itself is the plan; we can skip all agent invocations with a pure data-transformation stage.

## Implementation

### Overview

Register a `prd-passthrough` compile stage that converts the PRD directly into plan artifacts (plan file + orchestration.yaml) without invoking any agents. Update the errand profile to use it as its sole compile stage.

### Key Decisions

1. **Reuse `writePlanArtifacts()` from `plan.ts`** - this already handles plan file + orchestration.yaml creation with the exact structure the build phase expects. No need to duplicate artifact writing logic.
2. **Inline `extractPrdMetadata()` helper** - a small function that parses YAML frontmatter `title` field, falls back to H1 heading via `extractPlanTitle()`, then to humanized `planSetName`. Strips frontmatter from body so the builder gets implementation instructions without PRD metadata.
3. **Emit the same event sequence as the planner stage** (`plan:start`, `plan:scope`, `plan:profile`, `plan:progress`, `plan:complete`) so downstream consumers (CLI renderer, monitor) don't need special-casing.
4. **Commit plan artifacts inside the stage** via the existing `commitPlanArtifacts` pattern - the `runCompilePipeline` runner only auto-commits before `plan-review-cycle`, but since `prd-passthrough` replaces both planner + review, it must commit its own artifacts so the build phase can create worktrees from committed state.

## Scope

### In Scope
- New `prd-passthrough` compile stage in `src/engine/pipeline.ts`
- `extractPrdMetadata()` helper in `pipeline.ts` (parses frontmatter title, strips frontmatter from body)
- Errand profile compile stages changed to `['prd-passthrough']` in `src/engine/config.ts`
- Test assertions updated in `test/pipeline.test.ts`
- CLAUDE.md compile stages list and errand profile description updated

### Out of Scope
- Changes to excursion or expedition profiles
- Any agent invocations within the stage
- Changes to `plan.ts` helper functions

## Files

### Modify
- `src/engine/pipeline.ts` — Add imports for `writePlanArtifacts`, `extractPlanTitle`, `detectValidationCommands` from `./plan.js`. Add `extractPrdMetadata()` helper function. Register `prd-passthrough` compile stage that: extracts title from PRD metadata, strips frontmatter, gets base branch via `git rev-parse`, detects validation commands, calls `writePlanArtifacts()`, populates `ctx.plans`, commits artifacts via `forgeCommit`, and yields the standard plan event sequence.
- `src/engine/config.ts` — Change errand profile `compile` from `['planner', 'plan-review-cycle']` to `['prd-passthrough']` (line 154).
- `test/pipeline.test.ts` — Add `'prd-passthrough'` to the built-in compile stages array (line 132). Update errand compile assertion from `['planner', 'plan-review-cycle']` to `['prd-passthrough']` (lines 561-563).
- `CLAUDE.md` — Add `prd-passthrough` to the compile stages list. Update errand profile description to show `compile: ['prd-passthrough']`.

## Verification

- [ ] `getCompileStage('prd-passthrough')` returns a function (no throw)
- [ ] `BUILTIN_PROFILES.errand.compile` equals `['prd-passthrough']`
- [ ] The `prd-passthrough` stage yields exactly these event types in order: `plan:start`, `plan:scope`, `plan:profile`, `plan:progress`, `plan:complete`
- [ ] The `plan:complete` event contains a `plans` array with one `PlanFile` whose `body` is the PRD content with frontmatter stripped
- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` exits with code 0
- [ ] The stage calls `writePlanArtifacts()` (not raw file writes) to create plan file + orchestration.yaml
- [ ] Title extraction priority: YAML frontmatter `title` > H1 heading > humanized `planSetName`
