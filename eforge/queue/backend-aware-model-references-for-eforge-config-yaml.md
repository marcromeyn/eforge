---
title: Backend-Aware Model References for `eforge/config.yaml`
created: 2026-04-03
---

# Backend-Aware Model References for `eforge/config.yaml`

## Problem / Motivation

Today, eforge treats configured models as plain strings and assumes one global backend, with Pi model provider coming from `pi.provider`. Model selection for Pi is effectively `provider + string model id`, but only after eforge has already resolved the model. This causes several problems:

1. Pi model config does not match Pi's native provider/id model lookup semantics.
2. Custom models or providers defined in `~/.pi/agent/models.json` are not properly resolved through Pi's registry.
3. The config contract is ambiguous because the same `model: string` field means different things for different backends.
4. Documentation currently teaches a Pi configuration pattern that does not align with how Pi actually resolves custom models.

The new design makes model configuration explicit and backend-shaped at the config boundary. This is a forward-looking cleanup, not a backwards-compatibility patch. Existing string-based model config may be broken intentionally if needed to arrive at the correct long-term shape.

## Goal

Redesign eforge model configuration so model references are backend-aware objects instead of plain strings - `{ id }` for `claude-sdk` and `{ provider, id }` for `pi` - while keeping a single global backend selection, removing `pi.provider` from the config schema, and resolving Pi models through Pi's native `ModelRegistry.find(provider, id)` so custom models and providers defined in `~/.pi/agent/models.json` are honored.

## Approach

### Desired Config Shape

#### Claude SDK

```yaml
backend: claude-sdk

agents:
  models:
    max:
      id: claude-opus-4-6
    balanced:
      id: claude-sonnet-4-6
    fast:
      id: claude-haiku-4-5

  roles:
    formatter:
      model:
        id: claude-haiku-4-5
```

#### Pi

```yaml
backend: pi

agents:
  models:
    max:
      provider: llama-cpp
      id: ggml-org-gemma-4-26b-4b-gguf
    balanced:
      provider: openrouter
      id: anthropic/claude-sonnet-4

  roles:
    reviewer:
      model:
        provider: openrouter
        id: anthropic/claude-sonnet-4

pi:
  thinkingLevel: medium
  extensions:
    autoDiscover: true
  compaction:
    enabled: true
    threshold: 100000
  retry:
    maxRetries: 3
    backoffMs: 1000
```

Note: `pi.provider` is removed entirely. Provider selection lives in each model ref.

### Key Technical Decisions

1. **Single Global Backend Stays** - Eforge continues to select one backend for the whole run using top-level `backend`. This keeps engine/backend wiring simple and avoids a larger architectural change.

2. **Model References Become Objects** - All configured model references move from plain strings to structured objects. This applies to `agents.model`, `agents.models.<class>`, and `agents.roles.<role>.model`.

3. **Backend-Specific Model Reference Shapes** - The correct contract is backend-specific:
   - `claude-sdk`: model ref must be `{ id: string }`
   - `pi`: model ref must be `{ provider: string, id: string }`
   - Do not model Pi refs as `{ provider?: string, id: string }`.
   - Do not use `pi.provider` as a fallback source for model selection.

4. **`id` Is the Canonical Field Name** - Use `id`, not `model`. This aligns with Pi's provider/id resolution semantics and avoids awkward config and code shapes like `model.model`.

5. **Pi Must Resolve Through Pi Registry** - When backend is `pi`, eforge must resolve configured model refs through Pi's own registry path:
   1. Construct `AuthStorage`
   2. Construct `ModelRegistry`
   3. Try `modelRegistry.find(provider, id)`
   4. If not found, optionally try `getModel(provider, id)` for built-ins
   5. Only then use a synthetic fallback model object if still necessary

   The important behavioral change is that eforge must consult Pi's registry during model resolution, not merely pass a registry into `createAgentSession` after a model has already been resolved by eforge itself.

### Type and API Design

Introduce a single runtime model-ref type used throughout engine code:

```ts
export interface ModelRef {
  id: string;
  provider?: string;
}
```

Backend-specific constraints are enforced at the **config schema boundary** via Zod `.superRefine()`, not in the runtime type system:
- Pi models must have `provider` (schema rejects `{ id }` when `backend: pi`)
- Claude models must not have `provider` (schema rejects `{ provider, id }` when `backend: claude-sdk`)

