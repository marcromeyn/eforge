---
id: plan-01-config-zod-validation
name: Replace Hand-Rolled Config Validation with Zod v4 Schemas
depends_on: []
branch: config-zod-prd/config-zod-validation
---

# Replace Hand-Rolled Config Validation with Zod v4 Schemas

## Architecture Context

`src/engine/config.ts` owns all config parsing, validation, merging, and type definitions. Two hand-rolled validation functions - `parseRawConfig()` (~165 LOC) and `validateProfileConfig()` (~65 LOC) - manually check every field with imperative if/typeof guards. They use different error-handling strategies (silent fallthrough vs error collection), duplicate enum constants that already exist at the type level, and have drifted out of sync (e.g. `merge-conflict-resolver` is in `VALID_AGENT_ROLES_SET` but missing from the inline set in `parseRawConfig`).

Zod v4 schemas replace both functions, deriving TypeScript types from schemas so they can't drift, and producing structured error messages via `z.prettifyError()`.

## Implementation

### Overview

1. Add `zod` (v4) as a runtime dependency
2. Define zod schemas mirroring all existing config types in `config.ts`
3. Replace `parseRawConfig()` with schema-based parsing
4. Replace `validateProfileConfig()` with schema-based validation
5. Derive TypeScript types from schemas, eliminating the manual `PartialEforgeConfig` mapped type
6. Simplify `resolveGeneratedProfile()` to leverage schema validation
7. Remove now-redundant enum sets (`VALID_AGENT_ROLES_SET`, `VALID_STRATEGIES_SET`, `VALID_STRICTNESS_SET`, `VALID_AUTO_ACCEPT_SET`)

### Key Decisions

1. **Schemas define types, not the other way around.** `EforgeConfig`, `PartialEforgeConfig`, `ResolvedProfileConfig`, etc. become `z.output<>` / `z.input<>` derivations. This is the core benefit - types and validation can't drift.

2. **`parseRawConfig` uses `.safeParse()` with partial schema.** The current function silently drops invalid fields to defaults. The new version uses `eforgeConfigSchema.partial().safeParse(raw)` - on failure, it logs a warning via `console.error` with `z.prettifyError()` and returns the successfully parsed subset (or empty object). This is strictly better: users get feedback on typos/invalid values instead of silent fallthrough.

3. **`validateProfileConfig` becomes `resolvedProfileSchema.safeParse()`.** The return type stays `{ valid: boolean; errors: string[] }` for backward compatibility with callers in `planner.ts` and `dynamic-profile-generation.test.ts`. Errors are extracted from `z.flattenError()`.

4. **Stage-name validation stays runtime.** `validateProfileConfig` accepts optional `compileStageNames` and `buildStageNames` sets - these are runtime-only (stage registries aren't known at schema-definition time). The schema validates structure; stage-name checks remain as a post-schema `.refine()` or manual check after parsing.

5. **`AGENT_ROLES` constant derived from `AgentRole` type.** Define a single `const AGENT_ROLES = [...] as const` array that both the zod enum and the `AgentRole` type derive from. This eliminates the two divergent sets currently in config.ts. The `AgentRole` type in `events.ts` must be kept as-is (it's the source of truth used across the codebase), so the constant in config.ts will mirror it and be used for the zod enum.

6. **Merge logic (`mergePartialConfigs`, `resolveProfileExtensions`) unchanged.** These implement business rules (shallow merge, concatenation, graph traversal) that zod doesn't handle. They operate on already-validated partial configs.

7. **`resolveGeneratedProfile()` simplified.** The full-config path can validate via `resolvedProfileSchema.safeParse()` instead of relying on callers to validate after resolution.

8. **`DEFAULT_CONFIG` and `BUILTIN_PROFILES` stay as-is.** They're frozen objects used for runtime defaults and merge bases. The schemas define defaults for *parsing* (what happens when a field is absent in YAML), while these constants define defaults for *resolution* (what happens after merge). Different concerns.

9. **Use `z.partialRecord()` for agent config maps.** Since not every agent role needs config in a given profile, `z.record()` with enum keys (which is exhaustive in v4) would be wrong. `z.partialRecord(keySchema, valueSchema)` allows sparse records.

## Scope

### In Scope
- Add `zod` v4 dependency to `package.json`
- Define zod schemas for all config types in `config.ts`
- Replace `parseRawConfig()` with schema-based parsing
- Replace `validateProfileConfig()` with schema-based validation
- Derive TypeScript types from zod schemas
- Remove redundant enum constants (`VALID_AGENT_ROLES_SET`, `VALID_STRATEGIES_SET`, `VALID_STRICTNESS_SET`, `VALID_AUTO_ACCEPT_SET`, inline `VALID_AGENT_ROLES` in `parseRawConfig`, inline `VALID_STRATEGIES`/`VALID_TOOLS`/`VALID_STRICTNESS`/`VALID_AUTO_ACCEPT` in `parseRawConfig`)
- Add test cases for invalid config producing error messages
- Fix the `merge-conflict-resolver` drift between the two agent role sets

### Out of Scope
- Changing `mergePartialConfigs` logic
- Changing `resolveProfileExtensions` logic
- Changing `resolveConfig` logic (env var overrides)
- Changing config file locations or loading order
- Changing CLI config override behavior
- Modifying the `AgentRole` type in `events.ts`
- Adding new config fields

## Files

### Modify
- `package.json` — Add `zod` (v4) as a runtime dependency
- `src/engine/config.ts` — Replace `parseRawConfig()` and `validateProfileConfig()` with zod schemas. Define schemas, derive types, remove redundant enum sets. Simplify `resolveGeneratedProfile()`.
- `test/config.test.ts` — Add test cases for invalid config producing error messages (currently silent). Ensure existing tests pass with derived types.
- `test/dynamic-profile-generation.test.ts` — Verify `validateProfileConfig` tests pass with schema-backed implementation. Error message assertions may need adjusting if the exact strings change (tests currently use `.includes()` substring checks, which should be stable).

## Verification

- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` exits with code 0 (all 3 config test files pass)
- [ ] `pnpm build` exits with code 0
- [ ] `parseRawConfig` with `{ agents: { maxTurns: "not-a-number" } }` logs a warning to stderr containing "maxTurns" (previously silent)
- [ ] `parseRawConfig` with `{ agents: { permissionMode: "skip" } }` logs a warning containing "permissionMode" (previously silent)
- [ ] `validateProfileConfig` with empty description returns `{ valid: false }` with errors array containing a string that includes "description"
- [ ] `validateProfileConfig` with invalid strategy returns `{ valid: false }` with errors array containing a string that includes "strategy"
- [ ] `validateProfileConfig` accepts all three built-in profiles as valid
- [ ] `resolveConfig({}, {})` returns an object structurally equal to the current `DEFAULT_CONFIG` output (same field values, same nesting)
- [ ] The `PartialEforgeConfig` type no longer uses a manual conditional mapped type - it is derived from `z.input<typeof eforgeConfigSchema>`
- [ ] No duplicate enum constant sets remain in config.ts - agent roles, strategies, strictness values each have a single source (the zod schema)
- [ ] `merge-conflict-resolver` is recognized as a valid agent role in both parsing and validation paths
