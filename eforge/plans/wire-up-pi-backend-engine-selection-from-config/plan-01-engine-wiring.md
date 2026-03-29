---
id: plan-01-engine-wiring
name: Wire up Pi backend selection from config in EforgeEngine.create()
depends_on: []
branch: wire-up-pi-backend-engine-selection-from-config/engine-wiring
---

# Wire up Pi backend selection from config in EforgeEngine.create()

## Architecture Context

The `PiBackend` class and config schema (`backend: 'claude-sdk' | 'pi'`) are fully implemented. The only missing piece is the wiring in `EforgeEngine.create()` that reads `config.backend` and instantiates the correct backend. Currently, the constructor at line 122 unconditionally falls back to `ClaudeSDKBackend` when no explicit `options.backend` is provided.

The Pi backend and its transitive dependencies (`@mariozechner/pi-ai`, `@mariozechner/pi-agent-core`, etc.) are optional - most users won't have them installed. Dynamic `import()` is required to avoid loading these modules when the default `claude-sdk` backend is in use.

## Implementation

### Overview

Add backend selection logic in `EforgeEngine.create()` between plugin auto-discovery and the `new EforgeEngine()` call. When `config.backend === 'pi'` and no explicit `options.backend` was provided, dynamically import `PiBackend` and set it as the backend. The existing constructor fallback to `ClaudeSDKBackend` continues to handle the default case unchanged.

Also add a unit test verifying the three backend selection paths: config-driven Pi selection, default ClaudeSDKBackend, and explicit `options.backend` override.

### Key Decisions

1. **Dynamic import for PiBackend** - Use `await import('./backends/pi.js')` so Pi SDK dependencies are never loaded for claude-sdk users. This keeps the default path fast and avoids import errors when Pi packages aren't installed.
2. **Wiring location in create()** - Place the backend selection after MCP server and plugin auto-discovery (lines 155-169) but before `new EforgeEngine()` (line 171). This ensures discovered MCP servers are available to pass to PiBackend.
3. **PiBackend receives mcpServers and piConfig** - Match the PiBackendOptions interface: pass `mcpServers` from discovered/provided options, `piConfig` from `config.pi`, and `bare` from `config.agents.bare`.
4. **Test uses vi.mock for dynamic import** - Since `EforgeEngine.create()` loads config from disk, the test mocks `loadConfig` to return controlled config objects. It also mocks the PiBackend import path to avoid requiring actual Pi SDK packages in test.

## Scope

### In Scope
- Backend selection logic in `EforgeEngine.create()` based on `config.backend`
- Dynamic import of `PiBackend` to avoid loading heavy dependencies for non-Pi users
- Unit test for the three backend selection paths

### Out of Scope
- Changes to `PiBackend` implementation (already complete)
- Changes to config schema (already supports `backend: pi`)
- Changes to `ClaudeSDKBackend` or its default fallback behavior
- Changes to pi.ts type errors (already resolved - `pnpm type-check` passes)

## Files

### Modify
- `src/engine/eforge.ts` - Add Pi backend instantiation block in `create()` between plugin discovery and constructor call (lines 169-171). Insert ~8 lines of conditional dynamic import logic.

### Create
- `test/engine-wiring.test.ts` - New test file verifying backend selection: (1) `config.backend: 'pi'` causes PiBackend instantiation, (2) default/`claude-sdk` config preserves ClaudeSDKBackend, (3) explicit `options.backend` overrides config.

## Verification

- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` exits with code 0, including the new `test/engine-wiring.test.ts`
- [ ] `EforgeEngine.create()` with `config.backend: 'pi'` produces an engine whose backend is a `PiBackend` instance
- [ ] `EforgeEngine.create()` with default config produces an engine whose backend is a `ClaudeSDKBackend` instance
- [ ] Explicit `options.backend` takes priority over `config.backend` value
- [ ] PiBackend is imported via dynamic `import()`, not a static top-level import in eforge.ts