A single `ModelRef` with optional `provider` is the pragmatic runtime choice. Carrying a discriminated union (`ClaudeModelRef | PiModelRef`) through every agent runner and helper adds complexity without safety benefit - the schema already validated correctness.

Downstream types that change from `model?: string` to `model?: ModelRef`:
- `SdkPassthroughConfig`
- `ResolvedAgentConfig`
- `AgentRunOptions`

Each backend narrows as needed at consumption time - Pi asserts `provider` exists, Claude SDK extracts `model.id`.

### Config Schema

The config schema must:
- Continue requiring top-level `backend`
- Validate model refs differently based on backend
- Reject string model refs
- Reject Pi model refs missing `provider`
- Reject Claude model refs that include `provider`

Use Zod `.superRefine()` on the top-level schema for backend-conditional validation. The base schema parses model refs as `{ id: string; provider?: string }`. The superRefine pass cross-validates against `backend` to enforce backend-specific constraints. This keeps one schema and produces clear, actionable error messages.

The schema should support:
- Top-level global model override
- Per-class model refs
- Per-role model refs
- `fallbackModel` remains string-based (only used by Claude SDK, no benefit to converting)

### Pi Config Semantics

`pi.provider` is removed entirely from the config schema. It is only used for model resolution, and provider selection now lives in each model ref.

The `pi` config section remains for:
- `apiKey`
- `thinkingLevel`
- `extensions`
- `compaction`
- `retry`

### Validation Rules

#### Backend: `claude-sdk`

Allowed:
```yaml
backend: claude-sdk
agents:
  models:
    max:
      id: claude-opus-4-6
```

Rejected:
```yaml
backend: claude-sdk
agents:
  models:
    max: claude-opus-4-6
```

Rejected:
```yaml
backend: claude-sdk
agents:
  models:
    max:
      provider: openrouter
      id: anthropic/claude-sonnet-4
```

#### Backend: `pi`

Allowed:
```yaml
backend: pi
agents:
  models:
    max:
      provider: openrouter
      id: anthropic/claude-sonnet-4
```

Rejected:
```yaml
backend: pi
agents:
  models:
    max:
      id: anthropic/claude-sonnet-4
```

Rejected:
```yaml
backend: pi
agents:
  models:
    max: anthropic/claude-sonnet-4
```

### Error Handling

Validation and runtime errors must be explicit and actionable. Examples:
- `backend: pi` with `agents.models.max: { id: "gpt-5.4" }` should fail validation because `provider` is missing.
- `backend: claude-sdk` with `agents.models.max: { provider: "openrouter", id: "..." }` should fail validation because provider is not valid for Claude SDK refs.
- If a Pi model ref passes schema validation but lookup fails at runtime, the error should name both provider and id.

### Affected Areas

#### Engine Schema and Config Resolution

Primary files: `src/engine/config.ts`, `src/engine/backend.ts`, `src/engine/pipeline.ts`

Expected work:
- Remove dead `agentProfileConfigSchema` (config.ts:55-71), its exported type `AgentProfileConfig` (config.ts:184), and re-export (index.ts:140). This is leftover from the removed custom profiles feature.
- Replace string-based model schemas with `ModelRef` object schemas (`{ id: string; provider?: string }`).
- Add `.superRefine()` to `eforgeConfigSchema` for backend-conditional model ref validation.
- Remove `pi.provider` from `piConfigSchema` and `PiConfig` interface.
- Update `ResolvedAgentConfig`, `SdkPassthroughConfig`, `AgentRunOptions` - `model` fields become `ModelRef`.
- Update `resolveConfig()` typing and freezing behavior.
- Update `resolveAgentConfig()` so it resolves `ModelRef` objects instead of strings.
- Update `MODEL_CLASS_DEFAULTS` to store `ModelRef` objects for claude-sdk (e.g. `{ id: 'claude-opus-4-6' }`).
- Update `pickSdkOptions` to handle `ModelRef`.
- Update any helper logic or tests that assume `agents.models.<class>` is a string.

#### Pi Backend

Primary file: `src/engine/backends/pi.ts`

