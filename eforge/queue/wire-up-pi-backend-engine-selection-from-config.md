---
title: Wire up Pi backend engine selection from config
created: 2026-03-29
status: pending
---

# Wire up Pi backend engine selection from config

## Problem / Motivation

The Pi backend (`PiBackend` class, MCP bridge, extension discovery) was merged as part of the `add-pi-mono-backend-for-eforge` plan set, but plan-03 (engine wiring and tests) was lost when a finalize-merge step failed due to a conflict. The config schema supports `backend: pi`, but `EforgeEngine` never consults `config.backend` - the constructor at `src/engine/eforge.ts:122` unconditionally falls back to `ClaudeSDKBackend`:

```typescript
this.backend = options.backend ?? new ClaudeSDKBackend({...});
```

Since the eval harness and CLI go through `EforgeEngine.create()`, there is no way to use the Pi backend from config alone. Additionally, there are pre-existing type errors in `src/engine/backends/pi.ts` (previously fixed in the lost merge worktree) that cause `pnpm type-check` to fail.

## Goal

Wire up `config.backend` selection in `EforgeEngine.create()` so that setting `backend: pi` in `eforge/config.yaml` (or `eforge.yaml`) causes the engine to instantiate `PiBackend` instead of `ClaudeSDKBackend`, and fix the remaining type errors in the Pi backend module.

## Approach

### 1. Backend selection in `EforgeEngine.create()` (`src/engine/eforge.ts`)

In the `create()` static factory, after MCP server and plugin auto-discovery (lines 156-169), add Pi backend construction when `config.backend === 'pi'` and no explicit `options.backend` was provided:

```typescript
if (!options.backend && config.backend === 'pi') {
  const { PiBackend } = await import('./backends/pi.js');
  options = { ...options, backend: new PiBackend({
    mcpServers: options.mcpServers,
    piConfig: config.pi,
    bare: config.agents.bare,
  }) };
}
```

Use dynamic `import()` so `PiBackend` and its heavy transitive dependencies (`@mariozechner/pi-coding-agent`, `@mariozechner/pi-ai`, etc.) are not loaded when using the default `claude-sdk` backend. This is important since most users won't have pi packages installed.

The existing constructor fallback (`options.backend ?? new ClaudeSDKBackend(...)`) continues to handle the `claude-sdk` default case - no changes needed there.

### 2. Fix pre-existing type errors in `src/engine/backends/pi.ts`

The validation fixer previously fixed these in the merge worktree but those changes were lost. Known issues:

- Reference to `"error"` event type that doesn't exist in Pi SDK's event union type
- Stale `session` variable reference (line ~534)

### 3. Unit test (`test/engine-wiring.test.ts`)

Add a lightweight test that verifies:

- Config with `backend: 'pi'` causes `create()` to produce an engine whose backend is a `PiBackend` instance
- Config with `backend: 'claude-sdk'` (or omitted) preserves existing `ClaudeSDKBackend` behavior
- Explicit `options.backend` takes priority over config (existing behavior)

Use `StubBackend` or instance-of checks - no actual API calls needed.

## Scope

**In scope:**

- Backend selection logic in `EforgeEngine.create()` based on `config.backend`
- Dynamic import of `PiBackend` to avoid loading heavy dependencies for non-Pi users
- Fixing type errors in `src/engine/backends/pi.ts` (error event type, stale session reference)
- Unit test for engine wiring behavior

**Out of scope:**

- Changes to `PiBackend` implementation itself (already fully implemented and exported)
- Changes to config schema (already supports `backend: pi`)
- Changes to `ClaudeSDKBackend` or its default fallback behavior

## Acceptance Criteria

1. `pnpm type-check` passes (including `pi.ts`)
2. `pnpm test` passes with the new engine wiring test
3. Setting `backend: pi` with an `OPENROUTER_API_KEY` env var and running `eforge build` on a simple PRD uses the Pi backend (manual verification)
4. Omitting `backend` (or setting `claude-sdk`) preserves existing behavior with no changes
