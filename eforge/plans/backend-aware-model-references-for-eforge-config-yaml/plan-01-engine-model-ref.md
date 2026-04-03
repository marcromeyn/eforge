---
id: plan-01-engine-model-ref
name: Engine ModelRef Types, Schema, and Backend Changes
depends_on: []
branch: backend-aware-model-references-for-eforge-config-yaml/engine-model-ref
---

# Engine ModelRef Types, Schema, and Backend Changes

## Architecture Context

This plan converts all model references from plain strings to `ModelRef` objects (`{ id: string; provider?: string }`) throughout the engine. Backend-specific constraints (Pi requires `provider`, Claude SDK forbids it) are enforced at the Zod schema boundary via `.superRefine()`, not in the type system. The Pi backend's model resolution moves from a sync function using `piConfig.provider` to an async path inside `run()` using `ModelRegistry.find(provider, id)`.

This is the foundation plan - all source code and test changes are here. Documentation updates follow in plan-02.

## Implementation

### Overview

1. Define `ModelRef` type and Zod schema
2. Remove dead `agentProfileConfigSchema` and `AgentProfileConfig`
3. Replace string model fields with `ModelRef` in schemas, interfaces, and defaults
4. Remove `pi.provider` from config schema and `PiConfig`
5. Add `.superRefine()` backend-conditional validation to `eforgeConfigSchema`
6. Update `resolveAgentConfig()`, `pickSdkOptions()`, and `MODEL_CLASS_DEFAULTS`
7. Update Claude SDK backend to extract `model.id`
8. Update Pi backend to use `ModelRef` and `ModelRegistry.find()`
9. Update all tests

### Key Decisions

1. **Single `ModelRef` runtime type with optional `provider`** - Backend-specific enforcement happens at the Zod schema boundary. Carrying a discriminated union through every agent runner adds complexity without safety benefit since the schema already validated correctness.

2. **Pi model resolution moves into `run()` generator** - `ModelRegistry.find()` requires async `AuthStorage` initialization. The current sync `resolveModel()` function cannot call the registry. Moving resolution after `AuthStorage` construction in `run()` is the minimal change.

3. **`fallbackModel` stays string-based** - Only used by Claude SDK, no benefit to converting. The Claude SDK expects a string.

4. **`MODEL_CLASS_DEFAULTS` stores `ModelRef` objects** - Claude SDK defaults become `{ id: 'claude-opus-4-6' }` etc. Pi defaults remain `undefined` (user must configure).

5. **Backend-conditional validation via `.superRefine()`** - A single schema parses model refs as `{ id: string; provider?: string }`. The superRefine pass cross-validates against `backend` to enforce constraints. This keeps one schema and produces clear error messages.

## Scope

### In Scope
- Define `ModelRef` type and `modelRefSchema` in `config.ts`
- Remove `agentProfileConfigSchema`, `AgentProfileConfig` type, and its re-export
- Remove `pi.provider` from `piConfigSchema` and `PiConfig` interface
- Replace `model: z.string()` with `modelRefSchema` in `sdkPassthroughConfigSchema` and `eforgeConfigSchema`
- Add `.superRefine()` to `eforgeConfigSchema` for backend-conditional model ref validation
- Update `SdkPassthroughConfig`, `AgentRunOptions`, `ResolvedAgentConfig` - `model` fields become `ModelRef`
- Update `EforgeConfig.agents.model` and `agents.models` types
- Update `MODEL_CLASS_DEFAULTS` to store `ModelRef` objects
- Update `resolveAgentConfig()` to work with `ModelRef`
- Update `pickSdkOptions()` to handle `ModelRef`
- Update Claude SDK backend: extract `model.id` for SDK calls and event emission
- Update Pi backend: accept `ModelRef`, remove sync `resolveModel()`, use `ModelRegistry.find()` in `run()`
- Update `StubBackend` to handle `ModelRef` in event emission
- Update `DEFAULT_CONFIG` to remove `provider` from `pi` section
- Update `resolveConfig()` to remove `provider` handling
- Update all tests in `test/config.test.ts`, `test/pipeline.test.ts`, `test/pi-backend.test.ts`
- Add new schema validation tests for backend-conditional model ref rules

### Out of Scope
- Documentation updates (plan-02)
- Plugin/Pi package guidance updates (plan-02)
- MCP proxy init text updates (plan-02)
- Converting `fallbackModel` to `ModelRef`
- Mixed-backend support

## Files

