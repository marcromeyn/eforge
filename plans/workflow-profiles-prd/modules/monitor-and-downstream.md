# Monitor and Downstream

## Architecture Reference

This module implements [Backwards-compatible event transition] and [Observability] from the architecture.

Key constraints from architecture:
- `plan:profile` is the new canonical event; `plan:scope` continues to be emitted during the transition period
- Profile name is included in `phase:start` metadata for downstream consumers
- The monitor can display and filter by profile
- `plan:scope` continues to work - no backwards-incompatible removal

## Scope

### In Scope
- Monitor UI types: add `plan:profile` to the re-exported types from `src/monitor/ui/src/lib/types.ts`
- Event card rendering: handle `plan:profile` events in `classifyEvent()` and `eventSummary()` in `event-card.tsx`
- Mock server: add `plan:profile` events alongside existing `plan:scope` events in all 6 mock runs
- CLI display: render `plan:profile` events in `src/cli/display.ts` with profile name and rationale
- CLI index: handle `plan:profile` in the `complete` short-circuit check in `src/cli/index.ts`
- eforge plugin: bump version in `eforge-plugin/.claude-plugin/plugin.json` from `1.1.2` to `1.2.0`
- eforge plugin skill text: update `run.md` to reference profile selection instead of scope assessment
- CLAUDE.md: update Architecture, Configuration, CLI commands, and Conventions sections

### Out of Scope
- Profile type definitions and config parsing (config-and-types module)
- Pipeline stage registry and execution (engine-pipeline module)
- Planner/assessor prompt changes (backend-and-prompts module)
- `ClaudeSDKBackend` model passthrough (backend-and-prompts module)
- Monitor sidebar filtering by profile (future enhancement - not in PRD scope)
- Eval integration with profiles (deferred per architecture)

## Implementation Approach

### Overview

Add `plan:profile` event handling to all downstream consumers: monitor UI, CLI display, mock server, and eforge plugin. Each consumer already handles `plan:scope` - the pattern is to add parallel handling for `plan:profile` without removing `plan:scope` support. The mock server emits both events for each run, simulating the transition period. CLAUDE.md updates document the new profile config, pipeline architecture, and CLI flags.

### Key Decisions

1. **Monitor UI types need no new local types** - `plan:profile` is already part of the `EforgeEvent` union (added by config-and-types module). The monitor UI re-exports `EforgeEvent` from the engine, so it picks up the new variant automatically. No new types needed in `types.ts`.

2. **Event card classifies `plan:profile` as `info`** - Same classification as `plan:scope` (purple badge). Both are informational planning events. The summary shows `Profile: {name} — {rationale}` mirroring the `Scope: {assessment} — {justification}` format.

3. **Mock server emits both `plan:profile` and `plan:scope`** - Each mock run gets a `plan:profile` event inserted immediately after the existing `plan:scope` event. This simulates the transition period where both events coexist. Profile names match the scope assessment (`errand` → `errand` profile, etc.).

4. **CLI display renders `plan:profile` with scope-like colors** - Reuses the same color mapping since built-in profile names match scope names. Renders as `Profile: {coloredName} — {rationale}`.

5. **Plugin version bumped to `1.2.0`** - Minor version bump (not patch) because workflow profiles is a feature addition that changes user-facing behavior described in skill text.

6. **CLAUDE.md updates are additive** - New sections/bullets added to existing structure. No removal of scope-related documentation since `plan:scope` remains during transition.

## Files

### Modify
- `src/monitor/ui/src/components/timeline/event-card.tsx` — Add `plan:profile` to `classifyEvent()` (classified as `info`), `eventSummary()` (renders profile name + rationale), and `eventDetail()` (returns rationale as expandable detail).

- `src/monitor/mock-server.ts` — Insert `plan:profile` events after each existing `plan:scope` event across all 6 mock runs. Profile names correspond to scope assessments: `errand` → profile `errand`, `excursion` → profile `excursion`, `expedition` → profile `expedition`.

- `src/monitor/ui/src/lib/types.ts` — No change needed. The file re-exports `EforgeEvent` from the engine, which already includes `plan:profile` after config-and-types module.

- `eforge-plugin/.claude-plugin/plugin.json` — Bump `version` from `"1.1.2"` to `"1.2.0"`.

- `eforge-plugin/skills/run/run.md` — Update the adopt mode monitor message (lines 87-88) to reference profile selection instead of scope assessment. Change "Scope assessment — analyzes the plan against the codebase to determine scope (errand/excursion/expedition)" to "Profile selection — analyzes the plan against the codebase to select a workflow profile (errand/excursion/expedition, or custom profiles)".

