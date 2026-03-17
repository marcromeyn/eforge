# Config Validation with Zod

Replace the hand-rolled config parsing in `config.ts` with zod v4 schemas. The current ~230 LOC of manual field validation across two functions (`parseRawConfig` and `validateProfileConfig`) is correct but verbose, produces poor error messages, and drifts out of sync as config fields are added.

**Important: Use zod v4 (4.x), not v3.** Install with `pnpm add zod` (latest is v4). The design examples below use v4 API conventions.

## Problem

Config validation in `src/engine/config.ts` is spread across two hand-rolled validation functions:

**`parseRawConfig()`** (~165 LOC) validates the top-level config from YAML:
```typescript
if (typeof raw.langfuse?.enabled === 'boolean') { ... }
if (raw.agents?.maxTurns !== undefined) {
  const val = Number(raw.agents.maxTurns);
  if (!isNaN(val) && val > 0) { ... }
}
if (raw.agents?.permissionMode !== undefined) {
  if (['bypass', 'default'].includes(raw.agents.permissionMode)) { ... }
}
// ... ~165 more lines
```

**`validateProfileConfig()`** (~65 LOC, added with dynamic profile generation) validates agent-generated profiles:
```typescript
if (!config.description || typeof config.description !== 'string') errors.push(...)
if (!Array.isArray(config.compile) || config.compile.length === 0) errors.push(...)
if (config.review?.strategy && !VALID_STRATEGIES_SET.has(config.review.strategy)) errors.push(...)
```

Issues:
- Adding a new config field requires writing validation logic, updating the type, and updating defaults in three separate places
- `parseRawConfig` silently falls through to defaults on invalid values with no user feedback; `validateProfileConfig` collects errors but uses a separate pattern
- Enum validation is stringly-typed - `VALID_STRATEGIES_SET`, `VALID_STRICTNESS_SET`, `VALID_AGENT_ROLES_SET` partially duplicate constants already used in `parseRawConfig`
- Two validation functions that check overlapping concerns (profile fields validated in both places) with different error handling styles

## Design

### Zod v4 Schemas Replace Manual Parsing

Define zod v4 schemas that mirror the existing TypeScript types. The schemas handle parsing, validation, defaults, and error messages in one declaration:

```typescript
import { z } from 'zod';

const agentProfileSchema = z.object({
  maxTurns: z.number().positive().optional(),
  prompt: z.string().optional(),
  tools: z.enum(['coding', 'none']).optional(),
  model: z.string().optional(),
});

const reviewProfileSchema = z.object({
  strategy: z.enum(['auto', 'single', 'parallel']).default('auto'),
  perspectives: z.array(z.string()).default(['code']),
  maxRounds: z.number().positive().default(1),
  autoAcceptBelow: z.enum(['suggestion', 'warning']).optional(),
  evaluatorStrictness: z.enum(['strict', 'standard', 'lenient']).default('standard'),
});

const partialProfileSchema = z.object({
  description: z.string().optional(),
  extends: z.string().optional(),
  compile: z.array(z.string()).optional(),
  build: z.array(z.string()).optional(),
  // v4: z.record with enum keys is exhaustive — use z.partialRecord since
  // not every agent role needs config in a given profile
  agents: z.partialRecord(z.enum([...AGENT_ROLES]), agentProfileSchema).optional(),
  review: reviewProfileSchema.partial().optional(),
});

const eforgeConfigSchema = z.object({
  langfuse: z.object({
    enabled: z.boolean().default(false),
    publicKey: z.string().optional(),
    secretKey: z.string().optional(),
    host: z.string().default('https://cloud.langfuse.com'),
  }).default({}),
  agents: z.object({
    maxTurns: z.number().positive().default(30),
    permissionMode: z.enum(['bypass', 'default']).default('bypass'),
    settingSources: z.array(z.string()).optional(),
  }).default({}),
  build: z.object({
    parallelism: z.number().positive().default(availableParallelism()),
    worktreeDir: z.string().optional(),
    postMergeCommands: z.array(z.string()).optional(),
    maxValidationRetries: z.number().nonnegative().default(2),
    cleanupPlanFiles: z.boolean().default(false),
  }).default({}),
  plan: z.object({
    outputDir: z.string().default('plans'),
  }).default({}),
  plugins: z.object({
    enabled: z.boolean().default(true),
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
    paths: z.array(z.string()).optional(),
  }).default({}),
  hooks: z.array(z.object({
    event: z.string(),
    command: z.string(),
    timeout: z.number().default(5000),
  })).default([]),
  // v4: z.record requires two args (key schema, value schema)
  profiles: z.record(z.string(), partialProfileSchema).default({}),
});
```

