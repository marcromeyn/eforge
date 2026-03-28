---
title: Per-Agent SDK Configuration System
created: 2026-03-28
status: pending
---

# Per-Agent SDK Configuration System

## Problem / Motivation

eforge spins up 19 different agent roles, but every one gets identical SDK settings - same model, same thinking mode, same effort level. The Claude Agent SDK exposes per-query controls for model selection, thinking budget, effort level, cost ceilings, and granular tool filtering, but eforge passes none of these through. This means a 1-turn formatter runs with the same expensive config as a 50-turn builder.

The `AgentProfileConfig` type already has a `model` field that's never wired in, and `resolveAgentConfig()` only resolves `maxTurns`. The full config pipeline needs to be built out so users can tune each agent role independently via `eforge.yaml`.

## Goal

Enable per-agent-role SDK configuration (model, thinking, effort, cost ceiling, tool filtering) through `eforge.yaml`, with a clear priority chain, so that cheap/simple agents run lean and expensive agents can be tuned independently - all without changing default behavior for existing users.

## Approach

### New SDK fields to expose

| Field | SDK type | Purpose |
|-------|----------|---------|
| `model` | `string` | Model override (e.g. `claude-haiku-4-5-20251001`) |
| `thinking` | `{ type: 'disabled' \| 'enabled' \| 'adaptive', budgetTokens?: number }` | Thinking/reasoning control |
| `effort` | `'low' \| 'medium' \| 'high' \| 'max'` | Speed vs quality tradeoff |
| `maxBudgetUsd` | `number` | Hard cost ceiling per agent run |
| `fallbackModel` | `string` | Fallback if primary model unavailable |
| `allowedTools` | `string[]` | Specific tools to auto-allow (within preset) |
| `disallowedTools` | `string[]` | Specific tools to deny |

### eforge.yaml structure

```yaml
agents:
  # Existing operational settings (unchanged)
  maxContinuations: 3
  permissionMode: bypass
  settingSources: [project]

  # NEW: Global SDK defaults (apply to all agents unless overridden)
  model: claude-sonnet-4-6
  thinking:
    type: adaptive
  effort: high

  # NEW: Per-role overrides
  roles:
    formatter:
      model: claude-haiku-4-5-20251001
      thinking:
        type: disabled
      effort: low
    builder:
      maxBudgetUsd: 5.0
```

### Priority chain

For each field: **user per-role > user global > built-in per-role > built-in global**

This preserves current `maxTurns` behavior (builder's built-in 50 isn't overridden by global 30) while letting users override anything explicitly.

### Shared passthrough type

To avoid repeating SDK fields across 18 agent Options interfaces, define a shared type and extraction helper:

```typescript
// backend.ts
export interface SdkPassthroughConfig {
  model?: string;
  thinking?: ThinkingConfig;
  effort?: EffortLevel;
  maxBudgetUsd?: number;
  fallbackModel?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
}

export function pickSdkOptions(opts: SdkPassthroughConfig): SdkPassthroughConfig {
  const result: SdkPassthroughConfig = {};
  if (opts.model !== undefined) result.model = opts.model;
  if (opts.thinking !== undefined) result.thinking = opts.thinking;
  if (opts.effort !== undefined) result.effort = opts.effort;
  if (opts.maxBudgetUsd !== undefined) result.maxBudgetUsd = opts.maxBudgetUsd;
  if (opts.fallbackModel !== undefined) result.fallbackModel = opts.fallbackModel;
  if (opts.allowedTools !== undefined) result.allowedTools = opts.allowedTools;
  if (opts.disallowedTools !== undefined) result.disallowedTools = opts.disallowedTools;
  return result;
}
```

Agent Options interfaces extend `SdkPassthroughConfig`. Agent `backend.run()` calls spread `...pickSdkOptions(options)`.

### Config resolution

`resolveAgentConfig()` expands from returning `{ maxTurns: number }` to returning `ResolvedAgentConfig` with all SDK fields:

```typescript
export interface ResolvedAgentConfig extends SdkPassthroughConfig {
  maxTurns: number;
}
```

The built-in per-role defaults map expands from `maxTurns`-only to full `Partial<ResolvedAgentConfig>`:

```typescript
const AGENT_ROLE_DEFAULTS: Partial<Record<AgentRole, Partial<ResolvedAgentConfig>>> = {
  builder:          { maxTurns: 50 },
  'module-planner': { maxTurns: 20 },
  'doc-updater':    { maxTurns: 20 },
  'test-writer':    { maxTurns: 30 },
  tester:           { maxTurns: 40 },
};
```

No built-in model/thinking/effort defaults - all new fields default to `undefined` (SDK decides), preserving current behavior.

### Files to modify

**1. `src/engine/backend.ts`**
- Add `ThinkingConfig`, `EffortLevel` type exports
- Add `SdkPassthroughConfig` interface
- Add `pickSdkOptions()` helper
- Extend `AgentRunOptions` to include `SdkPassthroughConfig` fields

**2. `src/engine/config.ts`**
- Add `thinkingConfigSchema` and `effortLevelSchema` Zod schemas
- Extend `agentProfileConfigSchema` with new fields
- Add `roles` to `eforgeConfigSchema.agents` section (record of `agentRoleSchema` -> `agentProfileConfigSchema`)
- Update `EforgeConfig` interface with new `agents` fields + `roles`
- Update `resolveConfig()` to pass through new fields
- Update `mergePartialConfigs()` to deep-merge `roles` (per-role shallow merge, like profiles)
- Export `ThinkingConfig`, `EffortLevel`, `ResolvedAgentConfig`

