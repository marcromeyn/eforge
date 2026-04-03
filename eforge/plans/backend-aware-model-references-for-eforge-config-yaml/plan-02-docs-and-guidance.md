---
id: plan-02-docs-and-guidance
name: Documentation and Integration Package Updates
depends_on: [plan-01-engine-model-ref]
branch: backend-aware-model-references-for-eforge-config-yaml/docs-and-guidance
---

# Documentation and Integration Package Updates

## Architecture Context

After plan-01 lands the engine changes, all documentation and integration package guidance must be updated to teach the new object-shaped model refs. This includes engine docs, the Claude Code plugin skills, the Pi package skills/extension, and MCP proxy init text. All four documentation surfaces must be consistent so users do not receive conflicting guidance.

The new config contract:
- Claude SDK model refs: `{ id: "model-name" }`
- Pi model refs: `{ provider: "provider-name", id: "model-name" }`
- `pi.provider` no longer exists
- String model refs are no longer valid

## Implementation

### Overview

Update all user-facing documentation and config guidance to reflect the new `ModelRef` object shape. Remove all references to `pi.provider` as a config field. Ensure Claude plugin and Pi package teach identical config semantics.

### Key Decisions

1. **Update all four documentation surfaces together** - `docs/config.md`, `README.md`, `eforge-plugin/` skills, and `pi-package/` skills must all teach the same config shape.

2. **Bump plugin version** - `eforge-plugin/.claude-plugin/plugin.json` version incremented since skill docs change.

3. **Pi package version unchanged** - Per project conventions, `pi-package/package.json` is not bumped.

4. **MCP proxy and Pi extension init flows** - Update generated config examples in `src/cli/mcp-proxy.ts` and `pi-package/extensions/eforge/index.ts` if they contain model config examples or `pi.provider` references.

## Scope

### In Scope
- Rewrite model config examples in `docs/config.md` to use object refs
- Update `README.md` if it contains model config examples
- Update `eforge-plugin/skills/config/config.md` model guidance
- Update `eforge-plugin/skills/init/init.md` model guidance
- Update `pi-package/skills/eforge-config/SKILL.md` model guidance
- Update `pi-package/skills/eforge-init/SKILL.md` model guidance
- Update `pi-package/extensions/eforge/index.ts` if it generates config with model strings or `pi.provider`
- Update `src/cli/mcp-proxy.ts` if it generates config with model strings or `pi.provider`
- Bump `eforge-plugin/.claude-plugin/plugin.json` version
- Remove all references to `pi.provider` from docs and guidance
- Add migration note explaining old string model refs are obsolete

### Out of Scope
- Engine source code changes (completed in plan-01)
- Test changes (completed in plan-01)
- Changing event schemas or monitor UX

## Files

### Modify
- `docs/config.md` - Rewrite the model classes section (lines 83-105) to show object-shaped model refs. Rewrite Pi config section (lines 69-81) to remove `pi.provider` and show `{ provider, id }` model refs. Update all YAML examples. Add migration note.
- `README.md` - Update any model config examples to use object refs. If no model config examples exist, no changes needed.
- `eforge-plugin/skills/config/config.md` - Update model class mapping guidance to show object refs (`{ id }` for Claude SDK, `{ provider, id }` for Pi). Remove any mention of `pi.provider`. Update Pi-specific notes.
- `eforge-plugin/skills/init/init.md` - Update init interview guidance to generate object-shaped model refs. Remove `pi.provider` from init flow.
- `eforge-plugin/.claude-plugin/plugin.json` - Bump version from `0.5.18` to `0.5.19`.
- `pi-package/skills/eforge-config/SKILL.md` - Update model config guidance to show `{ provider, id }` refs. Remove `pi.provider` references.
- `pi-package/skills/eforge-init/SKILL.md` - Update init guidance for Pi users. Remove `pi.provider` from init flow.
- `pi-package/extensions/eforge/index.ts` - Update `eforge_init` tool if it generates config containing `pi.provider` or string model refs.
- `src/cli/mcp-proxy.ts` - Update `eforge_init` tool if it generates config containing `pi.provider` or string model refs. Update any validation hints or generated starter config comments.

## Verification

- [ ] `docs/config.md` contains zero occurrences of `pi.provider` or `pi:\n  provider:`
- [ ] `docs/config.md` model config examples use `{ id: ... }` for Claude SDK and `{ provider: ..., id: ... }` for Pi
- [ ] `eforge-plugin/skills/config/config.md` contains zero occurrences of `pi.provider`
- [ ] `eforge-plugin/skills/init/init.md` contains zero occurrences of `pi.provider`
- [ ] `pi-package/skills/eforge-config/SKILL.md` contains zero occurrences of `pi.provider`
- [ ] `pi-package/skills/eforge-init/SKILL.md` contains zero occurrences of `pi.provider`
- [ ] `eforge-plugin/.claude-plugin/plugin.json` version is `0.5.19` or higher
- [ ] No file in `docs/`, `eforge-plugin/skills/`, or `pi-package/skills/` contains a YAML example with `model: "some-string"` (bare string model refs)
- [ ] `pi-package/extensions/eforge/index.ts` does not generate config with `pi.provider` or string model refs
- [ ] `src/cli/mcp-proxy.ts` does not generate config with `pi.provider` or string model refs
- [ ] `pnpm build` succeeds (catches any broken imports in MCP proxy or Pi extension)
