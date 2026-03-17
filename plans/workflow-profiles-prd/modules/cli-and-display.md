# CLI and Display

## Architecture Reference

This module implements [CLI → Engine integration contract] and [Backwards-compatible event transition] from the architecture.

Key constraints from architecture:
- `--profiles <path>` adds profiles from a YAML file to the palette - it does not select a specific profile
- Multiple `--profiles` flags could be supported for layering
- The flag is additive, not selective
- `plan:profile` is the new canonical event; `plan:scope` continues to be emitted during transition
- Profile name is included in `phase:start` metadata for downstream consumers

## Scope

### In Scope
- CLI `--profiles <path>` option on the `run` command (repeatable, accepts file path to a profiles YAML file)
- Parsing of `--profiles` files via `parseProfilesFile()` from the config-and-types module
- Passing parsed profile overrides to `EforgeEngine.create()` via `EforgeEngineOptions.profileOverrides`
- `buildConfigOverrides()` updated to thread profile overrides into engine options
- Display rendering for `plan:profile` events in `src/cli/display.ts`
- Exhaustive switch updated to handle `plan:profile` without falling through to the `never` default
- `plan:profile` event handling in the `run` command's phase-1 event loop (for logging/tracking alongside `plan:scope`)

### Out of Scope
- Profile type definitions and config parsing (config-and-types module)
- `EforgeEngineOptions.profileOverrides` type definition (engine-pipeline module)
- Engine-side profile selection logic (engine-pipeline module)
- `plan:profile` event emission from planner/assessor agents (backend-and-prompts module)
- Review cycle parameterization (future module)
- Eval integration with profiles (deferred)

## Implementation Approach

### Overview

Add the `--profiles` CLI flag, wire it through to the engine, and update all display/rendering code to handle the new `plan:profile` event. The changes are thin and mechanical - the CLI parses files, the engine consumes them, and the display renders the new event type.

### Key Decisions

1. **`--profiles` uses Commander's variadic option pattern** - Commander supports repeatable options via `.option('--profiles <paths...>')` or by collecting values manually. Since profiles files layer on top of each other, the option accepts a single path per flag and can be repeated: `--profiles team.yaml --profiles overrides.yaml`. This matches Commander's `.option()` with array collection.

2. **Profile file parsing happens in the CLI action handler, not in `buildConfigOverrides()`** - `buildConfigOverrides()` returns `Partial<EforgeConfig>`, but profile overrides need their own field on `EforgeEngineOptions` (as `profileOverrides`). The CLI action handler calls `parseProfilesFile()` for each `--profiles` path, merges the results, and passes the merged `Record<string, PartialProfileConfig>` directly to `EforgeEngine.create()`.

3. **`plan:profile` renders on its own line, separate from `plan:scope`** - Both events may fire during transition. `plan:profile` renders as `  Profile: {name} - {rationale}` with color-coding matching the scope colors for built-in profile names. `plan:scope` rendering stays unchanged. This avoids coupling the two events and lets consumers migrate independently.

4. **Monitor UI treats `plan:profile` as an info event** - The event card classifies `plan:profile` alongside `plan:scope` as `cls: 'info'` and renders the profile name and rationale as summary text.

5. **Mock server emits `plan:profile` immediately after `plan:scope`** - During the transition period, both events fire. The mock server adds `plan:profile` events to maintain realistic test data for the monitor UI.

## Files

### Modify
- `src/cli/index.ts` - Add `--profiles <paths...>` option to the `run` command. Parse profile files in the action handler. Pass `profileOverrides` to `EforgeEngine.create()`. No changes to the phase-1 event loop needed beyond what the exhaustive switch in `display.ts` handles (the `plan:profile` event flows through `renderEvent()` like all others).

- `src/cli/display.ts` - Add `plan:profile` case to the exhaustive `renderEvent()` switch. Render profile name with scope-matching color coding and rationale in dim text. Format: `  Profile: {colorFn(profileName)} - {dim(rationale)}`.

## Detailed Changes

### `src/cli/index.ts`

#### Option definition

Add to the `run` command options chain (after `--no-plugins`):

```typescript
.option('--profiles <paths...>', 'Additional workflow profile files to load')
```

Update the options type in the action handler:

