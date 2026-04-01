---
id: plan-01-eforge-init-mcp-tool
name: eforge_init MCP Tool with Elicitation
depends_on: []
branch: add-eforge-init-skill-with-mcp-elicitation-ui-for-project-onboarding/eforge-init-mcp-tool
---

# eforge_init MCP Tool with Elicitation

## Architecture Context

The eforge MCP proxy (`src/cli/mcp-proxy.ts`) bridges tool calls from Claude Code to the eforge daemon HTTP API. Currently it has 7 tools - none use elicitation. The MCP SDK v1.29.0 provides `server.server.elicitInput()` for presenting structured forms to users. This plan adds the first elicitation-based tool: `eforge_init`, which handles project onboarding with minimal friction.

The tool operates locally (no daemon needed) since it creates files before the daemon is relevant. It uses elicitation to present a backend choice form, then writes `eforge/config.yaml` and updates `.gitignore`.

## Implementation

### Overview

Add a new `eforge_init` tool to the MCP proxy that:
1. Checks if `eforge/config.yaml` already exists (aborts unless `force: true`)
2. Sends an elicitation form requesting backend choice (claude-sdk or pi)
3. Adds `eforge/` and `.eforge/` entries to `.gitignore` if not already present
4. Writes `eforge/config.yaml` with the chosen backend and sensible defaults
5. Validates the created config via the daemon's `/api/config/validate` endpoint
6. Returns a success summary

### Key Decisions

1. **Tool operates locally for file I/O, delegates to daemon for validation only.** The init tool reads/writes `.gitignore` and `eforge/config.yaml` directly using `node:fs` - it does not need the daemon for file creation. It calls `daemonRequest` only for the final validation step (which auto-starts the daemon via `ensureDaemon`). This avoids requiring a running daemon before config exists.

2. **Elicitation accessed via `server.server.elicitInput()`.** The `McpServer` class exposes its underlying `Server` instance via the `server` property. The tool handler closure captures the `McpServer` instance (already named `server` in `runMcpProxy`) and calls `server.server.elicitInput()`. The form uses `oneOf` for the backend enum field to provide titled options.

3. **Graceful elicitation fallback.** If the user declines or cancels the elicitation form, the tool returns an informational message rather than an error. This matches the MCP SDK's `ElicitResult.action` being `'accept' | 'decline' | 'cancel'`.

4. **Default config matches `DEFAULT_CONFIG` from `config.ts`.** The generated `eforge/config.yaml` contains only `backend` plus `build.postMergeCommands` as an empty array placeholder with a YAML comment. All other values rely on `resolveConfig` defaults, keeping the config file minimal.

5. **`.gitignore` management is inline.** Rather than creating a shared utility, the gitignore logic is a helper function within `mcp-proxy.ts`. It reads the existing `.gitignore` (or creates one), checks for each required entry, and appends missing entries with a `# eforge` comment header.

## Scope

### In Scope
- New `eforge_init` MCP tool in `src/cli/mcp-proxy.ts`
- Elicitation form for backend selection (claude-sdk / pi)
- `.gitignore` management: ensure `eforge/` and `.eforge/` entries exist
- `eforge/config.yaml` creation with chosen backend + minimal defaults
- Config validation via daemon endpoint
- `force` flag to allow re-initialization
- New `eforge-plugin/skills/init/init.md` skill file that invokes the tool
- Plugin version bump and command registration in `plugin.json`

### Out of Scope
- Reworking `/eforge:config` to use elicitation (follow-up work)
- URL-mode elicitation
- Elicitation hooks for automation
- Config migration from `eforge.yaml` (legacy) to `eforge/config.yaml`

## Files

### Create
- `eforge-plugin/skills/init/init.md` - Thin skill launcher that calls `mcp__eforge__eforge_init`

### Modify
- `src/cli/mcp-proxy.ts` - Add `eforge_init` tool with elicitation form, extend existing `node:fs/promises` import (which already has `readFile`) to include `writeFile`/`access`/`mkdir`, add gitignore helper function
- `eforge-plugin/.claude-plugin/plugin.json` - Add `./skills/init/init.md` to commands array, bump version to `0.5.14`

## Verification

- [ ] Running `/eforge:init` in a project without `eforge/config.yaml` presents an elicitation form with backend choice (claude-sdk, pi)
- [ ] Selecting a backend creates `eforge/config.yaml` with `backend: <chosen>` and minimal defaults
- [ ] `.gitignore` in the project root contains `eforge/` and `.eforge/` entries after init
- [ ] If `.gitignore` already contains both entries, it is not modified
- [ ] Running `/eforge:init` when `eforge/config.yaml` already exists returns an error message mentioning the `force` flag
- [ ] Running `/eforge:init` with `force: true` overwrites the existing config
- [ ] If the user declines or cancels the elicitation form, the tool returns an informational (non-error) message
- [ ] The created config passes validation via `mcp__eforge__eforge_config` with `{ action: "validate" }`
- [ ] `plugin.json` version is `0.5.14` and includes `./skills/init/init.md` in commands
- [ ] `pnpm type-check` passes with no errors
- [ ] `pnpm build` succeeds
