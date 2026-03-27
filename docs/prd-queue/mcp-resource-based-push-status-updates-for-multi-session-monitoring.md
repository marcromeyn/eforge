---
title: MCP Resource-Based Push Status Updates for Multi-Session Monitoring
created: 2026-03-27
status: pending
---

# MCP Resource-Based Push Status Updates for Multi-Session Monitoring

## Problem / Motivation

eforge's MCP proxy (`src/cli/mcp-proxy.ts`) is a pure request-response bridge - it exposes 7 tools that proxy HTTP calls to the daemon but uses zero server-initiated communication features from the MCP protocol. The daemon already has rich event streaming (SQLite + SSE), but none of that flows back to Claude Code unprompted. Claude Code must call `eforge_status` to poll.

Multiple Claude Code sessions may connect to the same daemon. Session A starts a build, gets killed, and Session B should be able to monitor that build's progress. Each session spawns its own MCP proxy process (stdio), but all proxies discover the same shared daemon via lockfile. This means session-bound features (like Channels) are insufficient as a primary mechanism - the status data must be queryable by any session at any time, backed by the daemon's persistent SQLite store.

### Current State

- **MCP SDK version**: `@modelcontextprotocol/sdk` ^1.28.0
- **Agent SDK version**: `@anthropic-ai/claude-agent-sdk` 0.2.84
- **MCP proxy**: `src/cli/mcp-proxy.ts` - `McpServer` with `StdioServerTransport`
- **Capabilities declared**: None (no `capabilities` object passed to McpServer constructor)
- **Notifications sent**: None
- **Resources exposed**: None
- **Progress reporting**: None

### Unused MCP Features Inventory

The following MCP features are available but unused:

