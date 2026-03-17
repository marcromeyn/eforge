# Config and Types

## Architecture Reference

This module implements [Shared Data Model], [Config → Engine integration contract], and [Config merge chain for profiles] from the architecture.

Key constraints from architecture:
- Profiles live in config, not in code - built-in profiles are constants in `DEFAULT_CONFIG.profiles`
- Extension chains resolve at config load time - the engine only sees `ResolvedProfileConfig` objects
- `plan:profile` is the new canonical event; `plan:scope` continues to be emitted during transition
- Profile `agents` shallow-merges per-agent; `compile` and `build` arrays replace (not concatenate); `review` shallow-merges per-field

## Scope

### In Scope
- `ProfileConfig`, `ResolvedProfileConfig`, `AgentProfileConfig`, `ReviewProfileConfig` type definitions
- `plan:profile` event type added to `EforgeEvent` discriminated union
- Built-in profile constants (`errand`, `excursion`, `expedition`) in `DEFAULT_CONFIG`
- Profile parsing in `parseRawConfig()` - validate raw YAML into `PartialProfileConfig`
- Profile extension resolution - walk `extends` chains, detect cycles, shallow-merge
- Profile merging across config layers (global, project, --profiles file)
- `resolveConfig()` updated to handle profiles
- `PartialEforgeConfig` extended with optional `profiles` field
- `EforgeConfig` extended with `profiles: Record<string, ResolvedProfileConfig>`
- Optional `model` field on `AgentRunOptions`
- Custom prompt path support in `loadPrompt()` (path containing `/` loads from that path instead of built-in prompts dir)
- Barrel re-exports in `src/engine/index.ts`
- XML parser for `<profile>` blocks in `src/engine/agents/common.ts`

### Out of Scope
- Pipeline stage registry and execution (separate module)
- Planner prompt changes for profile selection (separate module)
- CLI `--profiles` flag wiring (separate module)
- Monitor UI updates for `plan:profile` (separate module)
- CLI display rendering of profile selection (separate module)
- Build-phase review cycle parameterization (separate module)
- `ClaudeSDKBackend` changes to pass `model` to SDK (separate module - this module only adds the field to the interface)

## Implementation Approach

### Overview

Add profile types and config infrastructure in a bottom-up order: types first, then parsing/validation, then extension resolution, then merge integration, then event types. Each step builds on the previous and is independently testable. The built-in profiles encode today's hardcoded behavior exactly, so the default experience remains unchanged.

### Key Decisions

1. **Profile types live in `config.ts`, not `events.ts`** - Profile config is configuration, not event data. Only `plan:profile` event goes in `events.ts`. The `AgentRole` type already exists in `events.ts` and is reused for the `agents` record key type.

2. **`PartialProfileConfig` mirrors the partial pattern** - Just as `PartialEforgeConfig` exists for parsing, `PartialProfileConfig` represents a pre-resolution profile with optional fields. `ResolvedProfileConfig` has all fields required (after extension resolution fills gaps).

3. **Extension resolution is a standalone pure function** - `resolveProfileExtensions(profiles: Record<string, PartialProfileConfig>): Record<string, ResolvedProfileConfig>` takes the merged partial profiles and returns fully-resolved profiles. Cycle detection uses a visited-set during DFS traversal. This keeps the function unit-testable without config loading.

4. **Built-in profiles define the fallback for extension** - When a profile extends `excursion`, and `excursion` is a built-in, the built-in's values fill any gaps. A profile with no `extends` and missing fields falls back to the `excursion` built-in defaults (the most common case). Actually, profiles without `extends` that are missing required fields after resolution get the `excursion` defaults as a final fallback - this preserves backwards compatibility.

5. **`--profiles` file parsing is a new exported function** - `parseProfilesFile(path: string): Promise<Record<string, PartialProfileConfig>>` loads and validates a standalone profiles YAML file. The CLI module calls this and merges the result into the config.

6. **`plan:profile` coexists with `plan:scope`** - Both events exist in the union. The engine emits `plan:profile` as the primary event and derives `plan:scope` from the profile name when it matches a built-in name. Downstream consumers can migrate at their own pace.

## Files

