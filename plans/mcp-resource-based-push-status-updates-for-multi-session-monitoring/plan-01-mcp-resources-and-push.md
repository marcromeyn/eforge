---
id: plan-01-mcp-resources-and-push
name: MCP Resources, SSE Subscriber, and Logging Notifications
depends_on: []
branch: mcp-resource-based-push-status-updates-for-multi-session-monitoring/mcp-resources-and-push
---

# MCP Resources, SSE Subscriber, and Logging Notifications

## Architecture Context

The MCP proxy (`src/cli/mcp-proxy.ts`) is a stdio-based bridge between Claude Code and the eforge daemon's HTTP API. It currently exposes 7 tools but zero resources or push notifications. The daemon already has all the data endpoints and SSE streaming needed - this plan adds the MCP protocol layer on top.

The `McpServer` class from `@modelcontextprotocol/sdk` (^1.28.0) supports:
- `registerResource()` / `resource()` for fixed-URI resources
- `ResourceTemplate` for parameterized URI patterns
- `sendResourceListChanged()` to notify the client that resources have updated
- `sendLoggingMessage()` to push structured log messages
- Capabilities declared via constructor options: `resources: { listChanged: true }` and `logging: {}`

All daemon HTTP endpoints already exist:
- `GET /api/latest-run` returns `{ sessionId, runId }`
- `GET /api/run-summary/:id` returns full session status with plans, phases, agents
- `GET /api/queue` returns PRD queue listing
- `GET /api/config/show` returns resolved eforge.yaml config
- `GET /api/events/:sessionId` serves SSE event stream with replay via `Last-Event-ID`

## Implementation

### Overview

Add MCP resource capability, register 4 resources (3 fixed + 1 template), start an SSE subscriber to the daemon after transport connection, and emit both `list_changed` and logging notifications on key lifecycle events.

### Key Decisions

1. **Single SSE connection per proxy process** - Each proxy process maintains one SSE connection to the daemon's `/api/events/:sessionId` endpoint. This reuses the daemon's existing SSE infrastructure rather than adding new endpoints.

2. **Poll for session changes** - The SSE subscriber periodically checks `/api/latest-run` to detect when a new session starts (e.g., a new build kicks off). When the session ID changes, it reconnects to the new session's event stream. Poll interval: 10 seconds.

3. **Graceful degradation** - If the daemon is not running or SSE connection fails, the proxy continues operating normally (tools still work). SSE subscription retries on the next tool call that successfully reaches the daemon.

4. **Resource URIs use `eforge://` scheme** - `eforge://status`, `eforge://status/{sessionId}`, `eforge://queue`, `eforge://config`. The template resource uses `ResourceTemplate` class for `{sessionId}` parameter.

5. **Event-to-notification mapping** - Only key lifecycle events trigger `list_changed` (not every event). This prevents notification spam. Logging notifications use syslog-compatible levels: `info`, `warning`, `error`.

6. **`EventSource` not available in Node.js** - Use raw HTTP with chunked transfer decoding to consume SSE from the daemon. Parse the `id:` and `data:` lines from the SSE stream manually since Node.js does not have a built-in `EventSource` API. Alternatively, use the `eventsource` npm package if already available, but prefer zero-dependency approach with native `http.get()`.

## Scope

### In Scope
- MCP server capabilities declaration (`resources: { listChanged: true }`, `logging: {}`)
- 3 fixed resources: `eforge://status`, `eforge://queue`, `eforge://config`
- 1 resource template: `eforge://status/{sessionId}`
- SSE subscriber connecting to daemon's `/api/events/:sessionId` after transport connects
- `list_changed` notifications on lifecycle events (`phase:start`, `phase:end`, `build:complete`, `build:error`, `enqueue:complete`, `session:start`, `session:end`)
- Logging notifications mapping daemon events to syslog levels (`info`, `warning`, `error`)
- SSE reconnection on daemon restart and session change detection
- Graceful handling when daemon is not running

### Out of Scope
- MCP Channels (deferred - research preview with known bugs)
- Progress notifications (not suited for long builds)
- Elicitation (deferred)
- Tools list changed notifications
- New daemon HTTP endpoints (all required endpoints already exist)
- Changes to the daemon server code

## Files

### Modify
- `src/cli/mcp-proxy.ts` - Add resource capability to McpServer constructor, register 4 resource handlers, implement SSE subscriber function, wire up `list_changed` and logging notifications, add cleanup on transport close

## Verification

- [ ] `McpServer` constructor includes `capabilities: { resources: { listChanged: true }, logging: {} }`
- [ ] `eforge://status` resource handler calls `/api/latest-run` then `/api/run-summary/{sessionId}` and returns JSON text content
- [ ] `eforge://status` returns `{ status: 'idle', message: 'No active eforge sessions.' }` when no session exists
- [ ] `eforge://status/{sessionId}` resource template calls `/api/run-summary/{sessionId}` directly
- [ ] `eforge://queue` resource handler calls `/api/queue` and returns JSON text content
- [ ] `eforge://config` resource handler calls `/api/config/show` and returns JSON text content
- [ ] SSE subscriber opens HTTP connection to `http://127.0.0.1:{port}/api/events/{sessionId}` after `server.connect(transport)`
- [ ] SSE subscriber calls `server.sendResourceListChanged()` on events matching: `phase:start`, `phase:end`, `build:complete`, `build:error`, `enqueue:complete`, `session:start`, `session:end`
- [ ] SSE subscriber calls `server.sendLoggingMessage()` with level `info` for `session:start`, `phase:start`, `phase:end`, `build:complete`, `plan:complete`
- [ ] SSE subscriber calls `server.sendLoggingMessage()` with level `error` for `build:error`, `phase:error`
- [ ] SSE subscriber calls `server.sendLoggingMessage()` with level `warning` for `review:issue` events with severity `high` or `critical`
- [ ] Logging message `data` field contains structured JSON: `{ sessionId, planId?, phase?, message }`
- [ ] SSE subscriber polls `/api/latest-run` every 10 seconds and reconnects when sessionId changes
- [ ] SSE subscriber handles daemon not running by skipping subscription (no crash, no unhandled rejection)
- [ ] SSE subscriber reconnects with exponential backoff (1s, 2s, 4s, max 30s) when the SSE connection drops
- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes with zero failures
