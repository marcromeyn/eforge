---
id: plan-01-fix-model-resolution
name: Fix PI Backend Model Resolution
depends_on: []
branch: fix-pi-backend-model-resolution-to-use-piconfig-provider/fix-model-resolution
---

# Fix PI Backend Model Resolution

## Architecture Context

The PI backend (`src/engine/backends/pi.ts`) resolves models via `parseModelString()` which splits on `/` to extract a provider. OpenRouter models use `vendor/model` naming (e.g. `nvidia/nemotron-3-super-120b-a12b:free`), so the parser incorrectly extracts `nvidia` as the provider instead of using the configured `piConfig.provider`. `getModel('nvidia', ...)` returns `undefined`, and `model.id` access crashes.

Additionally, `piConfig.model` in `PiConfig` is dead code - the pipeline's model class system always resolves `options.model` before `backend.run()` is called, so the fallback path in `resolveModel` is unreachable.

## Implementation

### Overview

Delete `parseModelString`, simplify `resolveModel` to use `piConfig.provider` as the provider source, add a guard for missing `options.model`, and remove the dead `model` field from `PiConfig` interface/schema/defaults/merge.

### Key Decisions

1. Provider comes from `piConfig.provider` (defaults to `'openrouter'`) - never parsed from the model string. This is the correct source because the provider is a backend-level configuration, not something embedded in model names.
2. Remove `piConfig.model` entirely rather than deprecating it - it's dead code that can never be reached via the pipeline's `resolveAgentConfig()` flow.
3. The `resolveModel` fallback (constructing a minimal `Model<Api>` object) is preserved for unknown provider/model combos that `getModel()` doesn't recognize.

## Scope

### In Scope
- Delete `parseModelString` function from `pi.ts`
- Rewrite `resolveModel` to accept a required `modelStr` parameter and read provider from `piConfig.provider`
- Add guard at call site (line 324) for missing `options.model`
- Remove `model` from `PiConfig` interface, `piConfigSchema`, `DEFAULT_CONFIG.pi`, and `resolveConfig()` merge

### Out of Scope
- Changes to the model class resolution system in `pipeline.ts`
- Changes to `getModel` behavior in `@mariozechner/pi-ai`
- Any other backend besides PI

## Files

### Modify
- `src/engine/backends/pi.ts` - Delete `parseModelString` (lines 92-102), rewrite `resolveModel` (lines 109-134) to use `piConfig.provider` and require `modelStr`, add guard at line 324 for missing `options.model`
- `src/engine/config.ts` - Remove `model` from `piConfigSchema` (line 213), `PiConfig` interface (line 310), `DEFAULT_CONFIG.pi` (line 398), and `resolveConfig()` pi merge (line 510)

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes with zero failures
- [ ] `parseModelString` function does not exist in `pi.ts`
- [ ] `resolveModel` signature requires `modelStr: string` (not `string | undefined`)
- [ ] `resolveModel` reads provider from `piConfig?.provider` (defaults to `'openrouter'`)
- [ ] `resolveModel` passes the full model string (e.g. `nvidia/nemotron-3-super-120b-a12b:free`) to `getModel()` as the model ID
- [ ] `PiConfig` interface has no `model` field
- [ ] `piConfigSchema` has no `model` field
- [ ] `DEFAULT_CONFIG.pi` has no `model` property
- [ ] `resolveConfig()` pi section does not merge `model`
- [ ] Calling `backend.run()` without `options.model` yields `agent:start` then `agent:stop` with error message containing "No model configured"
