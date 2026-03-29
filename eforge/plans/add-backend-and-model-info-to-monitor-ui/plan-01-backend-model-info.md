---
id: plan-01-backend-model-info
name: Add Backend and Model Info to Monitor UI
depends_on: []
branch: add-backend-and-model-info-to-monitor-ui/backend-model-info
---

# Add Backend and Model Info to Monitor UI

## Architecture Context

eforge supports two backends (`claude-sdk` and `pi`), but the monitor has no visibility into which backend or model each agent uses. The `agent:start` event currently carries only `agentId`, `agent` (role), and optional `planId`. Both backends know the model and backend identity before yielding `agent:start`, so the information can be added there. The monitor reducer, DB metadata, and UI components then consume these new fields to surface them to users.

This is a type cascade: adding required fields to `agent:start` in the engine, emitting them from both backends, and consuming them in the monitor reducer, DB layer, and UI. All changes must land together since the fields are required (no backward compat in the engine).

## Implementation

### Overview

Add `model: string` and `backend: string` as required fields on the `agent:start` event type. Update both backends to emit these fields. Update the monitor reducer to track `model` per `AgentThread` and `backend` per `RunState`. Update the monitor DB to include `backend` in `SessionMetadata`. Update three UI components: thread pipeline tooltips (model), summary cards (backend), and sidebar session items (backend). Update the mock server to include the new fields in synthetic events.

### Key Decisions

1. **Fields are required on `agent:start`** - No backward compat in the engine. The monitor reducer uses `?? 'unknown'` fallbacks when parsing old DB events that lack these fields. These fallbacks should be removed after 2026-04-29.
2. **Pi backend moves `resolveModel()` before `agent:start` yield** - Currently `resolveModel()` is called after `agent:start` at line 328. Move it before line 319. If model resolution fails, `agent:start` won't be emitted (error propagates as `agent:stop` with error).
3. **Claude SDK uses `options.model ?? 'auto'`** - Covers the case where model class is `auto` (no role currently uses it). All current roles use `max`/`balanced`/`fast` which resolve to concrete model strings.
4. **First `agent:start` wins for session-level backend** - The reducer sets `backend` from the first `agent:start` event and does not overwrite it.
5. **Backend displayed as subtle dimmed text, not a badge** - In both the summary bar and sidebar, backend info is a small dimmed label to avoid visual clutter since most users use one backend.

## Scope

### In Scope
- Adding `model` and `backend` fields to `agent:start` event type in `src/engine/events.ts`
- Emitting these fields from both `claude-sdk` and `pi` backends
- Moving `resolveModel()` before `agent:start` in the pi backend
- Adding `model` to `AgentThread` interface and `backend` to `RunState` in the monitor reducer
- Displaying model in pipeline thread tooltips
- Displaying backend in the summary bar
- Adding `backend` to `SessionMetadata` in the monitor DB and UI types
- Displaying backend in the sidebar session items
- Updating mock server synthetic `agent:start` events

### Out of Scope
- Backward compatibility handling in the engine (fields are required)
- Long-term support for old DB data (DB is ephemeral/gitignored)
- Model/backend filtering or search in the sidebar

## Files

### Modify
- `src/engine/events.ts` - Add `model: string` and `backend: string` fields to the `agent:start` event variant (line 207)
- `src/engine/backends/claude-sdk.ts` - Add `model: options.model ?? 'auto', backend: 'claude-sdk'` to the `agent:start` yield at line 46
- `src/engine/backends/pi.ts` - Move `resolveModel()` call from line 328 to before the `agent:start` yield at line 319. Add `model: model.id, backend: 'pi'` to the `agent:start` yield. Also move `resolveThinkingLevel()` since it doesn't depend on model being resolved first
- `test/stub-backend.ts` - Add `model: options.model ?? 'stub-model', backend: 'stub'` to the `agent:start` yield at line 68 to satisfy the new required fields on the event type
- `src/monitor/ui/src/lib/reducer.ts` - Add `model: string` to `AgentThread` interface. Add `backend: string | null` to `RunState` and `initialRunState`. In `processEvent` for `agent:start`: capture `model` (with `?? 'unknown'` fallback) and set `backend` if not already set (with `?? 'unknown'` fallback). Mark fallbacks with comment for removal after 2026-04-29
- `src/monitor/ui/src/components/pipeline/thread-pipeline.tsx` - In the thread bar `TooltipContent` (around line 636-653), add model name below the agent name when `thread.model` is available
- `src/monitor/ui/src/components/common/summary-cards.tsx` - Accept `backend?: string | null` prop. Display as a small dimmed label next to the status indicator
- `src/monitor/ui/src/app.tsx` - Pass `backend={runState.backend}` to `SummaryCards`
- `src/monitor/db.ts` - Add `backend: string | null` to `SessionMetadata` interface. Add `'agent:start'` to the `getSessionMetadataEvents` SQL `IN` clause. Extract backend from `agent:start` data in `getSessionMetadataBatch()` (first match per session)
- `src/monitor/ui/src/lib/types.ts` - Add `backend: string | null` to `SessionMetadata` interface
- `src/monitor/ui/src/components/layout/sidebar.tsx` - Show backend as a small dimmed label in session items when `metadata?.backend` is available
- `src/monitor/mock-server.ts` - Add `model` and `backend` fields to all synthetic `agent:start` events in `insertAgentRun()`. Use `'claude-sdk'` as backend and role-appropriate model names (e.g. `'claude-sonnet-4-20250514'` for most agents)

## Verification

- [ ] `pnpm type-check` passes with zero type errors
- [ ] `pnpm test` passes (all existing tests)
- [ ] `pnpm build` produces a clean bundle with no errors
- [ ] `agent:start` event type in `events.ts` includes required `model: string` and `backend: string` fields
- [ ] Claude SDK backend yields `agent:start` with `model` and `backend: 'claude-sdk'` fields
- [ ] Pi backend calls `resolveModel()` before yielding `agent:start`, and yields `model: model.id` and `backend: 'pi'`
- [ ] `AgentThread` interface has a `model: string` field
- [ ] `RunState` interface has a `backend: string | null` field initialized to `null`
- [ ] Reducer sets `AgentThread.model` from `agent:start` event data with `?? 'unknown'` fallback
- [ ] Reducer sets `RunState.backend` from the first `agent:start` event (does not overwrite once set) with `?? 'unknown'` fallback
- [ ] Reducer fallback comments include "remove after 2026-04-29"
- [ ] Thread pipeline tooltip displays `thread.model` below the agent name when present
- [ ] `SummaryCards` component accepts `backend` prop and displays it as a dimmed label
- [ ] `App.tsx` passes `backend={runState.backend}` to `SummaryCards`
- [ ] `SessionMetadata` in both `db.ts` and `types.ts` includes `backend: string | null`
- [ ] `getSessionMetadataBatch()` queries `agent:start` events and extracts backend (first match per session)
- [ ] Sidebar session items display backend as a small dimmed label when available
- [ ] Mock server `insertAgentRun()` includes `model` and `backend` fields on synthetic `agent:start` events
