---
title: Include monitor URL in eforge_build/eforge_run MCP tool response
created: 2026-03-26
status: pending
---

# Include monitor URL in eforge_build/eforge_run MCP tool response

## Problem / Motivation

When a user invokes `/eforge:build` and a build is kicked off, they have no way to see the monitor dashboard URL (e.g., `http://localhost:4567`) to watch progress. Currently:

- The daemon API `/api/run` returns only `{ sessionId, pid }` - no monitor URL.
- The MCP proxy (`eforge-plugin/mcp/eforge-mcp-proxy.mjs`) already discovers the daemon port via `ensureDaemon()` but discards it after making the request.
- The build skill (`eforge-plugin/skills/build/build.md` line 109) already says "If the monitor is running, also include the monitor URL" but has no data to work with.

## Goal

Inject `monitorUrl` into the MCP proxy response so that users see the monitor dashboard URL when a build or run is kicked off, with no daemon API modifications needed.

## Approach

The MCP proxy already knows the daemon port (the daemon IS the monitor server), so the change is minimal - surface the port from `daemonRequest()` and inject the URL into tool responses.

### Step 1: Modify `daemonRequest()` to return the port alongside the result

In `eforge-plugin/mcp/eforge-mcp-proxy.mjs` (lines 122-144), change `daemonRequest` to return `{ data, port }` instead of just the parsed response. This way tool handlers have access to the port.

### Step 2: Update all tool handlers to use `result.data`

Every tool handler currently does:
```js
const result = await daemonRequest(cwd, 'POST', '/api/run', { ... });
return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
```

Update all 8 tool handlers to destructure `{ data }` or `{ data, port }` from the return value.

### Step 3: Inject `monitorUrl` into `eforge_run` and `eforge_enqueue` responses

For the two tools that kick off work, inject `monitorUrl: http://localhost:${port}` into the response object before serializing.

For `eforge_run` (line ~197):
```js
const { data, port } = await daemonRequest(cwd, 'POST', '/api/run', { ... });
return { content: [{ type: 'text', text: JSON.stringify({ ...data, monitorUrl: `http://localhost:${port}` }, null, 2) }] };
```

Same pattern for `eforge_enqueue` and the queue-mode branch of `eforge_run`.

### Step 4: Bump plugin version

In `eforge-plugin/.claude-plugin/plugin.json`, bump version per convention.

## Scope

**In scope:**

- Modifying `daemonRequest()` return value in `eforge-plugin/mcp/eforge-mcp-proxy.mjs`
- Updating all 8 tool handlers to destructure the new return shape
- Injecting `monitorUrl` into `eforge_run` and `eforge_enqueue` responses
- Bumping the plugin version in `eforge-plugin/.claude-plugin/plugin.json`

**Out of scope:**

- Changes to the daemon API itself (`/api/run` response shape remains unchanged)
- Changes to any other files beyond the two listed

**Files to modify:**

1. `eforge-plugin/mcp/eforge-mcp-proxy.mjs` - core change (daemonRequest return value + tool handlers)
2. `eforge-plugin/.claude-plugin/plugin.json` - version bump

## Acceptance Criteria

- `daemonRequest()` returns `{ data, port }` instead of raw parsed data.
- All 8 tool handlers correctly destructure the new return shape and continue to function.
- `eforge_run` response JSON includes a `monitorUrl` field (e.g., `http://localhost:4567`).
- `eforge_enqueue` response JSON includes a `monitorUrl` field.
- The queue-mode branch of `eforge_run` also includes `monitorUrl`.
- `pnpm build` succeeds with no build issues.
- Starting the daemon (`eforge daemon start`) and calling `eforge_run` or `eforge_enqueue` MCP tool returns a response containing `monitorUrl`.
- Invoking the `/eforge:build` skill end-to-end reports the monitor URL to the user.
