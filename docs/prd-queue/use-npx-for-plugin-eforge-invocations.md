---
title: Use `npx` for plugin eforge invocations
created: 2026-03-26
status: pending
---

# Use `npx` for plugin eforge invocations

## Problem / Motivation

The eforge plugin uses bare `eforge` in its `.mcp.json` and skill shell-outs. This only works if `eforge` is on the user's PATH (via global npm install or developer build). Users who rely on `npx` - the default install path shown in the README (`npx eforge`) - won't have `eforge` on PATH, causing the plugin to fail. Internal spawns in `src/cli/daemon-client.ts` and `src/monitor/server-main.ts` don't need to change since they run inside an already-started eforge process.

## Goal

Switch all plugin-facing invocations from bare `eforge` to `npx -y eforge` so the plugin works for both developers (who have `eforge` on PATH) and regular users (who install via `npx`). The `-y` flag auto-confirms so the MCP server doesn't hang on an install prompt.

## Approach

Replace bare `eforge` with `npx -y eforge` in three layers of the plugin: the MCP server config (`.mcp.json`), the daemon spawn in the MCP proxy script, and the skill shell-outs. Expand the README Development section to explain the `npx` convention. Bump the plugin version.

### 1. Update `eforge-plugin/.mcp.json`

Change from:
```json
{ "command": "eforge", "args": ["mcp-proxy"] }
```
To:
```json
{ "command": "npx", "args": ["-y", "eforge", "mcp-proxy"] }
```

### 2. Update `eforge-plugin/mcp/eforge-mcp-proxy.mjs` (and `.js`)

Change the `ensureDaemon()` spawn at line 98 from:
```js
spawn('eforge', ['daemon', 'start'], { ... })
```
To:
```js
spawn('npx', ['-y', 'eforge', 'daemon', 'start'], { ... })
```

### 3. Update `/eforge:update` skill shell-outs

In `eforge-plugin/skills/update/update.md`, change:
- `eforge --version` to `npx -y eforge --version`
- `eforge daemon stop` / `eforge daemon start` - leave as-is for now (will be replaced by the daemon MCP tool from the in-flight build) or update to `npx -y eforge daemon stop/start` as an interim fix

### 4. Expand Development section in `README.md`

The existing Development section (line 80) is minimal. Add info explaining:
- The plugin uses `npx -y eforge` so it works for both developers and regular users
- Developers building from source: `pnpm build` makes `eforge` available on PATH (via npm link or global install), `npx` finds it automatically
- After local code changes: `pnpm build`, then restart daemons in other projects with `/eforge:restart` to pick up the new binary
- The `/eforge-daemon-restart` project-local skill (in `.claude/skills/`) does build + restart in one step when working in the eforge repo itself

### 5. Bump plugin version

Update `eforge-plugin/.claude-plugin/plugin.json` with a version bump.

## Scope

**In scope:**

| File | Change |
|------|--------|
| `eforge-plugin/.mcp.json` | `npx -y eforge mcp-proxy` |
| `eforge-plugin/mcp/eforge-mcp-proxy.mjs` | `spawn('npx', ['-y', 'eforge', ...])` |
| `eforge-plugin/mcp/eforge-mcp-proxy.js` | Same as above |
| `eforge-plugin/skills/update/update.md` | `npx -y eforge --version` |
| `README.md` | Expand Development section |
| `eforge-plugin/.claude-plugin/plugin.json` | Version bump |

**Out of scope:**

- Internal spawns in `src/cli/daemon-client.ts` and `src/monitor/server-main.ts` - these run inside an already-started eforge process and do not need changes
- Daemon stop/start commands in the update skill that will be replaced by the daemon MCP tool from the in-flight build

## Acceptance Criteria

- `.mcp.json` uses `npx -y eforge mcp-proxy` instead of bare `eforge mcp-proxy`
- `eforge-mcp-proxy.mjs` and `eforge-mcp-proxy.js` spawn the daemon via `npx -y eforge daemon start`
- The update skill references `npx -y eforge --version`
- README Development section documents the `npx -y eforge` convention, developer build workflow (`pnpm build`), daemon restart workflow, and the `/eforge-daemon-restart` project-local skill
- Plugin version is bumped in `plugin.json`
- After `/reload-plugins`, the MCP server starts correctly via `npx`
- `/eforge:status` works, confirming MCP proxy to daemon communication