### Modify
- `src/engine/config.ts` — Add profile type definitions (`ProfileConfig`, `ResolvedProfileConfig`, `AgentProfileConfig`, `ReviewProfileConfig`, `PartialProfileConfig`). Add built-in profiles to `DEFAULT_CONFIG`. Add profile parsing in `parseRawConfig()`. Add `resolveProfileExtensions()` function. Update `mergePartialConfigs()` to handle profiles (merge by name). Update `resolveConfig()` to resolve extensions after merge. Add `parseProfilesFile()` for standalone YAML loading. Extend `EforgeConfig` and `PartialEforgeConfig` with `profiles`.

- `src/engine/events.ts` — Add `plan:profile` variant to `EforgeEvent` union: `{ type: 'plan:profile'; profileName: string; rationale: string }`. No removal of `plan:scope`.

- `src/engine/backend.ts` — Add optional `model?: string` field to `AgentRunOptions`.

- `src/engine/prompts.ts` — Update `loadPrompt()` to detect path-like values (containing `/`) and load from that absolute/relative path instead of the built-in prompts directory. Path-based loads bypass the cache (different files could share a basename).

- `src/engine/agents/common.ts` — Add `parseProfileBlock(text: string): { profileName: string; rationale: string } | null` function to parse `<profile name="excursion">Rationale text</profile>` XML blocks from planner output.

- `src/engine/index.ts` — Re-export new types: `ProfileConfig`, `ResolvedProfileConfig`, `AgentProfileConfig`, `ReviewProfileConfig`, `PartialProfileConfig`, `resolveProfileExtensions`, `parseProfilesFile`, `parseProfileBlock`.

## Detailed Changes

### Profile Types (`src/engine/config.ts`)

```typescript
export type ToolPresetConfig = 'coding' | 'none';

export interface AgentProfileConfig {
  maxTurns?: number;
  prompt?: string;
  tools?: ToolPresetConfig;
  model?: string;
}

export interface ReviewProfileConfig {
  strategy: 'auto' | 'single' | 'parallel';
  perspectives: string[];
  maxRounds: number;
  autoAcceptBelow?: 'suggestion' | 'warning';
  evaluatorStrictness: 'strict' | 'standard' | 'lenient';
}

// Pre-resolution (from YAML parsing)
export interface PartialProfileConfig {
  description?: string;
  extends?: string;
  compile?: string[];
  build?: string[];
  agents?: Partial<Record<AgentRole, AgentProfileConfig>>;
  review?: Partial<ReviewProfileConfig>;
}

// After extension resolution - all required fields present
export interface ResolvedProfileConfig {
  description: string;
  compile: string[];
  build: string[];
  agents: Partial<Record<AgentRole, AgentProfileConfig>>;
  review: ReviewProfileConfig;
}
```

Import `AgentRole` from `events.ts` (already imported in config.ts via the `HookConfig` usage pattern - actually `AgentRole` is defined in `events.ts`, so add the import).

### Built-in Profiles

```typescript
const DEFAULT_REVIEW: ReviewProfileConfig = Object.freeze({
  strategy: 'auto' as const,
  perspectives: Object.freeze(['code']) as unknown as string[],
  maxRounds: 1,
  evaluatorStrictness: 'standard' as const,
});

const DEFAULT_BUILD_STAGES = Object.freeze([
  'implement', 'review', 'review-fix', 'evaluate',
]);

const BUILTIN_PROFILES: Record<string, ResolvedProfileConfig> = Object.freeze({
  errand: Object.freeze({
    description: 'Small, self-contained changes. Single file or a few lines. Low risk, no architectural impact.',
    compile: Object.freeze(['planner', 'plan-review-cycle']),
    build: DEFAULT_BUILD_STAGES,
    agents: Object.freeze({}),
    review: DEFAULT_REVIEW,
  }),
  excursion: Object.freeze({
    description: 'Multi-file feature work or refactors that need planning and review but fit in a single plan. Use for medium-complexity tasks with cross-file changes.',
    compile: Object.freeze(['planner', 'plan-review-cycle']),
    build: DEFAULT_BUILD_STAGES,
    agents: Object.freeze({}),
    review: DEFAULT_REVIEW,
  }),
  expedition: Object.freeze({
    description: 'Large cross-cutting work spanning multiple modules. Needs architecture planning, module decomposition, and parallel execution.',
    compile: Object.freeze(['planner', 'module-planning', 'cohesion-review-cycle', 'compile-expedition']),
    build: DEFAULT_BUILD_STAGES,
    agents: Object.freeze({}),
    review: DEFAULT_REVIEW,
  }),
});
```

