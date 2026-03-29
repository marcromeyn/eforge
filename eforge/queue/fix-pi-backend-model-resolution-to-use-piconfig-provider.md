---
title: Fix PI backend model resolution to use piConfig.provider
created: 2026-03-29
status: pending
---

# Fix PI backend model resolution to use piConfig.provider

## Problem / Motivation

The PI backend crashes with `Cannot read properties of undefined (reading 'id')` when using OpenRouter models like `nvidia/nemotron-3-super-120b-a12b:free`. The root cause is that `resolveModel()` calls `parseModelString()`, which splits the model string on `/` to extract a "provider." For OpenRouter's `vendor/model` naming convention (e.g., `nvidia/nemotron-3-super-120b-a12b:free`), this incorrectly extracts `nvidia` as the provider instead of using the configured `openrouter` from `piConfig.provider`. `getModel('nvidia', ...)` returns `undefined` (it does not throw), and subsequent access to `model.id` crashes at line 332.

Additionally, `piConfig.model` is dead code. Models are resolved per-agent in `resolveAgentConfig()` (pipeline.ts) via the model class system. The pipeline already throws if no model resolves (pipeline.ts:365-372). `options.model` is always set when `backend.run()` is called, so `piConfig.model` is only a fallback in `resolveModel` that can never be reached in practice.

This bug was found during eval runs.

## Goal

Fix model resolution in the PI backend so the provider is read from `piConfig.provider` rather than parsed from the model string, and remove the dead `piConfig.model` fallback code.

## Approach

### `src/engine/backends/pi.ts`

**1. Delete `parseModelString`** (lines 92-102) - This function incorrectly splits vendor/model strings and is no longer needed.

**2. Simplify `resolveModel`** (lines 109-134) - Provider comes from `piConfig.provider`. Model string is a required parameter (always provided by pipeline). No fallback needed.

```typescript
function resolveModel(modelStr: string, piConfig?: PiConfig): Model<Api> {
  const provider = piConfig?.provider ?? 'openrouter';

  try {
    const resolved = getModel(provider as never, modelStr as never) as Model<Api> | undefined;
    if (resolved) return resolved;
  } catch {
    // Fall through to fallback
  }

  // Unknown provider/model combo - construct a minimal model object
  return {
    id: modelStr,
    name: modelStr,
    api: 'openai-completions' as Api,
    provider,
    baseUrl: provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : `https://api.${provider}.com`,
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 16384,
  };
}
```

**3. Update call site** (line 324) - `options.model` comes from per-agent resolution and is always set for Pi backend. Add a guard for safety:

```typescript
if (!options.model) {
  throw new Error('No model configured. Set agents.models.max in eforge/config.yaml.');
}
model = resolveModel(options.model, this.piConfig);
```

### `src/engine/config.ts`

**4. Remove `model` from Pi config:**

- Remove `model` from `PiConfig` interface (line 310)
- Remove `model` from `piConfigSchema` (line 213)
- Remove `model` from `DEFAULT_CONFIG.pi` (line 398)
- Remove `model` from config merge in `resolveConfig()` (line 510)
- Remove the `model` description from the `pi` section in `piConfigSchema` / CLAUDE.md doc if applicable

## Scope

**In scope:**

- Deleting `parseModelString` from `pi.ts`
- Rewriting `resolveModel` to use `piConfig.provider` instead of parsing the model string
- Adding a guard at the call site for missing `options.model`
- Removing all references to `model` in `PiConfig` interface, schema, defaults, and config merge

**Out of scope:**

- Changes to the model class resolution system in pipeline.ts
- Changes to `getModel` behavior
- Any other backend besides PI

## Acceptance Criteria

- `pnpm type-check` passes
- `pnpm test` passes
- Running an eval scenario with `pi.provider: openrouter` and model `nvidia/nemotron-3-super-120b-a12b:free` (set via `agents.models.max`) no longer crashes and correctly resolves the model using the `openrouter` provider
- `parseModelString` no longer exists in `pi.ts`
- `PiConfig` interface, schema, defaults, and config merge no longer reference `model`
- Calling PI backend without `options.model` throws a clear error: `No model configured. Set agents.models.max in eforge/config.yaml.`
