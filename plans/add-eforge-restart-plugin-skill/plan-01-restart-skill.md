---
id: plan-01-restart-skill
name: Add eforge restart plugin skill
dependsOn: []
branch: add-eforge-restart-plugin-skill/restart-skill
---

# Add eforge restart plugin skill

## Architecture Context

The eforge Claude Code plugin (`eforge-plugin/`) exposes skills as markdown files registered in `plugin.json`. Each skill follows a declarative workflow pattern with `disable-model-invocation: true` frontmatter. The existing `/eforge:update` skill already implements the build-guard pattern (check `mcp__eforge__eforge_status` before restarting the daemon) - the new `/eforge:restart` skill reuses that same pattern but skips version checking and npm update steps.

## Implementation

### Overview

Create a new `/eforge:restart` skill that safely restarts the eforge daemon from any project. The skill checks for active builds via the MCP status tool, aborts if builds are running, and otherwise stops/starts the daemon and reports the result.

### Key Decisions

1. Follow the exact same build-guard pattern as `/eforge:update` Step 5 - check `mcp__eforge__eforge_status` for `status: 'running'` before stopping the daemon. This ensures consistency across skills.
2. Use `disable-model-invocation: true` frontmatter consistent with all other eforge plugin skills.
3. The skill does NOT rebuild the binary - it assumes `pnpm build` was already run in the eforge repo. This makes it safe to invoke from any project.

## Scope

### In Scope
- New `eforge-plugin/skills/restart/restart.md` skill file
- Registration in `eforge-plugin/.claude-plugin/plugin.json` commands array
- Version bump to `0.5.6` in plugin.json

### Out of Scope
- Rebuilding the eforge binary
- Changes to the existing project-local `/eforge-daemon-restart` skill
- Changes to other existing plugin skills

## Files

### Create
- `eforge-plugin/skills/restart/restart.md` - New restart skill following the same declarative workflow pattern as existing skills

### Modify
- `eforge-plugin/.claude-plugin/plugin.json` - Add `"./skills/restart/restart.md"` to `commands` array and bump version to `0.5.6`

## Verification

- [ ] `eforge-plugin/skills/restart/restart.md` exists with `disable-model-invocation: true` frontmatter and `description` field
- [ ] The skill workflow includes a step calling `mcp__eforge__eforge_status` before stopping the daemon
- [ ] The skill aborts with a builds-in-progress warning when status is `'running'`
- [ ] The skill runs `eforge daemon stop` then `eforge daemon start` when no builds are active
- [ ] The skill reports the daemon port/PID after restart
- [ ] `eforge-plugin/.claude-plugin/plugin.json` version is `"0.5.6"`
- [ ] `eforge-plugin/.claude-plugin/plugin.json` commands array contains `"./skills/restart/restart.md"`
- [ ] `plugin.json` is valid JSON after modifications