- `CLAUDE.md` — Update multiple sections (detailed below).

## Detailed Changes

### Event Card (`src/monitor/ui/src/components/timeline/event-card.tsx`)

**`classifyEvent()`** — Add `plan:profile` alongside `plan:scope`:

```typescript
if (type === 'plan:scope' || type === 'plan:profile' || type === 'plan:clarification') return { cls: 'info', label: type };
```

**`eventSummary()`** — Add case after `plan:scope`:

```typescript
case 'plan:profile': return `Profile: ${event.profileName} — ${event.rationale}`;
```

**`eventDetail()`** — Add case returning the rationale as expandable detail:

```typescript
case 'plan:profile':
  return event.rationale;
```

### Mock Server (`src/monitor/mock-server.ts`)

Insert `plan:profile` events immediately after each `plan:scope` event. Each `plan:profile` uses the same profile name as the scope assessment, with a rationale string derived from the justification.

For each of the 6 mock runs:

**Run 1 (errand)** — after line 239:
```typescript
insertEvent(RUN1_ID, { type: 'plan:profile', profileName: 'errand', rationale: 'Single endpoint addition with no dependencies — errand profile fits best' } as unknown as EforgeEvent, 5500);
```

**Run 2 (excursion)** — after line 321:
```typescript
insertEvent(RUN2_ID, { type: 'plan:profile', profileName: 'excursion', rationale: 'Multi-file auth work spanning middleware, routes, and tests — excursion profile for medium-complexity cross-file changes' } as unknown as EforgeEvent, 210500);
```

**Run 3 (errand, failed)** — after line 508:
```typescript
insertEvent(RUN3_ID, { type: 'plan:profile', profileName: 'errand', rationale: 'Single middleware addition — errand profile for low-risk single-area change' } as unknown as EforgeEvent, 610500);
```

**Run 5 (errand, validation-fix)** — after line 561:
```typescript
insertEvent(RUN5_ID, { type: 'plan:profile', profileName: 'errand', rationale: 'Caching layer addition to existing endpoints — errand profile fits' } as unknown as EforgeEvent, 755500);
```

**Run 6 (expedition)** — after line 675:
```typescript
insertEvent(RUN6A_ID, { type: 'plan:profile', profileName: 'expedition', rationale: 'Multi-module system with data model, email provider, and API — expedition profile for cross-cutting parallel work' } as unknown as EforgeEvent, 1010500);
```

**Run 4 (running, uses db.insertEvent directly)** — after line 836:
```typescript
db.insertEvent({ runId: RUN4_ID, type: 'plan:profile', data: JSON.stringify({ type: 'plan:profile', profileName: 'excursion', rationale: 'Pagination across routes, query parsing, and tests — excursion profile for multi-file feature work' }), timestamp: runTs(8500) });
```

### Plugin (`eforge-plugin/.claude-plugin/plugin.json`)

Change:
```json
"version": "1.1.2",
```
To:
```json
"version": "1.2.0",
```

### Plugin Run Skill (`eforge-plugin/skills/run/run.md`)

Update lines 87-88 in the adopt mode monitor message:

From:
```markdown
> 1. **Scope assessment** — analyzes the plan against the codebase to determine scope (errand/excursion/expedition)
> 2. **Adoption** — wraps your plan in eforge format (errands wrap as-is; larger scopes delegate to the planner for proper decomposition)
```

To:
```markdown
> 1. **Profile selection** — analyzes the plan against the codebase to select a workflow profile (errand/excursion/expedition, or custom profiles from eforge.yaml)
> 2. **Adoption** — wraps your plan in eforge format (errands wrap as-is; larger profiles delegate to the planner for proper decomposition)
```

### CLAUDE.md Updates

**Architecture section** — Add profile selection to the agent loop description. After the existing "Agent loop" line, add mention of profile selection as a pre-pipeline step:

Current:
```
**Agent loop**: planner → plan-reviewer → plan-evaluator → builder → reviewer → evaluator, each consuming the `AgentBackend` interface. Planning and building both use a shared `runReviewCycle()` for the review→evaluate pattern.
```

Updated:
```
**Agent loop**: profile-selection → planner → plan-reviewer → plan-evaluator → builder → reviewer → evaluator, each consuming the `AgentBackend` interface. Profile selection is a pre-pipeline step where the planner picks the best workflow profile for the work. Planning and building both use a shared `runReviewCycle()` for the review→evaluate pattern.

**Workflow profiles**: Pipeline behavior is config-driven through profiles. A profile declares which compile/build stages run and with what agent parameters. Built-in profiles (`errand`, `excursion`, `expedition`) encode the default behavior. Custom profiles can be defined in `eforge.yaml` or via `--profiles` files. Profile config lives in `DEFAULT_CONFIG.profiles` and participates in the standard merge chain.

**Pipeline stages**: Compile and build pipelines are composed of named stages registered in a stage registry (`src/engine/pipeline.ts`). Each stage is an async generator that accepts a `PipelineContext` and yields `EforgeEvent`s. The engine iterates the stage list from the resolved profile.
```