```typescript
options: {
  // ... existing fields ...
  profiles?: string[];
}
```

#### Profile file parsing and engine wiring

In the action handler, after `buildConfigOverrides()` and before `EforgeEngine.create()`:

```typescript
// Parse --profiles files into profile overrides
let profileOverrides: Record<string, import('../engine/config.js').PartialProfileConfig> | undefined;
if (options.profiles?.length) {
  const { parseProfilesFile } = await import('../engine/config.js');
  profileOverrides = {};
  for (const profilePath of options.profiles) {
    const parsed = await parseProfilesFile(resolve(profilePath));
    // Later files override earlier ones for same-name profiles
    Object.assign(profileOverrides, parsed);
  }
  if (Object.keys(profileOverrides).length === 0) {
    profileOverrides = undefined;
  }
}
```

Pass to engine:

```typescript
const engine = await EforgeEngine.create({
  onClarification: createClarificationHandler(options.auto ?? false),
  onApproval: createApprovalHandler(options.auto ?? false),
  ...(configOverrides && { config: configOverrides }),
  ...(profileOverrides && { profileOverrides }),
});
```

Note: `EforgeEngineOptions.profileOverrides` is defined by the engine-pipeline module as `Record<string, PartialProfileConfig> | undefined`.

### `src/cli/display.ts`

Add a new case in the `renderEvent()` switch, after the `plan:scope` case:

```typescript
case 'plan:profile': {
  const profileColors: Record<string, (s: string) => string> = {
    errand: chalk.green,
    excursion: chalk.yellow,
    expedition: chalk.magenta,
  };
  const colorFn = profileColors[event.profileName] ?? chalk.cyan;
  console.log(`  Profile: ${colorFn(event.profileName)} \u2014 ${chalk.dim(event.rationale)}`);
  break;
}
```

This mirrors the `plan:scope` rendering pattern with matching colors for built-in profile names. Custom profile names render in cyan (distinguishable from built-ins).

## Testing Strategy

### Unit Tests

No new test file needed. The changes are thin wiring with no complex logic. Verification is via type-checking (exhaustive switch) and manual/integration testing.

**Exhaustive switch coverage**: The `never` default in `renderEvent()` guarantees at compile time that `plan:profile` is handled. If the case is missing, `pnpm type-check` fails.

**`--profiles` flag parsing**: Commander handles the option parsing. The file-loading calls `parseProfilesFile()` which is tested in the config-and-types module.

### Integration Tests (manual verification)

- Run `eforge run prd.md --profiles team.yaml` - verify the engine receives profile overrides
- Run with `--verbose` - verify `plan:profile` event renders in the terminal
- Open the monitor dashboard - verify `plan:profile` events appear in the timeline

## Verification

- [ ] `pnpm type-check` passes with zero errors - the exhaustive `never` default in `renderEvent()` confirms `plan:profile` is handled
- [ ] `pnpm build` produces `dist/cli.js` without errors
- [ ] `pnpm test` passes - all existing tests remain green
- [ ] The `run` command's `--help` output includes `--profiles <paths...>` with description "Additional workflow profile files to load"
- [ ] `renderEvent({ type: 'plan:profile', profileName: 'errand', rationale: 'test' })` prints `  Profile: errand - test` to stdout (with `errand` in green, `test` in dim)
- [ ] `renderEvent({ type: 'plan:profile', profileName: 'custom-name', rationale: 'test' })` prints `  Profile: custom-name - test` with `custom-name` in cyan
- [ ] `EforgeEngine.create()` accepts `profileOverrides: { migration: { description: 'test', extends: 'errand' } }` without type errors
- [ ] When `--profiles nonexistent.yaml` is passed, `parseProfilesFile` throws (file not found) and the CLI exits with an error before reaching the engine
- [ ] When `--profiles valid.yaml` is passed with a file containing `profiles: { fast: { extends: errand, build: [implement] } }`, the engine's resolved config includes the `fast` profile
- [ ] Both `plan:scope` and `plan:profile` events render without errors when they appear in the same event stream (transition compatibility)
- [ ] The `--profiles` option can be repeated: `--profiles a.yaml --profiles b.yaml` results in profiles from both files merged (b overriding a for same-name profiles)
