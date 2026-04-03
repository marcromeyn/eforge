---
title: Right-size default model classes per agent role with graceful fallback
created: 2026-04-03
---

# Right-size default model classes per agent role with graceful fallback

## Problem / Motivation

All 23 agent roles currently default to the `max` model class, which means every agent - including simple scoring evaluators, staleness assessors, and dependency detectors - runs on the most expensive, most capable model. This is wasteful for roles with clearly constrained tasks. Additionally, the `auto` model class only makes sense for the Claude SDK backend ("let SDK pick"), conflicts with the new `ModelRef` type system from an in-flight build, and undermines cost visibility. Finally, there is no fallback across model classes - if a role wants `balanced` but the user only configured `max`, resolution fails (throws for Pi, returns undefined for Claude SDK which then uses its own default). This makes partial configuration brittle, especially for Pi users.

## Goal

Right-size default model classes for each agent role (conservative - most stay at `max`, three move to `balanced`), remove the `auto` model class entirely, and add a fallback chain so that when a role's effective model class has no configured model, resolution walks the class tiers before erroring.

## Approach

### Role Default Assignments

Update `AGENT_MODEL_CLASSES` with conservative defaults:

- **`max`** (20 roles): `planner`, `module-planner`, `pipeline-composer`, `builder`, `review-fixer`, `validation-fixer`, `merge-conflict-resolver`, `gap-closer`, `reviewer`, `plan-reviewer`, `architecture-reviewer`, `cohesion-reviewer`, `evaluator`, `plan-evaluator`, `architecture-evaluator`, `cohesion-evaluator`, `formatter`, `doc-updater`, `test-writer`, `tester`
- **`balanced`** (3 roles): `staleness-assessor`, `prd-validator`, `dependency-detector`
- **`fast`**: no built-in defaults (user opt-in only via config)

### Remove `auto` Model Class

Remove `'auto'` from `MODEL_CLASSES`, `modelClassSchema`, `MODEL_CLASS_DEFAULTS`, and all related code/docs. The system becomes a clean three-tier model: `max > balanced > fast`.

### Fallback Chain Logic

Define a static tier list:
```ts
const MODEL_CLASS_TIER: ModelClass[] = ['max', 'balanced', 'fast'];
```

Fallback algorithm when the effective class has no configured model:
1. Find the effective class position in the tier list
2. Walk UP (toward `max`) - try each higher tier
3. If nothing found going up, walk DOWN (toward `fast`) from the original position
4. If nothing found in any direction, error

At each fallback tier, check both user class overrides (`config.agents.models[fallbackClass]`) and backend defaults (`MODEL_CLASS_DEFAULTS[backend][fallbackClass]`).

**Examples**:
- Role wants `balanced`, only `max` configured - gets `max`
- Role wants `balanced`, only `fast` configured - tries `max` first (not configured), then `fast`
- Role wants `fast`, only `max` configured - tries `balanced` (not configured), then `max`
- Role wants `max`, only `balanced` configured - nothing above max, falls down to `balanced`

**Rationale**: Ascending first is safer - using a more capable model is less risky than a less capable one. Descending is the "something is better than nothing" fallback.

### Claude SDK Backend Defaults

Claude SDK keeps backend defaults for all three tiers:
```ts
'claude-sdk': {
  max: { id: 'claude-opus-4-6' },
  balanced: { id: 'claude-sonnet-4-6' },
  fast: { id: 'claude-haiku-4-5' },
}
```

Fallback is mostly a Pi concern since Claude SDK has full coverage, but the logic is backend-agnostic.

### `agent:start` Event

Change `options.model ?? 'auto'` to `options.model ?? 'default'` as a display string in `claude-sdk.ts`.

### Error Messages

When no class in the chain has a model:
```
No model configured for role "builder" (model class "max", tried fallback: balanced, fast) on backend "pi".
Set agents.models.max (or any model class) in eforge/config.yaml.
```

### Fallback Observability

Log/emit an event when fallback triggers so the user can see it in the monitor. The `agent:start` event could include `fallbackFrom: 'balanced'` or similar metadata.

### Dependency on In-flight Build

