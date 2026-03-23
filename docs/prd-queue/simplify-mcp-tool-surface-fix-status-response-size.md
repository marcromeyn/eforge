---
title: Simplify MCP Tool Surface + Fix Status Response Size
created: 2026-03-23
status: pending
---

# Simplify MCP Tool Surface + Fix Status Response Size

## Problem / Motivation

The eforge MCP server exposes 8 tools, but 3 are redundant — Claude Code already has native access to git and the filesystem:

- **`eforge_diff`** — Claude can run `git diff` directly
- **`eforge_events`** — duplicate of `eforge_status` (same endpoint)
- **`eforge_plans`** — Claude can read plan files from disk with the Read tool

Additionally, `eforge_status` returns the full event stream (1.2M chars for a single build), making it unusable as an MCP tool response.

## Goal

Reduce the MCP tool surface from 8 to 5 tools by removing redundant ones, and make `eforge_status` return a compact summary instead of the full event stream.

## Approach

1. **Remove 3 redundant tools from `src/cli/mcp-proxy.ts`** — Delete the `eforge_events`, `eforge_plans`, and `eforge_diff` tool registrations. This leaves 5 tools: `eforge_run`, `eforge_enqueue`, `eforge_status`, `eforge_queue_list`, `eforge_config`.

2. **Add summary endpoint to `src/monitor/server.ts`** — Add `GET /api/run-summary/:id` that returns a compact summary instead of the full event stream:

   ```typescript
   {
     sessionId: string;
     status: 'running' | 'completed' | 'failed' | 'unknown';
     runs: Array<{ id: string; command: string; status: string; startedAt: string; completedAt?: string }>;
     plans: Array<{ id: string; status: string; branch?: string; dependsOn?: string[] }>;
     currentPhase?: string;        // 'compile' | 'build' | 'validation'
     currentAgent?: string;        // e.g. 'planner', 'builder', 'reviewer'
     eventCounts: { total: number; errors: number };
     duration?: string;            // e.g. '12m 34s'
   }
   ```

   Build this by scanning events server-side (reuse existing `db.getEventsBySession()` and `db.getSessionRuns()`), extracting plan status from `build:start`/`build:complete`/`build:failed` events, and computing counts. This keeps the heavy lifting in the server, not the MCP proxy.

3. **Point `eforge_status` at the summary endpoint** — In `src/cli/mcp-proxy.ts`, change the status tool to call `/api/run-summary/:id` instead of `/api/run-state/:id`.

4. **Bump plugin version to 0.4.0** — In `eforge-plugin/.claude-plugin/plugin.json`.

5. **Update plugin skills that reference removed tools** — Check all 4 skills in `eforge-plugin/skills/` for references to `mcp__eforge__eforge_events`, `mcp__eforge__eforge_plans`, or `mcp__eforge__eforge_diff` and remove them. The status skill references `eforge_events` as a fallback — remove that reference.

### Files to modify

- `src/cli/mcp-proxy.ts` — Remove 3 tools, change status endpoint
- `src/monitor/server.ts` — Add `GET /api/run-summary/:id` route + `serveRunSummary()` function
- `eforge-plugin/.claude-plugin/plugin.json` — Bump to 0.4.0
- `eforge-plugin/skills/status/status.md` — Remove reference to `eforge_events`
- `eforge-plugin/skills/run/run.md` — Remove any references to removed tools (if any)

## Scope

**In scope:**

- Removing `eforge_diff`, `eforge_events`, and `eforge_plans` tool registrations from MCP proxy
- Adding a new `/api/run-summary/:id` server-side endpoint that computes a compact summary
- Updating `eforge_status` to use the new summary endpoint
- Bumping plugin version to 0.4.0
- Updating plugin skill files that reference removed tools

**Out of scope:**

N/A

## Acceptance Criteria

- `pnpm type-check` passes
- `pnpm build` passes
- `pnpm test` passes
- `eforge mcp-proxy` starts without error (Ctrl+C to exit)
- After syncing to plugin cache + `/reload-plugins`: tool list shows 5 tools, not 8
- `mcp__eforge__eforge_status` returns a compact summary, not 1.2M chars of events