### Zod v4 API Notes

Key v4 differences from v3 that affect this implementation:

- **`z.record()` requires two args** — `z.record(valueSchema)` is gone; always provide key and value schemas
- **`z.partialRecord()`** — use for enum-keyed records where not all keys are required (like agent config per role). `z.record()` with enum keys is exhaustive in v4
- **Error formatting** — use `z.prettifyError(error)` for human-readable output or `z.flattenError(error)` for structured access. The old `.format()` and `.flatten()` methods on `ZodError` are deprecated
- **Custom error messages** — use `{ error: "..." }` instead of `{ message: "..." }`
- **Defaults in optional object fields apply** — `z.object({ x: z.string().default("foo").optional() }).parse({})` returns `{ x: "foo" }` in v4 (returned `{}` in v3). This is desirable for config defaults.

### TypeScript Types Derived from Schemas

Instead of maintaining types and schemas separately:

```typescript
export type PartialEforgeConfig = z.input<typeof eforgeConfigSchema>;
export type EforgeConfig = z.output<typeof eforgeConfigSchema>;
export type PartialProfileConfig = z.input<typeof partialProfileSchema>;
```

This eliminates the `PartialEforgeConfig` type alias with its manual conditional mapped type.

### `parseRawConfig` Becomes a One-Liner

```typescript
function parseRawConfig(raw: unknown): PartialEforgeConfig {
  return eforgeConfigSchema.partial().parse(raw);
}
```

With zod v4's `z.prettifyError()`, invalid config produces clear messages:

```typescript
const result = eforgeConfigSchema.partial().safeParse(raw);
if (!result.success) {
  console.error('Invalid eforge config:\n' + z.prettifyError(result.error));
}
```

```
Invalid eforge config:
  agents.maxTurns: Expected number, received string
  agents.permissionMode: Invalid enum value. Expected 'bypass' | 'default', received 'skip'
```

### Merge Logic Stays

The config merge function (`mergeConfigs`) stays as-is - its merge strategy (shallow merge for objects, concatenate for hooks, replace for arrays) is business logic that zod doesn't handle. The merge operates on already-validated `PartialEforgeConfig` objects.

Profile extension resolution also stays - it's graph traversal logic, not validation. But it benefits from zod because the resolved profile is validated against `resolvedProfileSchema` after extension, catching misconfigurations that the current code silently accepts.

`validateProfileConfig()` and `resolveGeneratedProfile()` (used by the dynamic profile generation feature) both collapse into schema validation - `validateProfileConfig` becomes `resolvedProfileSchema.safeParse()`, and `resolveGeneratedProfile` uses the same schema after applying extends/overrides.

## Implementation

### Files to modify

- **`package.json`**: Add `zod` (v4) as a dependency (`pnpm add zod`)
- **`src/engine/config.ts`**: Replace `parseRawConfig()` (~165 LOC) and `validateProfileConfig()` (~65 LOC) with zod schemas. Derive types from schemas. Simplify `resolveGeneratedProfile()` to use schema validation. Keep `mergeConfigs()`, `resolveProfileExtensions()`, `loadConfig()`, and related functions.
- **`tsup.config.ts`**: No changes needed - zod is a pure JS library, bundles fine

### What stays the same

- `EforgeConfig` shape (fields, nesting, defaults) - identical behavior
- Config merge strategy - unchanged
- Profile extension resolution - unchanged
- Config file locations and loading order - unchanged
- CLI config overrides - unchanged

### What improves

- Error messages on invalid config (currently silent in `parseRawConfig`, inconsistent in `validateProfileConfig`, now uniformly descriptive)
- Type safety (types derived from schemas, can't drift)
- ~150 fewer lines in config.ts (both `parseRawConfig` and `validateProfileConfig` collapse into schemas)
- Enum sets (`VALID_STRATEGIES_SET`, `VALID_STRICTNESS_SET`, `VALID_AGENT_ROLES_SET`) eliminated - zod enums are the single source
- Adding new config fields requires only schema changes (types auto-derive)

## Verification

- `pnpm test` passes (existing config tests in `config.test.ts`, `config-profiles.test.ts`, and `dynamic-profile-generation.test.ts`)
- `pnpm type-check` passes
- Invalid config produces clear error messages (add test cases for bad values)
- Valid config produces identical `EforgeConfig` objects to the current implementation (snapshot comparison)
- Profile extension chains resolve identically
- `validateProfileConfig` test cases from `dynamic-profile-generation.test.ts` still pass (same behavior, schema-backed)
- `eforge run` with default config works unchanged
- `eforge run` with custom `eforge.yaml` works unchanged
- `eforge run --generate-profile` works unchanged