The currently-building PRD changes model refs from strings to `ModelRef` objects (`{ id }` for Claude SDK, `{ provider, id }` for Pi). This plan assumes that work lands. The fallback logic operates on `ModelRef` objects, not strings.

### Existing Resolution Priority Unchanged

The 5-tier resolution priority is preserved (per-role model > global model > user class override > backend class default > fallback chain). Fallback is a new step *within* tier 4, not a new tier.

## Scope

### In Scope

1. Right-size `AGENT_MODEL_CLASSES` defaults (20 roles at `max`, 3 roles at `balanced`)
2. Add fallback logic to `resolveAgentConfig()` with ascending-then-descending tier walk
3. Remove `auto` model class from `MODEL_CLASSES`, `modelClassSchema`, `MODEL_CLASS_DEFAULTS`, and all related code/docs
4. Update docs and consumer packages - config docs, plugin skills, Pi package skills

### Code Impact

- **`src/engine/config.ts`**: Remove `'auto'` from `MODEL_CLASSES` array and `ModelClass` type
- **`src/engine/pipeline.ts`**: Change 3 roles from `'max'` to `'balanced'` in `AGENT_MODEL_CLASSES`; remove `auto` key from `MODEL_CLASS_DEFAULTS`; add fallback chain logic to `resolveAgentConfig()`
- **`src/engine/backends/claude-sdk.ts`**: Line 46 - change `options.model ?? 'auto'` to `options.model ?? 'default'`
- **`test/pipeline.test.ts`**: Update role default assertions; remove `auto`-related tests; add fallback chain tests
- **`test/config.test.ts`**: Remove `auto` parse test; update `MODEL_CLASSES` iteration tests
- **`docs/config.md`**: Rewrite "Model Classes" section with per-role defaults table, fallback behavior docs, remove `auto` references, add fallback examples
- **`docs/roadmap.md`**: Add model class tuning entry under "Integration & Maturity"
- **`README.md`**: Update any model class examples
- **`eforge-plugin/skills/config/config.md`**: Update model class guidance, remove `auto`, document fallback
- **`pi-package/skills/eforge-config/SKILL.md`**: Same updates as plugin
- **`eforge-plugin/.claude-plugin/plugin.json`**: Bump version if plugin files change

### Out of Scope

- Changing the 5-tier resolution priority (fallback is within tier 4, not a new tier)
- Changing agent behavior, prompts, or pipeline structure
- Changing the `ModelRef` type system (that's the in-flight build)
- Adding per-backend role defaults (all backends share the same role-to-class mapping)
- Runtime model class switching or dynamic model selection

## Acceptance Criteria

1. `MODEL_CLASSES` contains exactly `['max', 'balanced', 'fast']` - `auto` is removed
2. `AGENT_MODEL_CLASSES` maps `staleness-assessor`, `prd-validator`, and `dependency-detector` to `balanced`; all other 20 roles map to `max`
3. `resolveAgentConfig()` implements fallback: when the effective class has no model, it walks up (`fast → balanced → max`) then down from original position, checking both user class overrides and backend defaults at each tier
4. Fallback triggers emit observable metadata (e.g. `fallbackFrom` in `agent:start` event) so users can see when fallback occurs in the monitor
5. When no model is found across the entire fallback chain, the error message names the original class AND lists the attempted fallback classes
6. `modelClassSchema` rejects `'auto'` as invalid input (Zod validation error with valid values shown)
7. Claude SDK backend defaults cover all three tiers (`max` - opus, `balanced` - sonnet, `fast` - haiku)
8. `claude-sdk.ts` no longer references `'auto'` in `agent:start` event model field
9. All existing tests updated: role default assertion tests reflect the new mapping; `auto`-related tests removed; new tests cover fallback chain scenarios (ascending success, descending success, total failure error)
10. `docs/config.md` updated with per-role defaults table, fallback behavior documentation, and no `auto` references
11. `docs/roadmap.md` includes a model class tuning entry noting candidates for future `balanced`/`fast` experimentation (evaluators, formatter, doc-updater, test-writer)
12. Plugin and Pi package skill docs updated to reflect new model classes, fallback behavior, and `auto` removal
13. TypeScript compiler reports no errors from `auto` removal (dead code or type mismatches caught at compile time)