Add `profiles` to `DEFAULT_CONFIG`:
```typescript
export const DEFAULT_CONFIG: EforgeConfig = Object.freeze({
  // ... existing fields ...
  profiles: BUILTIN_PROFILES,
});
```

### Extension Resolution

```typescript
export function resolveProfileExtensions(
  partials: Record<string, PartialProfileConfig>,
  builtins: Record<string, ResolvedProfileConfig> = BUILTIN_PROFILES,
): Record<string, ResolvedProfileConfig> {
  const resolved = new Map<string, ResolvedProfileConfig>();
  const resolving = new Set<string>(); // cycle detection

  function resolve(name: string): ResolvedProfileConfig {
    const cached = resolved.get(name);
    if (cached) return cached;

    // If it's a built-in with no user override, return as-is
    const partial = partials[name];
    if (!partial) {
      const builtin = builtins[name];
      if (builtin) return builtin;
      throw new Error(`Profile "${name}" not found`);
    }

    if (resolving.has(name)) {
      throw new Error(`Circular profile extension detected: ${name}`);
    }
    resolving.add(name);

    // Get base - either the extends target or the 'excursion' built-in fallback
    let base: ResolvedProfileConfig;
    if (partial.extends) {
      base = resolve(partial.extends);
    } else if (builtins[name]) {
      base = builtins[name];
    } else {
      base = builtins['excursion']; // fallback for custom profiles with no extends
    }

    // Shallow merge per-agent
    const mergedAgents: Partial<Record<AgentRole, AgentProfileConfig>> = { ...base.agents };
    if (partial.agents) {
      for (const [role, agentConfig] of Object.entries(partial.agents)) {
        const baseAgent = mergedAgents[role as AgentRole];
        mergedAgents[role as AgentRole] = baseAgent
          ? { ...baseAgent, ...agentConfig }
          : agentConfig;
      }
    }

    // Shallow merge review
    const mergedReview: ReviewProfileConfig = {
      ...base.review,
      ...(partial.review ?? {}),
    } as ReviewProfileConfig;

    const result: ResolvedProfileConfig = {
      description: partial.description ?? base.description,
      compile: partial.compile ?? base.compile,
      build: partial.build ?? base.build,
      agents: mergedAgents,
      review: mergedReview,
    };

    resolving.delete(name);
    resolved.set(name, result);
    return result;
  }

  // Resolve all profiles (builtins + user-defined)
  const allNames = new Set([...Object.keys(builtins), ...Object.keys(partials)]);
  const result: Record<string, ResolvedProfileConfig> = {};
  for (const name of allNames) {
    result[name] = resolve(name);
  }
  return result;
}
```

### Profile Parsing in `parseRawConfig()`

Add a `profiles` section parser that validates each profile entry:
- `description`: string (optional in partial)
- `extends`: string (optional)
- `compile`: string[] (optional)
- `build`: string[] (optional)
- `agents`: object with agent role keys, each with optional `maxTurns`, `prompt`, `tools`, `model`
- `review`: object with optional `strategy`, `perspectives`, `maxRounds`, `autoAcceptBelow`, `evaluatorStrictness`

Invalid entries are silently dropped (matching the existing pattern for hooks, plugins, etc.).

### Merge Chain Update

`mergePartialConfigs()` gets a new block for profiles - merge by name, shallow-merge within each profile's fields:

```typescript
if (global.profiles || project.profiles) {
  const merged: Record<string, PartialProfileConfig> = {};
  const allNames = new Set([
    ...Object.keys(global.profiles ?? {}),
    ...Object.keys(project.profiles ?? {}),
  ]);
  for (const name of allNames) {
    const g = global.profiles?.[name];
    const p = project.profiles?.[name];
    if (g && p) {
      // Shallow merge per profile, with agents merged per-agent
      const mergedAgents: Partial<Record<AgentRole, AgentProfileConfig>> = {
        ...g.agents,
      };
      if (p.agents) {
        for (const [role, config] of Object.entries(p.agents)) {
          const base = mergedAgents[role as AgentRole];
          mergedAgents[role as AgentRole] = base ? { ...base, ...config } : config;
        }
      }
      merged[name] = {
        ...g,
        ...p,
        agents: Object.keys(mergedAgents).length > 0 ? mergedAgents : undefined,
        review: g.review || p.review ? { ...g.review, ...p.review } : undefined,
      };
    } else {
      merged[name] = (p ?? g)!;
    }
  }
  result.profiles = merged;
}
```