### Modify
- `src/engine/config.ts` - Define `ModelRef` type and `modelRefSchema`. Remove `agentProfileConfigSchema` (lines 55-71) and `AgentProfileConfig` type (line 184). Remove `provider` from `piConfigSchema` (line 111) and `PiConfig` interface (line 205). Replace `z.string()` model fields with `modelRefSchema` in `sdkPassthroughConfigSchema` (line 46), `eforgeConfigSchema.agents.model` (line 145), and `eforgeConfigSchema.agents.models` (line 148). Add `.superRefine()` to `eforgeConfigSchema`. Update `ResolvedAgentConfig.model` type (line 194) and `EforgeConfig.agents` model types (lines 224, 227). Update `DEFAULT_CONFIG.pi` to remove `provider`. Update `resolveConfig()` to handle `ModelRef` in agents config.
- `src/engine/backend.ts` - Change `model?: string` to `model?: ModelRef` in `SdkPassthroughConfig` (line 23) and `AgentRunOptions` (line 56). Import `ModelRef` from config. Update `pickSdkOptions` to handle `ModelRef` values (object, not string).
- `src/engine/pipeline.ts` - Change `MODEL_CLASS_DEFAULTS` values from strings to `ModelRef` objects (lines 458-471). Update `resolveAgentConfig()` return typing to use `ModelRef`. No logic changes needed - the resolution cascade works the same with objects.
- `src/engine/backends/claude-sdk.ts` - Extract `model.id` for the `agent:start` event (line 46: `options.model?.id ?? 'auto'`). Extract `model.id` for the SDK `model` option (line 55: `model: options.model?.id`).
- `src/engine/backends/pi.ts` - Remove sync `resolveModel()` function (lines 98-122). In `run()`: after `AuthStorage` construction, resolve model via `ModelRegistry.find(options.model.provider, options.model.id)` with fallback to `getModel()` then synthetic object. Remove `piConfig?.provider` references. Update `agent:start` event to use `options.model?.id` for display. Accept `ModelRef` in `options.model`.
- `src/engine/index.ts` - Remove `AgentProfileConfig` from the type re-export (line 140). Add `ModelRef` to the type re-export if needed externally.
- `src/engine/eforge.ts` - Remove `piConfig.provider` from any error messages or config guidance text if present. Update is minimal since backend selection logic passes `config.pi` through and doesn't reference `provider` directly.
- `test/config.test.ts` - Update schema validation tests. Add new tests for: backend-conditional model ref validation (Pi rejects `{ id }` without provider, Claude SDK rejects `{ provider, id }`), string model refs rejected, object model refs accepted.
- `test/pipeline.test.ts` - Update all `resolveAgentConfig` assertions from string comparisons (`toBe('claude-opus-4-6')`) to object comparisons (`toEqual({ id: 'claude-opus-4-6' })`). Update test configs that set model strings to use `ModelRef` objects. Update Pi backend model config tests.
- `test/pi-backend.test.ts` - Remove `provider` from `PI_CONFIG`. Update `ModelRegistry` mock to support `find()` method. Update model resolution assertions. Add tests for registry-based resolution path.
- `test/stub-backend.ts` - Update `agent:start` event emission to handle `ModelRef`: `model: options.model?.id ?? 'stub-model'` (line 68).

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes with zero failures
- [ ] `eforgeConfigSchema` rejects `backend: pi` config where any model ref is `{ id: "x" }` (missing provider)
- [ ] `eforgeConfigSchema` rejects `backend: claude-sdk` config where any model ref is `{ provider: "x", id: "y" }`
- [ ] `eforgeConfigSchema` rejects string model values in `agents.model`, `agents.models.*`, and `agents.roles.*.model`
- [ ] `eforgeConfigSchema` accepts `backend: pi` config where model refs are `{ provider: "x", id: "y" }`
- [ ] `eforgeConfigSchema` accepts `backend: claude-sdk` config where model refs are `{ id: "y" }`
- [ ] `resolveAgentConfig('builder', DEFAULT_CONFIG, 'claude-sdk')` returns `{ ..., model: { id: 'claude-opus-4-6' } }`
- [ ] `resolveAgentConfig('builder', piConfigWithModels, 'pi')` returns `{ ..., model: { provider: 'openrouter', id: 'some-model' } }`
- [ ] Pi backend `run()` calls `ModelRegistry.find()` with provider and id from the model ref
- [ ] Claude SDK backend passes `model.id` (a string) to the SDK `query()` options
- [ ] `agent:start` events contain string model identifiers (not objects) for monitor compatibility
- [ ] `AgentProfileConfig` type no longer exists in exports
- [ ] `pi.provider` field no longer exists in `piConfigSchema` or `PiConfig`
- [ ] `fallbackModel` remains `string` type throughout
