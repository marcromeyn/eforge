---
id: plan-01-daemon-idle-shutdown
name: Persistent Daemon Idle Auto-Shutdown
depends_on: []
branch: claude-plans-precious-zooming-feather/daemon-idle-shutdown
---

# Persistent Daemon Idle Auto-Shutdown

## Architecture Context

The eforge monitor/daemon server has a state machine (WATCHING → COUNTDOWN → SHUTDOWN) for auto-shutdown, but it only runs in ephemeral mode (`if (!persistent)` guard on line 384 of `server-main.ts`). Persistent daemons run forever, leading to orphaned processes when users forget `eforge daemon stop`. The MCP proxy's `ensureDaemon()` auto-restarts the daemon on every tool invocation, making idle shutdown safe and transparent.

## Implementation

### Overview

Add a `daemon` config section with `idleShutdownMs` (default 2 hours), parameterize `evaluateStateCheck()` with an `idleFallbackMs` field, and enable the state machine in persistent mode using the configured idle threshold.

### Key Decisions

1. **Config section named `daemon`** — keeps daemon-specific settings isolated from `prdQueue` and `build`
2. **`idleShutdownMs: 0` disables shutdown** — opt-in to current "run forever" behavior for users who want it
3. **Parameterize `evaluateStateCheck` via `StateCheckContext.idleFallbackMs`** — avoids module-level constant dependency, keeps the function testable with different thresholds
4. **Reuse existing state machine** — no new shutdown logic needed; just remove the `if (!persistent)` guard and wire the configured threshold

## Scope

### In Scope
- New `daemon` config section in Zod schema, types, defaults, merge logic, and fallback parser
- `idleFallbackMs` field on `StateCheckContext` interface
- Replace hardcoded `IDLE_FALLBACK_MS` in `evaluateStateCheck()` with `ctx.idleFallbackMs`
- Enable state machine in persistent mode with config-driven idle threshold
- Skip state machine when `idleShutdownMs: 0` (preserves current forever behavior)
- Update `makeContext()` test helper and add new test cases
- Document `daemon` config in CLAUDE.md

### Out of Scope
- CLI flags for idle timeout (config-only for now)
- Countdown duration changes (those remain constant-based)
- Any changes to ephemeral mode behavior

## Files

### Modify
- `src/engine/config.ts` — Add `daemon` section to Zod schema (`eforgeConfigSchema`), `EforgeConfig` interface, `DEFAULT_CONFIG`, `resolveConfig()`, `parseRawConfigFallback` sections list, `stripUndefinedSections`, and `mergePartialConfigs`
- `src/monitor/server-main.ts` — Add `idleFallbackMs: number` to `StateCheckContext`; replace `IDLE_FALLBACK_MS` with `ctx.idleFallbackMs` in `evaluateStateCheck()`; remove `if (!persistent)` guard and duplicate the state machine setup for persistent mode with `config.daemon.idleShutdownMs` as the idle threshold (skip when 0)
- `test/monitor-shutdown.test.ts` — Add `idleFallbackMs` to `makeContext()` helper (default `10_000`); add tests for persistent-mode countdown transition and `idleFallbackMs: 0` disabling the state machine
- `CLAUDE.md` — Add `daemon` to config documentation in the Configuration section

## Verification

- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` exits with code 0 (all existing + new tests pass)
- [ ] `pnpm build` exits with code 0
- [ ] `evaluateStateCheck()` uses `ctx.idleFallbackMs` instead of `IDLE_FALLBACK_MS` constant for idle threshold comparison
- [ ] `StateCheckContext` interface includes `idleFallbackMs: number` field
- [ ] `EforgeConfig` interface includes `daemon: { idleShutdownMs: number }` field
- [ ] `DEFAULT_CONFIG.daemon.idleShutdownMs` equals `7_200_000`
- [ ] Persistent mode with `idleShutdownMs > 0` creates a state machine interval
- [ ] Persistent mode with `idleShutdownMs === 0` skips state machine creation
- [ ] Ephemeral mode behavior is unchanged (passes `IDLE_FALLBACK_MS` as `idleFallbackMs`)
