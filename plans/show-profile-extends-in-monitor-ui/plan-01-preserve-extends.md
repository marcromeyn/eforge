---
id: plan-01-preserve-extends
name: Preserve extends field through profile resolution and show in monitor UI
dependsOn: []
branch: show-profile-extends-in-monitor-ui/preserve-extends
---

# Preserve extends field through profile resolution and show in monitor UI

## Architecture Context

Custom workflow profiles extend built-in tiers (errand, excursion, expedition) or other custom profiles via the `extends` field in `partialProfileConfigSchema`. During resolution in `resolveProfileExtensions()`, this field is consumed to find the base profile but discarded from the output `ResolvedProfileConfig`. The monitor UI renders profile info via `ProfileHeader` but has no way to show lineage since the resolved config lacks `extends`.

## Implementation

### Overview

Thread `extends` through from partial config to resolved config to monitor UI types to rendered output. Three files, four small edits.

### Key Decisions

1. `extends` is optional on `ResolvedProfileConfig` - built-in profiles (returned as-is from `builtins[name]`) naturally have no `extends`, and that's the correct behavior. Only custom profiles that override or extend a base carry the field.
2. For custom profiles with no explicit `extends` that fall through to the excursion fallback, set `extends: 'excursion'` to make the implicit default visible in the UI.
3. The UI uses `getTierColor()` on the extends value to color the base profile name, which already handles unknown names via `DEFAULT_TIER` fallback.

## Scope

### In Scope
- Adding optional `extends` field to `resolvedProfileConfigSchema`
- Setting `extends` during `resolveProfileExtensions()` for custom profiles
- Adding `extends` to the monitor UI `ProfileConfig` interface
- Rendering the extends label in `ProfileHeader`

### Out of Scope
- Changing how `extends` is resolved (the resolution logic stays the same)
- Multi-level extends chain display (just the immediate parent)

## Files

### Modify
- `src/engine/config.ts` — Add optional `extends` field to `resolvedProfileConfigSchema` (line 60-66). Set `extends` on the result object in `resolveProfileExtensions()` (line 553-559).
- `src/monitor/ui/src/lib/types.ts` — Add optional `extends` field to `ProfileConfig` interface (line 65-71).
- `src/monitor/ui/src/components/pipeline/thread-pipeline.tsx` — Add extends label after the profile badge in `ProfileHeader` (line 232-246).

## Verification

- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` exits with code 0 (existing profile resolution tests pass without modification)
- [ ] `pnpm build` exits with code 0
- [ ] `resolvedProfileConfigSchema` includes an optional `extends` field of type `string`
- [ ] A custom profile with `extends: "errand"` in user config produces a `ResolvedProfileConfig` where `extends === "errand"`
- [ ] A custom profile with no explicit `extends` and no matching built-in produces a `ResolvedProfileConfig` where `extends === "excursion"`
- [ ] A built-in profile (e.g. `errand`) resolved without a user partial has no `extends` field (undefined)
- [ ] `ProfileHeader` renders an "extends {name}" label when `profileInfo.config.extends` is present
- [ ] `ProfileHeader` renders no extends label when `profileInfo.config.extends` is absent