### `resolveConfig()` Update

After merging file config, call `resolveProfileExtensions()` on the merged profiles:

```typescript
profiles: Object.freeze(
  resolveProfileExtensions(merged.profiles ?? {}, BUILTIN_PROFILES)
),
```

### `parseProfilesFile()` Export

```typescript
export async function parseProfilesFile(
  filePath: string,
): Promise<Record<string, PartialProfileConfig>> {
  const raw = await readFile(filePath, 'utf-8');
  const data = parseYaml(raw);
  if (!data || typeof data !== 'object') return {};
  const parsed = parseRawConfig(data as Record<string, unknown>);
  return parsed.profiles ?? {};
}
```

### XML Parser (`src/engine/agents/common.ts`)

```typescript
export interface ProfileSelection {
  profileName: string;
  rationale: string;
}

export function parseProfileBlock(text: string): ProfileSelection | null {
  const match = text.match(/<profile\s+name="([^"]+)">([\s\S]*?)<\/profile>/);
  if (!match) return null;
  const profileName = match[1].trim();
  const rationale = match[2].trim();
  if (!profileName || !rationale) return null;
  return { profileName, rationale };
}
```

### `loadPrompt()` Update (`src/engine/prompts.ts`)

```typescript
export async function loadPrompt(
  name: string,
  vars?: Record<string, string>,
): Promise<string> {
  // Path-like values load from the filesystem directly
  const isPath = name.includes('/');
  const filename = isPath ? name : (name.endsWith('.md') ? name : `${name}.md`);

  let content: string;
  if (isPath) {
    // Path-based prompts bypass cache (different files could share a basename)
    content = await readFile(resolve(filename), 'utf-8');
  } else {
    const cached = cache.get(filename);
    if (cached !== undefined) {
      content = cached;
    } else {
      const filePath = resolve(PROMPTS_DIR, filename);
      content = await readFile(filePath, 'utf-8');
      cache.set(filename, content);
    }
  }

  if (vars) {
    content = content.replace(/\{\{(\w+)\}\}/g, (match, key) => vars[key] ?? match);
  }

  return content;
}
```

### Event Type (`src/engine/events.ts`)

Add to the `EforgeEvent` union, in the Planning section after `plan:scope`:

```typescript
| { type: 'plan:profile'; profileName: string; rationale: string }
```

### Backend Interface (`src/engine/backend.ts`)

Add `model` to `AgentRunOptions`:

```typescript
export interface AgentRunOptions {
  prompt: string;
  cwd: string;
  maxTurns: number;
  tools: ToolPreset;
  model?: string;
  abortSignal?: AbortSignal;
}
```

## Testing Strategy

### Unit Tests

All tests go in `test/config-profiles.test.ts` (new file, focused on profile logic):

**Extension resolution (`resolveProfileExtensions`)**:
- Resolves a profile that extends a built-in (e.g., `migration` extends `errand`) - result inherits `errand` compile/build stages
- Resolves a chain: A extends B extends C - all fields cascade
- Detects circular extension (A extends B, B extends A) and throws `Error` with message containing "Circular"
- Self-referencing extension (A extends A) throws `Error`
- Profile extending non-existent profile throws `Error` with message containing "not found"
- Custom profile with no `extends` falls back to `excursion` built-in defaults for missing fields
- Built-in override: user defines `errand` with `build: ['implement']` - result has overridden build but inherits compile from built-in
- Agent config merges per-agent: base has `builder.maxTurns: 50`, child has `builder.prompt: 'custom'` - result has both
- Review config shallow-merges: base has `strategy: 'auto'`, child has `maxRounds: 2` - result has both

