---
title: Plan: Add `/eforge:update` skill to the plugin
created: 2026-03-24
status: pending
---

# Add `/eforge:update` Skill to the Plugin

## Problem / Motivation

The eforge npm package and Claude Code plugin are versioned independently. Users currently have no streamlined way to update both components — they would have to manually run `npm install -g eforge@latest`, then `/plugin update eforge@eforge`, then restart the daemon. This is a multi-step, error-prone process that should be a single command.

## Goal

Provide an `/eforge:update` skill that checks for updates, installs the latest npm package, restarts the daemon, and guides the user through updating the plugin — all in one workflow.

## Approach

Add a new skill at `eforge-plugin/skills/update/update.md` and register it in `plugin.json`. The skill is a pure markdown workflow (no new MCP tools needed) that uses bash commands and existing Claude Code commands.

The workflow has six steps:

1. **Check current versions** — Run `eforge --version` (or `npx eforge --version`) to get the current CLI version. Read `plugin.json` version from the installed plugin path.

2. **Check latest versions** — Run `npm view eforge version` to get the latest published npm version. Compare with current — if already latest, report "up to date" and stop.

3. **Update npm package** — If installed globally (`which eforge` resolves to a global `node_modules` path): `npm install -g eforge@latest`. If using npx: skip (npx always fetches latest).

4. **Restart daemon** — Run `eforge daemon stop` then `eforge daemon start` (same pattern as the existing `daemon-restart` skill).

5. **Update plugin** — Tell the user to run `/plugin update eforge@eforge`. Skills cannot invoke other slash commands, so this step must be manual.

6. **Report** — Show old → new versions for both components. Confirm daemon is running with the new binary.

The skill follows the existing skill format (frontmatter with `description`, `disable-model-invocation: true`).

## Scope

**In scope:**
- New skill file: `eforge-plugin/skills/update/update.md`
- Register the skill in `eforge-plugin/.claude-plugin/plugin.json` (add `"./skills/update/update.md"` to the `commands` array)
- Bump plugin version from `0.5.1` → `0.5.2` (per CLAUDE.md convention: always bump plugin version when changing plugin files)
- Version checking for both npm package and installed plugin
- Global npm package update via `npm install -g eforge@latest`
- Daemon restart after update
- User guidance for plugin update step

**Out of scope:**
- New MCP tools (not needed)
- Automated plugin update from within the skill (skills can't invoke other slash commands)
- npx update handling (npx always fetches latest automatically)

## Acceptance Criteria

- `/eforge:update` loads and executes from Claude Code
- The skill checks current installed versions of both the npm package and plugin
- The skill checks the latest available version from the npm registry
- If already up to date, the skill reports "up to date" and stops
- If an update is available, `eforge --version` shows the new version after the skill runs
- The daemon restarts successfully with the new binary
- The skill displays a clear instruction to run `/plugin update eforge@eforge` for the plugin update
- The skill reports old → new versions for both components
- The skill is registered in `plugin.json` under the `commands` array
- Plugin version is bumped to `0.5.2`
