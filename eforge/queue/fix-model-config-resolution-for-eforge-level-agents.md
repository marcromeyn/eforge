---
title: Fix model config resolution for eforge-level agents
created: 2026-04-03
---



# Fix model config resolution for eforge-level agents

## Problem / Motivation

Seven agents launched from `eforge.ts` bypass `resolveAgentConfig()`, so they never get a model assigned. The SDK receives `model: undefined` and picks its own default. In the monitor UI these agents show "default" instead of the intended model (e.g. "claude-sonnet-4-6" for balanced roles, "claude-opus-4-6" for max roles). Pipeline agents in `pipeline.ts` all call `resolveAgentConfig()` correctly and show the right model.

### Affected agents

| Agent | Called from | Intended class | Current model sent |
|---|---|---|---|
| `formatter` | `eforge.ts:360` | `max` | `undefined` ("default") |
| `dependency-detector` | `eforge.ts:394` | `balanced` | `undefined` ("default") |
| `staleness-assessor` | `eforge.ts:807` | `balanced` | `undefined` ("default") |
| `prd-validator` | `eforge.ts:635` | `balanced` | `undefined` ("default") |
| `validation-fixer` | `eforge.ts:555` | `max` | `undefined` ("default") |
| `merge-conflict-resolver` | `eforge.ts:587` | `max` | `undefined` ("default") |
| `gap-closer` | `eforge.ts:668` | `max` | `undefined` ("default") |

`gap-closer` calls `resolveAgentConfig()` internally but only uses it for `maxTurns` - the resolved model is discarded at `gap-closer.ts:55-69`.

## Goal

All agents launched from `eforge.ts` should resolve their model configuration via `resolveAgentConfig()` so the correct model is sent to the SDK and displayed in the monitor UI.

## Approach

### Step 1: `eforge.ts` - resolve config and pass SDK fields to each agent

For each of the 7 agent call sites in `eforge.ts`, add a `resolveAgentConfig()` call and spread the result into the agent options. The pattern:

```typescript
import { resolveAgentConfig } from './pipeline.js';

// Before calling the agent:
const agentConfig = resolveAgentConfig('formatter', config, config.backend);

// Pass resolved config to agent:
runFormatter({
  backend: this.backend,
  sourceContent,
  verbose,
  abortController,
  ...agentConfig,  // spreads model, thinking, effort, etc.
})
```

This works because all agent option interfaces extend `SdkPassthroughConfig`, and `resolveAgentConfig()` returns `ResolvedAgentConfig` which has the same shape. The `pickSdkOptions()` call inside each agent already strips undefined fields before passing to `backend.run()`.

Call sites to update:
1. `eforge.ts:360` - `runFormatter` (needs `this.config`)
2. `eforge.ts:394` - `runDependencyDetector` (needs `this.config`)
3. `eforge.ts:555` - `runValidationFixer` (has `config` in scope)
4. `eforge.ts:587` - `runMergeConflictResolver` (has `config` in scope)
5. `eforge.ts:635` - `runPrdValidator` (has `config` in scope)
6. `eforge.ts:668` - `runGapCloser` (has `config` in scope)
7. `eforge.ts:807` - `runStalenessAssessor` (needs `this.config`)

### Step 2: `gap-closer.ts` - no change needed

`gap-closer.ts` currently resolves config internally but ignores the model. After step 1, the model arrives via `options` (from the spread). The internal `resolveAgentConfig` call is kept for `maxTurns` (line 56). Since `pickSdkOptions(options)` already spreads the model from the caller, the model comes through `options` not `agentConfig` - no change needed beyond step 1.

### Step 3: Config access at each call site

- `enqueue()` method (formatter, dependency-detector, staleness-assessor): `this.config` is available
- `build()` method (validation-fixer, merge-conflict-resolver, prd-validator, gap-closer): local `config` variable is available

Add `resolveAgentConfig` to the import from `./pipeline.js`.

## Scope

**In scope:**
- `src/engine/eforge.ts` - add import, add `resolveAgentConfig()` + spread at 7 call sites

**Out of scope:**
- Changes to `gap-closer.ts` (no modification needed)
- Changes to pipeline agents (already working correctly)

## Acceptance Criteria

- `pnpm build` compiles cleanly
- `pnpm test` - existing tests pass
- All 7 agents in the monitor UI show explicit model IDs (e.g. "claude-sonnet-4-6", "claude-opus-4-6") instead of "default"
- `resolveAgentConfig` is imported from `./pipeline.js` in `eforge.ts`
- Each of the 7 call sites spreads the resolved agent config into the agent options