**3. `src/engine/pipeline.ts`**
- Rename `AGENT_MAX_TURNS_DEFAULTS` to `AGENT_ROLE_DEFAULTS` with `Partial<ResolvedAgentConfig>` values
- Rewrite `resolveAgentConfig()` to return `ResolvedAgentConfig`
- Update all pipeline stages to spread resolved config into agent calls (9 call sites: planner, module-planner, builder/implement, evaluator, doc-updater, test-writer, tester, review, review-fixer)

**4. `src/engine/backends/claude-sdk.ts`**
- Map new `AgentRunOptions` fields to SDK `query()` options: `thinking`, `effort`, `maxBudgetUsd`, `fallbackModel`, `allowedTools`, `disallowedTools`

**5. Agent files (15 files)**

Each agent's Options interface extends `SdkPassthroughConfig`, and each `backend.run()` call includes `...pickSdkOptions(options)`:
- `agents/builder.ts` (BuilderOptions - 2 backend.run calls: implement + evaluate)
- `agents/planner.ts` (PlannerOptions)
- `agents/reviewer.ts` (ReviewerOptions)
- `agents/parallel-reviewer.ts` (ParallelReviewerOptions)
- `agents/plan-reviewer.ts` (PlanReviewerOptions)
- `agents/plan-evaluator.ts` (PlanPhaseEvaluatorOptions, PlanEvaluatorOptions)
- `agents/architecture-reviewer.ts` (ArchitectureReviewerOptions)
- `agents/cohesion-reviewer.ts` (CohesionReviewerOptions)
- `agents/review-fixer.ts` (ReviewFixerOptions)
- `agents/validation-fixer.ts` (ValidationFixerOptions)
- `agents/merge-conflict-resolver.ts` (MergeConflictResolverOptions)
- `agents/staleness-assessor.ts` (StalenessAssessorOptions)
- `agents/formatter.ts` (FormatterOptions)
- `agents/doc-updater.ts` (DocUpdaterOptions)
- `agents/tester.ts` (TestWriterOptions, TesterOptions)
- `agents/module-planner.ts` (ModulePlannerOptions)

**6. Tests**
- `test/pipeline.test.ts` - Extend existing `resolveAgentConfig` tests with new fields, priority chain, roles merging
- `test/config.test.ts` (or new) - Schema validation for thinking config variants, effort levels, roles deep-merge

### Implementation order

1. **Types & schemas** - `backend.ts` types + `config.ts` schemas (foundation, no behavior change)
2. **Config resolution** - `config.ts` resolveConfig/merge + `pipeline.ts` resolveAgentConfig rewrite
3. **SDK backend** - `claude-sdk.ts` passthrough mapping
4. **Pipeline wiring** - Update all pipeline stages to spread resolved config
5. **Agent files** - Extend Options interfaces + backend.run calls (mechanical, high file count)
6. **Tests** - Resolution priority, schema validation, merge logic

## Scope

### In scope
- New `SdkPassthroughConfig` shared type and `pickSdkOptions()` helper in `backend.ts`
- Zod schemas for thinking config and effort level in `config.ts`
- `roles` section in `eforge.yaml` `agents` block for per-role overrides
- Global SDK defaults in `eforge.yaml` `agents` block
- Four-tier priority chain: user per-role > user global > built-in per-role > built-in global
- `resolveAgentConfig()` rewrite to return full `ResolvedAgentConfig`
- SDK backend mapping of all new fields to `query()` options
- All 15 agent files updated to extend `SdkPassthroughConfig` and spread via `pickSdkOptions`
- All 9 pipeline call sites updated to spread resolved config
- Tests for resolution priority, schema validation, and merge logic

### Out of scope
- Changing built-in model/thinking/effort defaults (all new fields default to `undefined` so the SDK decides)
- Any behavioral change for users with existing configs that don't use the new fields

## Acceptance Criteria

- `pnpm type-check` passes with no type errors after all changes.
- `pnpm test` passes - all existing tests pass with no behavior change under default config.
- `resolveAgentConfig()` correctly implements the four-tier priority chain: user per-role > user global > built-in per-role > built-in global.
- Adding a `roles` section to `eforge.yaml` is validated by Zod schemas and visible via `eforge config show`.
- `pickSdkOptions()` strips `undefined` fields correctly (no undefined keys in output).
- The SDK backend (`claude-sdk.ts`) maps `thinking`, `effort`, `maxBudgetUsd`, `fallbackModel`, `allowedTools`, and `disallowedTools` to SDK `query()` options.
- All 15 agent Options interfaces extend `SdkPassthroughConfig` and all `backend.run()` calls spread `...pickSdkOptions(options)`.
- All 9 pipeline call sites spread the resolved config into agent calls.
- Running a build with `agents.roles.formatter.effort: low` results in the formatter agent receiving that setting (verifiable via Langfuse trace or verbose output).
- New tests cover: resolution priority chain, schema validation for thinking config variants and effort levels, and `roles` deep-merge logic.