**Configuration section** — Add profiles to the config schema documentation. After the existing merge strategy documentation, add:

```
**Profiles** (`profiles` section): Workflow profiles declared as named entries. Each profile has `description`, optional `extends`, `compile`/`build` stage lists, per-agent `agents` config, and `review` strategy. Profiles merge by name across config layers. `extends` chains resolve at config load time (cycles rejected). Built-in profiles (`errand`, `excursion`, `expedition`) can be overridden by defining a profile with the same name.
```

**CLI commands section** — Add `--profiles` to the flags list:

Current:
```
Flags: `--auto` (bypass approval gates), `--verbose` (stream output), `--dry-run` (validate only), `--adopt` (wrap existing plan), `--no-monitor` (disable web monitor), `--no-plugins` (disable plugin loading)
```

Updated:
```
Flags: `--auto` (bypass approval gates), `--verbose` (stream output), `--dry-run` (validate only), `--adopt` (wrap existing plan), `--no-monitor` (disable web monitor), `--no-plugins` (disable plugin loading), `--profiles <path>` (add custom workflow profiles from a YAML file)
```

**Project structure section** — Add `pipeline.ts` to the engine file listing:

Add after `backend.ts`:
```
    pipeline.ts               # Pipeline context, stage registry, compile/build stage implementations
```

## Testing Strategy

### Unit Tests

No new test file needed for this module. The changes are to rendering/display code (event card, CLI display, mock data) which are verified visually and via type checking rather than unit tests.

However, add to `test/xml-parsers.test.ts` or existing test files if any parsing logic is added (none for this module - `parseProfileBlock` is in config-and-types module).

### Type-Check Verification

All modified `.tsx` and `.ts` files must pass `pnpm type-check`. The `plan:profile` event type from config-and-types module must be compatible with the switch cases and property accesses added here.

### Manual Verification

- Run `pnpm dev:mock` and open the monitor at `http://localhost:4567` to verify `plan:profile` events render in the timeline with purple info badges
- Run `pnpm build` to verify the plugin and CLI changes compile

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes with all existing tests green
- [ ] `pnpm build` completes with zero errors
- [ ] `classifyEvent('plan:profile', ...)` returns `{ cls: 'info', label: 'plan:profile' }` (same classification as `plan:scope`)
- [ ] `eventSummary()` for a `plan:profile` event returns a string starting with `"Profile: "` followed by the profile name and rationale
- [ ] `eventDetail()` for a `plan:profile` event returns the rationale string (non-null)
- [ ] Mock server contains exactly 6 `plan:profile` events (one per mock run), each inserted after the corresponding `plan:scope` event
- [ ] Mock server `plan:profile` events use profile names matching the corresponding `plan:scope` assessment (`errand`→`errand`, `excursion`→`excursion`, `expedition`→`expedition`)
- [ ] CLI `display.ts` has a `case 'plan:profile'` that renders with `chalk.green` for `errand`, `chalk.yellow` for `excursion`, `chalk.magenta` for `expedition`, and `chalk.cyan` for unknown profile names
- [ ] `eforge-plugin/.claude-plugin/plugin.json` version is `"1.2.0"`
- [ ] `eforge-plugin/skills/run/run.md` line 87 contains "Profile selection" instead of "Scope assessment"
- [ ] `eforge-plugin/skills/run/run.md` line 88 contains "larger profiles" instead of "larger scopes"
- [ ] CLAUDE.md Architecture section contains "profile-selection" in the agent loop description
- [ ] CLAUDE.md Architecture section contains a "Workflow profiles" paragraph describing config-driven pipeline behavior
- [ ] CLAUDE.md Architecture section contains a "Pipeline stages" paragraph referencing `src/engine/pipeline.ts`
- [ ] CLAUDE.md Configuration section documents the `profiles` config section including `extends`, `compile`, `build`, `agents`, and `review` fields
- [ ] CLAUDE.md CLI commands flags list includes `--profiles <path>`
- [ ] CLAUDE.md Project structure includes `pipeline.ts` in the engine file listing
- [ ] `plan:scope` handling remains unchanged in all files - no removal of existing `plan:scope` cases or rendering
- [ ] `classifyEvent('plan:scope', ...)` still returns `{ cls: 'info', label: 'plan:scope' }` (unchanged)