1. **Resources + `list_changed` Notifications** - Server exposes named data objects clients can read on demand. With `listChanged` notifications, the server signals "something changed - re-read if you care." Claude Code supports resources via `@` mentions and the `readMcpResource` tool. `list_changed` notifications trigger automatic refresh.
2. **Logging Notifications (`notifications/message`)** - Server pushes structured log messages (`{ level, logger, data }`) to the client at any time. Client can filter via `logging/setLevel`. Log notifications only reach the currently-connected session and won't replay for new sessions.
3. **Progress Notifications (`notifications/progress`)** - Incremental progress reporting on a request that included a `progressToken` in `_meta`. Only works during a tool call - not for background push.
4. **Channels (`notifications/claude/channel`)** - Server pushes arbitrary text events into the active Claude Code conversation as `<channel source="eforge">` XML tags. Session-bound (events only reach active session), research preview with multiple open delivery bugs (#36431, #36503, #37633), feature-flag gated, requires `--dangerously-load-development-channels server:eforge`, and disables AskUserQuestion.
5. **Tools List Changed (`notifications/tools/list_changed`)** - Server tells the client its tool list changed; client re-fetches. Could dynamically add `eforge_cancel` when a build is active.
6. **Elicitation** - Server requests structured input from the user via form fields or URL redirect. Supported in Claude Code v2.1.74+. Could replace the current clarification callback mechanism for daemon builds where the originating session may be gone.

## Goal

Expose eforge daemon state as MCP resources with push-based `list_changed` notifications so that any Claude Code session can monitor build progress without polling, including sessions that did not originate the build.

## Approach

### Phase 1: Resources + `list_changed` (Primary - works today, stable, multi-session safe)

Expose eforge state as MCP resources backed by daemon HTTP/SQLite.

1. **Add resource capability** to `McpServer` constructor:
   ```ts
   const server = new McpServer({
     name: 'eforge',
     version: '0.5.0',
   }, {
     capabilities: {
       resources: { listChanged: true },
     },
   });
   ```

2. **Register resource handlers**:
   - `eforge://status` - calls `/api/latest-run` + `/api/run-summary/{sessionId}` on daemon
   - `eforge://status/{sessionId}` - calls `/api/run-summary/{sessionId}` directly (for monitoring a specific build). Use `resourceTemplates` for this pattern so Claude Code can discover it.
   - `eforge://queue` - calls `/api/queue` on daemon
   - `eforge://config` - calls `/api/config/show` on daemon

3. **SSE subscriber for `list_changed`**: After connecting the MCP transport, start an SSE connection to the daemon's `/api/events/{sessionId}` for the latest session. On key lifecycle events (`phase:start`, `phase:end`, `build:complete`, `build:error`, `enqueue:complete`), send `notifications/resources/list_changed`. The proxy reconnects on daemon restart.

**Why Resources are the best fit for multi-session:**
- **Stateless reads**: Any proxy instance reads the same daemon SQLite. Session B gets the same status as Session A would have.
- **No history loss**: Resources are fetched on demand from persistent storage, not streamed ephemerally.
- **Push without polling**: The `list_changed` notification tells Claude Code "status changed" - Claude decides whether to re-read based on context.
- **`@` mention UX**: Users can type `@eforge://status` in any session to check on builds started from other sessions.

### Phase 2: Logging Notifications (Low effort, additive)

Piggyback on the SSE subscriber from Phase 1.

1. **Add `logging` capability** to the server constructor
2. **Map daemon events to log levels** in the SSE subscriber:
   - `session:start`, `phase:start/end` -> `info`
   - `build:complete`, `plan:complete` -> `info`
   - `build:error`, `phase:error` -> `error`
   - `review:issue` (severity high/critical) -> `warning`
3. **Format log data** as structured JSON: `{ sessionId, planId?, phase?, message }`

### Key Architecture: SSE Subscriber in the Proxy

Both push features share a single daemon SSE connection in the proxy (~50-80 lines of code in `mcp-proxy.ts`):

1. After `server.connect(transport)`, call `ensureDaemon(cwd)` to get the port
2. Fetch `/api/latest-run` to get the current session ID
3. Open an SSE connection to `/api/events/{sessionId}` with reconnection logic
4. On each event, dispatch to:
   - `notifications/resources/list_changed` (Phase 1)
   - `notifications/message` (Phase 2)
5. When `/api/latest-run` changes (new session), reconnect to the new session's event stream
6. Handle daemon not running gracefully (skip SSE subscription, retry on next tool call)

### Multi-Session Scenarios

| Scenario | How it works |
|---|---|
| Session A builds, Session B monitors | B reads `eforge://status` resource - same daemon, same SQLite |
| Session A dies mid-build | Daemon continues. Session B reads resource, sees in-progress build |
| Session B starts after build completes | B reads `eforge://status`, sees completed build with results |
| Two sessions both monitoring | Both proxies have SSE subscribers; both get `list_changed` notifications independently |
| No active session | Daemon runs independently. Next session reads final state from resources |

**Files to modify**: `src/cli/mcp-proxy.ts`

## Scope

### In Scope

- **Phase 1**: MCP resource capability with `listChanged: true`, resource handlers for `eforge://status`, `eforge://status/{sessionId}`, `eforge://queue`, `eforge://config`, SSE subscriber in the proxy to emit `notifications/resources/list_changed`
- **Phase 2**: MCP logging capability, mapping daemon events to structured log notifications via the same SSE subscriber

### Out of Scope

- **Channels (`notifications/claude/channel`)**: Deferred until research preview stabilizes and delivery bugs (#36431, #36503, #37633) are resolved. Track the feature; implement experimentally once stable. Do not depend on it for the core multi-session workflow. Could serve as a supplementary real-time notification layer on top of resources.
- **Progress Notifications**: Don't suit 30+ minute builds. Only works during active tool calls. Revisit when the protocol matures.
- **Elicitation**: Could help with cross-session clarification (replacing the current clarification callback mechanism for daemon builds where the originating session may be gone). Deferred until protocol matures.
- **Tools List Changed**: Low priority UX polish (e.g., dynamically surfacing `eforge_cancel` when a build is active). Not related to the status push problem.

## Acceptance Criteria

1. **Resources readable across sessions**: Session A calls `eforge_build`. Kill Session A. Session B reads `@eforge://status` and sees the in-progress build with plan progress.
2. **`list_changed` push notifications**: Session B receives a resource refresh signal when the build completes, without calling any tool.
3. **Resource handlers functional**: `eforge://status`, `eforge://status/{sessionId}`, `eforge://queue`, and `eforge://config` all return correct data from the daemon's HTTP/SQLite store.
4. **Resource templates**: `eforge://status/{sessionId}` is exposed via `resourceTemplates` so Claude Code can discover the parameterized pattern.
5. **SSE subscriber resilience**: The proxy's SSE connection to the daemon reconnects on daemon restart. When `/api/latest-run` changes (new session), the subscriber reconnects to the new session's event stream. Daemon not running is handled gracefully (skip SSE subscription, retry on next tool call).
6. **Logging notifications (Phase 2)**: During an active build, Claude Code debug output shows structured eforge log messages with appropriate syslog levels (`info`, `error`, `warning`) and JSON data (`{ sessionId, planId?, phase?, message }`).
7. **MCP server capabilities**: The `McpServer` constructor declares `resources: { listChanged: true }` and (Phase 2) `logging` capabilities.
