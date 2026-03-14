---
id: plan-01-event-hooks
name: Event Hooks for eforge.yaml
depends_on: []
branch: giggly-strolling-lagoon/event-hooks
---

# Event Hooks for eforge.yaml

## Architecture Context

eforge runs outside Claude Code, so Claude Code's hook system is never triggered during eforge runs. This plan adds a `hooks` section to `eforge.yaml` that lets users run shell commands in response to `EforgeEvent`s, using the same stdin-JSON pattern Claude Code uses.

The implementation follows the existing async generator middleware pattern established by `withRecording()` in `src/monitor/recorder.ts` — a transparent wrapper that intercepts events, performs side effects (hook execution), and re-yields events unchanged.

### Key Decisions

1. **Glob-style pattern matching on event types** — `*` matches any characters including `:`, so `build:*` matches `build:implement:start`. Simple, familiar, sufficient for the flat event namespace.
2. **Fire-and-forget hook execution** — Hooks run non-blocking. The pipeline never waits for hooks to complete before yielding the next event. A `finally` block drains in-flight hooks on generator teardown.
3. **Hooks never crash the pipeline** — All hook errors resolve (never reject). Non-zero exit codes emit a warning to stderr but don't affect the event stream.
4. **CLI-layer wiring** — Hooks are applied in `wrapEvents()` alongside the monitor middleware, keeping the engine pure. The engine emits events; the CLI layer decides which middleware to apply.
5. **stdin-JSON protocol** — Event JSON is written to the hook command's stdin, matching Claude Code's convention. `EFORGE_EVENT_TYPE` env var is set for convenience scripting.

## Scope

### In Scope
- `HookConfig` type and config parsing with validation
- `withHooks()` async generator middleware
- `matchesPattern()` / `compilePattern()` glob-to-regex conversion
- CLI wiring at all `wrapEvents()` call sites
- Unit tests for pattern matching and middleware passthrough
- Config parsing tests for hooks
- Barrel exports

### Out of Scope
- Hook ordering guarantees (hooks for the same event fire concurrently)
- Hook output capture beyond stderr warnings
- Engine-level hook integration (hooks are CLI-layer middleware only)
- Interactive hooks or hooks that can modify events

## Files

### Create
- `src/engine/hooks.ts` — `compilePattern`, `matchesPattern`, `executeHook` (internal), `withHooks` middleware
- `test/hooks.test.ts` — Pattern matching tests and middleware passthrough tests

### Modify
- `src/engine/config.ts` — Add `HookConfig` interface, `hooks: HookConfig[]` to `EforgeConfig`, parsing in `parseRawConfig()`, defaults in `DEFAULT_CONFIG`, resolution in `resolveConfig()`
- `src/engine/eforge.ts` — Add `hooks` to `mergeConfig()`: `hooks: overrides.hooks ?? base.hooks`
- `src/engine/index.ts` — Export `HookConfig`, `withHooks`, `matchesPattern`
- `src/cli/index.ts` — Update `wrapEvents()` to accept `HookConfig[]` and apply `withHooks()`; update 4 call sites (`plan`, `run` phase 1, `run` phase 2, `build`)
- `test/config.test.ts` — Add tests for hooks config parsing (defaults, valid entries, invalid entries skipped)
- `CLAUDE.md` — Add `hooks.ts` to project structure listing under `src/engine/`

## Implementation Details

### `src/engine/config.ts` Changes

Add `HookConfig` interface:
```typescript
export interface HookConfig {
  event: string;   // glob pattern on EforgeEvent.type (e.g. "build:*", "*")
  command: string; // shell command or script path
  timeout: number; // ms, default 5000
}
```

Add to `EforgeConfig`:
```typescript
hooks: HookConfig[];
```

Add to `DEFAULT_CONFIG`:
```typescript
hooks: Object.freeze([]),
```

Add parsing block in `parseRawConfig()` — validate array of `{event: string, command: string, timeout?: number}`, skip invalid entries.

Add to `resolveConfig()`:
```typescript
hooks: Object.freeze(fileConfig.hooks ?? DEFAULT_CONFIG.hooks) as HookConfig[],
```

### `src/engine/hooks.ts` (new file)

Three exports:

**`compilePattern(pattern: string): RegExp`** — Convert glob to regex. `*` → `.*` (matches any chars including `:`). Anchor with `^...$`. Escape regex-special characters in non-`*` segments.

**`matchesPattern(pattern: string, eventType: string): boolean`** — Convenience wrapper: `compilePattern(pattern).test(eventType)`.

**`withHooks(events, hooks, cwd): AsyncGenerator<EforgeEvent>`** — Middleware:
- Zero-overhead: if `hooks.length === 0`, `yield* events` and return
- Pre-compile all patterns once into `Array<{ regex: RegExp; hook: HookConfig }>`
- For each event: fire matching hooks via `executeHook()` (non-blocking — add promise to `inflight` Set), then yield event unchanged
- `finally` block: drain in-flight hooks with `Promise.race([Promise.allSettled([...inflight]), new Promise(r => setTimeout(r, 3000))])`

**`executeHook(hook, event, cwd, inflight): void`** (internal):
- `spawn(command, [], { cwd, stdio: ['pipe', 'ignore', 'pipe'], shell: true })`
- Write `JSON.stringify(event)` to stdin, close stdin
- Set `EFORGE_EVENT_TYPE` env var
- Timeout via `setTimeout` + `child.kill('SIGTERM')`, timer `.unref()`'d
- Collect stderr; warn on non-zero exit
- All errors caught — hooks never crash pipeline
- Track promise in `inflight` Set; remove on settle

### `src/cli/index.ts` Changes

Update `wrapEvents()` signature:
```typescript
function wrapEvents(
  events: AsyncGenerator<EforgeEvent>,
  monitor: Monitor | undefined,
  hooks: HookConfig[],
): AsyncGenerator<EforgeEvent> {
  let wrapped = events;
  if (hooks.length > 0) {
    wrapped = withHooks(wrapped, hooks, process.cwd());
  }
  return monitor ? monitor.wrapEvents(wrapped) : wrapped;
}
```

Update 4 call sites to pass `engine.resolvedConfig.hooks` (`plan` command line ~148, `run` phase 1 line ~201, `run` phase 2 line ~231, `build` command line ~274).

## Verification

- [ ] `pnpm type-check` passes with no errors
- [ ] `pnpm test` passes — all existing tests + new tests in `test/hooks.test.ts` and `test/config.test.ts`
- [ ] `matchesPattern("build:*", "build:start")` returns true
- [ ] `matchesPattern("build:*", "plan:start")` returns false
- [ ] `matchesPattern("*", "anything:here")` returns true
- [ ] `withHooks` with empty hooks array yields events unchanged (identity)
- [ ] `withHooks` with hooks yields all events in order, unchanged
- [ ] Config parsing defaults to empty array when `hooks` not in eforge.yaml
- [ ] Config parsing validates and skips invalid hook entries
