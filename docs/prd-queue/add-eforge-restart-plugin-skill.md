---
title: Add `/eforge:restart` Plugin Skill
created: 2026-03-26
status: pending
---



# Add `/eforge:restart` Plugin Skill

## Problem / Motivation

After local eforge builds land and `pnpm build` runs, daemons running in other projects still execute the old binary. A project-local `/eforge-daemon-restart` skill exists in `.claude/skills/`, but it assumes you're in the eforge repo (it runs `pnpm build`). There is no way to restart the daemon from other projects without manually running commands. A plugin-level skill would be available in all projects and only needs to restart the daemon, since the binary is already updated.

## Goal

Provide a universal `/eforge:restart` skill at the plugin level that safely restarts the eforge daemon in any project, ensuring the daemon picks up the latest built binary.

## Approach

1. **Create `eforge-plugin/skills/restart/restart.md`** with the following workflow:
   1. Check for active builds via `mcp__eforge__eforge_status` (same guard pattern as the update skill Step 5).
   2. If builds are running, abort with message: "Builds are in progress. Wait until all builds complete, then re-run `/eforge:restart`."
   3. Run `eforge daemon stop`.
   4. Run `eforge daemon start`.
   5. Report the new port/PID and confirm the daemon is running fresh code.

2. **Register the skill in `eforge-plugin/.claude-plugin/plugin.json`** by adding `"./skills/restart/restart.md"` to the `commands` array and bumping the version to `0.5.6`.

### Files to create/modify

| File | Change |
|------|--------|
| `eforge-plugin/skills/restart/restart.md` | New skill file |
| `eforge-plugin/.claude-plugin/plugin.json` | Add command + version bump to `0.5.6` |

## Scope

**In scope:**
- New `/eforge:restart` plugin-level skill
- Active build guard check before restarting
- Plugin registration and version bump

**Out of scope:**
- Rebuilding the binary (assumes `pnpm build` has already been run in the eforge repo)
- Changes to the existing project-local `/eforge-daemon-restart` skill

## Acceptance Criteria

- `/reload-plugins` picks up the new skill.
- Invoking `/eforge:restart` when no builds are running stops and restarts the daemon, reporting the new port/PID.
- Invoking `/eforge:restart` while a build is running aborts with a warning message indicating builds are in progress.
- The skill is available in any project (not just the eforge repo).
- `plugin.json` version is `0.5.6` and includes `"./skills/restart/restart.md"` in the `commands` array.