**Profile parsing (`parseRawConfig` with profiles section)**:
- Valid profile with all fields parses into `PartialProfileConfig`
- Profile with invalid `strategy` value (not `auto|single|parallel`) drops the field
- Profile with non-string `description` drops the field
- Profile with `agents` containing invalid agent role keys drops those entries
- Profile with `agents.builder.maxTurns` as non-positive number drops it
- `tools` value not `coding` or `none` drops the field
- `evaluatorStrictness` not `strict|standard|lenient` drops the field
- Empty profiles section results in empty record (not undefined)

**Profile merging (`mergePartialConfigs` with profiles)**:
- Disjoint profile names from global and project both appear in result
- Same profile name: project fields override global scalars (`description`, `extends`, `compile`, `build`)
- Same profile name: agents merge per-agent (global's `reviewer` config survives when project only sets `builder`)
- Same profile name: review fields merge shallowly
- Only global has profiles - they survive
- Only project has profiles - they survive

**`resolveConfig` integration with profiles**:
- Empty config resolves with all three built-in profiles present
- Config with custom profile resolves extensions and includes built-ins
- Resolved profiles in returned config are frozen (Object.isFrozen)

**`parseProfilesFile`** (tested with fixture):
- Parses a valid YAML file with profiles section into `Record<string, PartialProfileConfig>`
- Returns empty record for file with no profiles section
- Returns empty record for invalid YAML

Add to `test/xml-parsers.test.ts` (existing file):

**`parseProfileBlock`**:
- Parses `<profile name="excursion">Rationale text</profile>` into `{ profileName: 'excursion', rationale: 'Rationale text' }`
- Returns `null` for text with no `<profile>` block
- Returns `null` for `<profile>` with empty name attribute
- Returns `null` for `<profile>` with empty body
- Handles multiline rationale text

Add to existing `test/config.test.ts` or in the new file:

**`loadPrompt` path support**:
- Name without `/` loads from built-in prompts dir (existing behavior preserved)
- Name containing `/` loads from that path directly
- Path-based load does not pollute the cache

## Verification

- [ ] `pnpm type-check` passes with zero errors after all type additions
- [ ] `pnpm test` passes - all existing tests remain green, all new tests pass
- [ ] `resolveProfileExtensions` with no user profiles returns exactly the three built-in profiles (`errand`, `excursion`, `expedition`)
- [ ] `resolveProfileExtensions` throws an `Error` containing "Circular" when profile A extends B and B extends A
- [ ] `resolveProfileExtensions` throws an `Error` containing "not found" when a profile extends a non-existent name
- [ ] `resolveConfig({}, {}).profiles` contains all three built-in profiles with identical values to `BUILTIN_PROFILES`
- [ ] A profile extending `errand` with `build: ['implement', 'validate']` resolves with errand's compile stages and the overridden build stages
- [ ] Agent config merging: parent has `builder: { maxTurns: 50 }`, child has `builder: { prompt: 'custom' }` - resolved builder has both `maxTurns: 50` and `prompt: 'custom'`
- [ ] `mergePartialConfigs` with profiles from both global and project merges by name, with project overriding global for same-name profiles
- [ ] `parseProfileBlock('<profile name="errand">Simple change</profile>')` returns `{ profileName: 'errand', rationale: 'Simple change' }`
- [ ] `parseProfileBlock('no xml here')` returns `null`
- [ ] `loadPrompt('planner')` loads from built-in prompts dir; `loadPrompt('/tmp/custom/prompt.md')` loads from that absolute path
- [ ] `EforgeEvent` union accepts `{ type: 'plan:profile', profileName: 'errand', rationale: 'test' }` without type errors
- [ ] `AgentRunOptions` accepts `{ prompt: '...', cwd: '.', maxTurns: 10, tools: 'coding', model: 'claude-sonnet' }` without type errors
- [ ] `plan:scope` event type still exists and compiles - no backwards-incompatible removal
- [ ] New types (`ResolvedProfileConfig`, `AgentProfileConfig`, `ReviewProfileConfig`, `PartialProfileConfig`, `ProfileConfig`) are re-exported from `src/engine/index.ts`
- [ ] `parseProfilesFile` is re-exported from `src/engine/index.ts`
- [ ] `parseProfileBlock` is re-exported from `src/engine/index.ts`