Expected work:
- Change model resolution to consume `ModelRef` with `{ provider, id }`.
- Remove `pi.provider` from `PiConfig` and all resolution logic.
- Move model resolution into the `run()` generator (after `AuthStorage`/`ModelRegistry` construction) since `ModelRegistry.find()` requires async initialization. The current sync `resolveModel()` function cannot call the registry.
- Resolve using `ModelRegistry.find(provider, id)`.
- Preserve existing auth behavior and API key override behavior.
- Ensure emitted `agent:start` events still include a sensible model string via `model.id`.

#### Claude SDK Backend

Primary file: `src/engine/backends/claude-sdk.ts`

Expected work:
- Accept `ModelRef` in `AgentRunOptions`, extract `model.id` before passing to the Claude SDK.
- Keep runtime behavior otherwise unchanged.

#### Engine Wiring

Primary file: `src/engine/eforge.ts`

Expected work:
- Backend selection likely remains the same.
- Error text and config guidance may need updating if current messages refer to string-based Pi model config or `pi.provider`.

#### MCP / Init UX

Primary file: `src/cli/mcp-proxy.ts`

Expected work:
- Update any config-init text, validation hints, or generated starter config comments to reflect the new model-ref shape.
- If the init flow continues to only ask for backend, ensure the generated config and surrounding guidance do not imply old string-based Pi model config.

#### Consumer Integration Package: Claude Plugin

Primary files: `eforge-plugin/skills/config/config.md`, `eforge-plugin/skills/init/init.md`, `eforge-plugin/.claude-plugin/plugin.json`

Expected work:
- Update config guidance to teach object-shaped model refs.
- Update all Pi-specific examples to use `{ provider, id }`.
- Update Claude SDK examples to use `{ id }`.
- Remove guidance that tells users to set `pi.provider` plus string models.
- Bump plugin version in `eforge-plugin/.claude-plugin/plugin.json`.

#### Consumer Integration Package: Pi

Primary files: `pi-package/skills/eforge-config/SKILL.md`, `pi-package/skills/eforge-init/SKILL.md`, `pi-package/extensions/eforge/index.ts`

Expected work:
- Update config guidance to teach object-shaped model refs.
- Update Pi package init/config examples and comments.
- Remove guidance that treats `pi.provider` as model-selection config.
- Keep package version unchanged in `pi-package/package.json`.

#### Core Documentation

Primary files: `README.md`, `docs/config.md`

Expected work:
- Rewrite model configuration examples to use object refs.
- Clarify backend-specific model ref shapes.
- Clarify that Pi model resolution uses provider/id and consults Pi auth and model files.
- Remove stale references to `pi.provider` as the source of model selection.

### Test Impact

Tests will need broad updates because current expectations are string-based.

Primary test files likely affected:
- `test/config.test.ts`
- `test/pipeline.test.ts`
- `test/pi-backend.test.ts`
- `test/engine-wiring.test.ts`
- `test/stub-backend.ts`
- Any tests asserting `pickSdkOptions({ model: "..." })`

#### New Tests Needed

**Config Schema:**
- `backend: claude-sdk` accepts `{ id }` model refs.
- `backend: pi` accepts `{ provider, id }` model refs.
- `backend: pi` rejects `{ id }`.
- `backend: pi` rejects string model refs.
- `backend: claude-sdk` rejects `{ provider, id }`.
- `agents.model`, `agents.models.<class>`, and per-role `model` all validate with backend-appropriate shape.

**Resolution Logic:**
- Class resolution returns object-shaped refs, not strings.
- Per-role model ref overrides global/class refs.
- Claude defaults still resolve correctly in object-shaped form if defaults remain built-in.
- Pi backend still throws descriptive errors when no model is configured for a required class.

**Pi Backend Runtime:**
- Pi backend resolves configured `{ provider, id }` through `ModelRegistry.find()`.
- Fallback to `getModel()` works for known built-ins if registry misses.
- Synthetic fallback object is only used after registry and built-in lookup miss.
- Emitted events still contain expected backend and model labels.

### Risks

1. **Config Schema Complexity** - Backend-conditional validation is more complex than the current flat schema. Keep the implementation disciplined so error messages remain clear.
2. **Type Ripple** - Model refs currently flow through many agent option types as strings. This refactor will touch shared typing and may cause wide compile breakage until complete.
3. **Pi Registry Semantics** - Pi's `ModelRegistry` behavior should be used intentionally. Avoid reintroducing implicit defaults outside the registry path.
4. **Docs Drift** - There is duplicated config documentation across engine docs, README, Claude plugin skill docs, and Pi package skill docs. These must all be updated together or users will get conflicting guidance.

