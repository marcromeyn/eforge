---
title: Filter eforge MCP servers and Pi extensions from build agents
created: 2026-04-03
---



# Filter eforge MCP servers and Pi extensions from build agents

## Problem / Motivation

Build agents can currently access eforge tools through two unfiltered paths, risking orphaned daemon spawns and recursive build loops:

1. **MCP servers**: `loadMcpServers()` in `src/engine/eforge.ts` reads `.mcp.json` and passes ALL servers to the backend unfiltered. If the project's `.mcp.json` contains an `eforge` key (written by the eforge plugin/package), those tools (`eforge_build`, `eforge_status`, `eforge_daemon`, etc.) are available to build agents.

2. **Pi extensions**: `discoverPiExtensions()` in `src/engine/backends/pi-extensions.ts` auto-discovers extensions from `.pi/extensions/` (project-local) and `~/.pi/extensions/` (global). The eforge Pi package installs as directory `eforge` and registers the same tools directly as Pi agent tools.

The Claude SDK backend already filters the eforge *plugin* in `loadPlugins()` (`eforge.ts:1569-1570`) with `id.startsWith('eforge@')`. These two gaps need matching treatment.

## Goal

Close the two remaining paths through which build agents can access eforge tools (MCP servers and Pi extensions), preventing orphaned daemon spawns and recursive build loops.

## Approach

### 1. Filter eforge MCP server in `loadMcpServers()` (`src/engine/eforge.ts`)

After parsing `raw.mcpServers`, delete the `eforge` key before returning. Use exact key match `'eforge'` (the key the plugin/package writes to `.mcp.json`). Add a comment matching the style of the existing plugin filter:

```typescript
// Skip the eforge plugin itself to prevent orphaned daemons in agent worktrees
if (id.startsWith('eforge@')) continue;
```

### 2. Hardcode-exclude `eforge` extension in `discoverPiExtensions()` (`src/engine/backends/pi-extensions.ts`)

After collecting auto-discovered extension directories and before applying user-configured include/exclude filters, filter out any directory with basename `eforge`. This ensures the eforge extension is never loaded in build agents regardless of user config. Filter inside `discoverPiExtensions()` - not at the call site - so any consumer gets the filtered result.

### 3. Tests

- **`test/pi-extension-discovery.test.ts`**: Add a test verifying that an auto-discovered directory named `eforge` is excluded even with no config. Add another test verifying an explicit path ending in `eforge` is NOT filtered (explicit paths bypass all filters, matching existing behavior).

- **MCP server filtering**: `loadMcpServers` is a private function. Either add a focused test file `test/mcp-server-loading.test.ts` that tests filtering by writing a temporary `.mcp.json` with an `eforge` key and calling `EforgeEngine.create()`, or extract/export a filter helper, or simply verify via the existing integration surface. Choose whichever approach is cleanest.

### Design Decisions

- **Exact match `eforge` for MCP key** - not prefix matching. The `.mcp.json` key is a free-form name chosen by the installer; the eforge plugin/package uses `"eforge"`.
- **Basename match `eforge` for Pi extensions** - matches the package structure (`pi-package/extensions/eforge/`).
- **Hardcoded, not config-driven** - same as the plugin filter. These are safety guardrails. A build agent should never load eforge tools.

## Scope

**In scope:**
- Filtering the `eforge` key from MCP servers in `loadMcpServers()`
- Filtering the `eforge` directory from auto-discovered Pi extensions in `discoverPiExtensions()`
- Tests for Pi extension eforge exclusion (auto-discovered and explicit path cases)
- Optional test for MCP server filtering

**Out of scope:**
- Changing the existing plugin filter in `loadPlugins()`
- Config-driven filtering
- Filtering any other MCP servers or extensions

**Files to modify:**
- `src/engine/eforge.ts` - `loadMcpServers()` function
- `src/engine/backends/pi-extensions.ts` - `discoverPiExtensions()` function
- `test/pi-extension-discovery.test.ts` - add eforge exclusion tests

## Acceptance Criteria

- The `eforge` key is removed from parsed MCP servers in `loadMcpServers()` before returning
- Auto-discovered Pi extension directories with basename `eforge` are excluded in `discoverPiExtensions()`
- Explicit Pi extension paths ending in `eforge` are NOT filtered (explicit paths bypass all filters)
- A test in `test/pi-extension-discovery.test.ts` verifies auto-discovered `eforge` directory is excluded with no config
- A test in `test/pi-extension-discovery.test.ts` verifies explicit `eforge` path is not filtered
- `pnpm type-check` passes
- `pnpm test` passes (existing + new tests)
- `pnpm build` succeeds
