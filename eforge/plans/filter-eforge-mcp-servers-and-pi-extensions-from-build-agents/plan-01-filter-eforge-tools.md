---
id: plan-01-filter-eforge-tools
name: Filter eforge MCP servers and Pi extensions from build agents
depends_on: []
branch: filter-eforge-mcp-servers-and-pi-extensions-from-build-agents/filter-eforge-tools
---

# Filter eforge MCP servers and Pi extensions from build agents

## Architecture Context

Build agents can access eforge tools through two unfiltered paths: MCP servers (via `.mcp.json`) and Pi extensions (via auto-discovery). The Claude SDK backend already filters the eforge *plugin* in `loadPlugins()` (`src/engine/eforge.ts:1570`) with `if (id.startsWith('eforge@')) continue;`. This plan closes the two remaining gaps using the same hardcoded safety-guardrail pattern.

## Implementation

### Overview

Add eforge filtering to `loadMcpServers()` and `discoverPiExtensions()`, then add tests for the Pi extension filtering. The MCP filtering is a 2-line change; the Pi extension filtering is a 2-line change; the tests follow existing patterns in `test/pi-extension-discovery.test.ts`.

### Key Decisions

1. **Exact key match `'eforge'` for MCP servers** - the `.mcp.json` key is a free-form name chosen by the installer; the eforge plugin/package uses `"eforge"`. This matches the existing pattern where the plugin filter uses `id.startsWith('eforge@')` (plugin IDs include version).
2. **Basename match `'eforge'` for Pi extensions** - matches the package structure (`pi-package/extensions/eforge/`). Filter is applied to auto-discovered extensions only, before user-configured include/exclude filters, so it acts as a hardcoded safety guardrail.
3. **Explicit Pi extension paths are NOT filtered** - consistent with existing behavior where explicit `config.paths` bypass all include/exclude filters.

## Scope

### In Scope
- Delete the `eforge` key from parsed MCP servers in `loadMcpServers()` before returning
- Filter auto-discovered Pi extension directories with basename `eforge` in `discoverPiExtensions()` before user filters
- Add test: auto-discovered `eforge` directory is excluded with no config
- Add test: explicit path ending in `eforge` is not filtered

### Out of Scope
- Changing the existing plugin filter in `loadPlugins()`
- Config-driven filtering
- Filtering any other MCP servers or extensions
- Testing `loadMcpServers()` (private function, low complexity change)

## Files

### Modify
- `src/engine/eforge.ts` - In `loadMcpServers()`, after parsing `raw.mcpServers` and before returning, delete the `eforge` key: `delete raw.mcpServers['eforge']`. Add a comment matching the existing plugin filter style.
- `src/engine/backends/pi-extensions.ts` - In `discoverPiExtensions()`, after `collectExtensionDirs()` calls populate `autoDiscovered` and before the include/exclude filters, filter out entries with `basename(p) === 'eforge'`. Add a comment explaining this is a safety guardrail matching the plugin filter.
- `test/pi-extension-discovery.test.ts` - Add two tests: (1) auto-discovered `eforge` directory is excluded even with no config, (2) explicit path ending in `eforge` is NOT filtered.

## Detailed Changes

### `src/engine/eforge.ts` - `loadMcpServers()`

After the line `return raw.mcpServers;` (line ~1537), change to:

```typescript
// Filter the eforge MCP server to prevent orphaned daemons in agent worktrees
delete raw.mcpServers['eforge'];
return raw.mcpServers;
```

### `src/engine/backends/pi-extensions.ts` - `discoverPiExtensions()`

After the two `collectExtensionDirs()` calls and before the include filter block, add:

```typescript
// Filter the eforge extension to prevent orphaned daemons in agent worktrees
const safeAutoDiscovered = autoDiscovered.filter(p => basename(p) !== 'eforge');
```

Then update references from `autoDiscovered` to `safeAutoDiscovered` in the include/exclude filter blocks below.

### `test/pi-extension-discovery.test.ts`

Add two tests inside the existing `describe('discoverPiExtensions')` block:

```typescript
it('excludes auto-discovered eforge extension with no config', async () => {
  const extDir = join(cwd, '.pi', 'extensions');
  await mkdir(join(extDir, 'eforge'));
  const result = await discoverPiExtensions(cwd);
  // alpha, beta, gamma from beforeEach — eforge excluded
  expect(result).toHaveLength(3);
  expect(result.map(p => p.split('/').pop())).not.toContain('eforge');
});

it('does not filter explicit eforge path', async () => {
  const explicitEforge = join(cwd, 'custom-eforge');
  await mkdir(explicitEforge, { recursive: true });
  // Rename to exactly 'eforge' basename
  const eforgePath = join(cwd, 'eforge');
  await mkdir(eforgePath, { recursive: true });
  const result = await discoverPiExtensions(cwd, { paths: [eforgePath] });
  expect(result.some(p => p.endsWith('eforge'))).toBe(true);
});
```

## Verification

- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` exits with code 0 (all existing + new tests pass)
- [ ] `pnpm build` exits with code 0
- [ ] In `loadMcpServers()`, `delete raw.mcpServers['eforge']` is called before the return statement
- [ ] In `discoverPiExtensions()`, auto-discovered entries with basename `eforge` are filtered before include/exclude processing
- [ ] Explicit `config.paths` entries with basename `eforge` are NOT filtered in `discoverPiExtensions()`
- [ ] New test `'excludes auto-discovered eforge extension with no config'` passes in `test/pi-extension-discovery.test.ts`
- [ ] New test `'does not filter explicit eforge path'` passes in `test/pi-extension-discovery.test.ts`