### Migration Notes

This work does not need compatibility shims. It is acceptable for existing configs to fail validation after this change. The docs and integration package guidance should make the new shape obvious and easy to adopt. If a migration note is added to docs, it should say plainly:
- Old string model refs are obsolete
- Pi users must now specify `provider` and `id`
- Claude SDK users must now specify `id`

### Implementation Notes

- Use a single `ModelRef = { id: string; provider?: string }` runtime type. Enforce backend-specific constraints at the Zod schema boundary via `.superRefine()`, not in the type system.
- Keep backend selection global.
- Do not silently synthesize provider defaults for Pi.
- Ensure `agent:start` events continue to show a string model identifier (via `model.id`) for monitor compatibility.
- Pi's `resolveModel()` must move into the `run()` generator because `ModelRegistry.find()` requires async `AuthStorage` initialization. The current sync function cannot be used.
- Remove dead `agentProfileConfigSchema` and its exports as part of this work (leftover from removed custom profiles feature).

### Suggested Execution Order

1. Remove dead `agentProfileConfigSchema` and its exports.
2. Define `ModelRef` type and redesign config schemas (Zod + `.superRefine()`).
3. Remove `pi.provider` from config schema and `PiConfig`.
4. Update `MODEL_CLASS_DEFAULTS`, `resolveAgentConfig()`, `pickSdkOptions` for `ModelRef`.
5. Update Claude SDK backend to extract `model.id`.
6. Update Pi backend: move model resolution into `run()` generator, use `ModelRegistry.find()`.
7. Update tests for config parsing, pipeline resolution, and Pi registry lookup.
8. Update docs in `docs/` and `README.md`.
9. Update `eforge-plugin/` and `pi-package/` docs and init/config guidance.
10. Run test suite and type-check.

### Resolved Questions

1. **`fallbackModel`** - Stays string-based. Only used by Claude SDK, no benefit to converting.
2. **Claude defaults** - Stored as `ModelRef` objects (e.g. `{ id: 'claude-opus-4-6' }`) in `MODEL_CLASS_DEFAULTS`.
3. **`pi.provider`** - Removed entirely. It is only used for model resolution and has no other purpose.

## Scope

### In Scope

- Make configured model references explicit objects instead of raw strings
- Keep the single global `backend` selection
- For `claude-sdk`, require model refs shaped as `{ id }`
- For `pi`, require model refs shaped as `{ provider, id }`
- Remove `pi.provider` from the config schema entirely (it has no non-model purpose)
- Resolve Pi models through Pi-native lookup using `ModelRegistry.find(provider, id)` before any fallback behavior
- Update validation, docs, tests, and both consumer-facing integration packages so the new config model is taught consistently everywhere
- Remove dead `agentProfileConfigSchema` and its exports

### Out of Scope

- Supporting mixed backends within a single run
- Preserving existing string model config formats
- Implementing automatic migration of existing configs
- Changing event schemas or monitor UX beyond what is needed to continue displaying backend/model information
- Reworking orchestration or agent role/model class concepts beyond model reference typing and resolution
- Preserving the unused `agentProfileConfigSchema` (dead code from removed custom profiles feature)

## Acceptance Criteria

1. `eforge/config.yaml` uses object-shaped model refs instead of strings.
2. With `backend: claude-sdk`, configured model refs require `{ id }`.
3. With `backend: pi`, configured model refs require `{ provider, id }`.
4. Pi model resolution consults Pi's `ModelRegistry.find(provider, id)` so models from `~/.pi/agent/models.json` can resolve.
5. `pi.provider` is removed from the config schema entirely.
6. Config validation errors are explicit for missing/invalid provider/id combinations.
7. Dead `agentProfileConfigSchema` and its exports are removed.
8. Engine tests are updated for new typing and resolution behavior.
9. Pi backend tests cover registry-based model resolution.
10. `README.md` and `docs/config.md` teach the new config shape.
11. `eforge-plugin/` and `pi-package/` are updated in sync with the new guidance.
12. `eforge-plugin/.claude-plugin/plugin.json` version is bumped if plugin package files change.
