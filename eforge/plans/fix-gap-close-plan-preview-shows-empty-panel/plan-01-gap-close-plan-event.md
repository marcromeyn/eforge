---
id: plan-01-gap-close-plan-event
name: Emit and consume gap_close:plan_ready event
dependsOn: []
branch: fix-gap-close-plan-preview-shows-empty-panel/gap-close-plan-event
---

# Emit and consume gap_close:plan_ready event

## Architecture Context

The gap-closer agent generates a plan markdown (Stage 1) then executes it via a synthetic PlanFile (Stage 2). The plan markdown is never emitted as an event, so neither the monitor server's `/api/plans` endpoint nor the client-side `planArtifacts` extraction can find it. The swimlane pill falls through to the `openPreview(planId)` fallback path, which fetches from the API and gets no result - showing "Plan 'gap-close' not found."

The fix adds a `gap_close:plan_ready` event type, emits it between Stage 1 and Stage 2 of the gap-closer, and consumes it in both the server API and the client UI.

## Implementation

### Overview

Five files are modified to thread the gap-close plan through the event system end-to-end:
1. Define the new event variant in the EforgeEvent union
2. Yield it from the gap-closer after plan generation
3. Include it in the server `/api/plans` response
4. Extract it into client-side `planArtifacts` so the swimlane pill uses `openContentPreview`
5. Render summary/detail for the new event type in the timeline event card

### Key Decisions

1. **New event type vs. reusing `plan:complete`** - A dedicated `gap_close:plan_ready` event preserves the semantic distinction between compiled plans and gap-close plans. The gap-close plan has different metadata (gaps array) and lifecycle.
2. **Last event wins for server** - Use `gapCloseEvents[gapCloseEvents.length - 1]` when building the API response, since multiple gap-close rounds may occur and only the latest plan is relevant.
3. **Client deduplication via `seen` set** - The existing pattern in `planArtifacts` useMemo uses a `Set<string>` to deduplicate; the gap-close plan uses id `'gap-close'` which matches the existing swimlane mapping in `thread-pipeline.tsx` (line 100: `'gap-closer': 'gap-close'`).

## Scope

### In Scope
- New `gap_close:plan_ready` event variant in the EforgeEvent discriminated union
- Yielding the event from gap-closer after Stage 1 plan generation
- Server-side inclusion in `/api/plans` response via `servePlans()`
- Client-side extraction into `planArtifacts` in `app.tsx`
- Timeline event card summary and detail rendering for the new event

### Out of Scope
- Changes to gap-closer agent logic (plan generation, gap detection)
- Changes to the PRD validation pipeline
- Other event types or monitor UI panels
- Test changes (no existing tests cover this flow)

## Files

### Modify
- `src/engine/events.ts` - Add `gap_close:plan_ready` variant to EforgeEvent union (after line 251, the existing `gap_close:complete` variant). The variant carries `planBody: string` and `gaps: PrdValidationGap[]` (PrdValidationGap is already defined in this file at line 12).
- `src/engine/agents/gap-closer.ts` - Yield `gap_close:plan_ready` event after Stage 1 plan generation succeeds (after `planMarkdown` is captured at ~line 84, before the Stage 2 execution block at ~line 100). Include `planBody: planMarkdown` and `gaps: options.gaps`.
- `src/monitor/server.ts` - In `servePlans()` (~line 480, after `compiledPlans` extraction from `plan:complete` events), query `gap_close:plan_ready` events via `db.getEventsByTypeForSession()`. If found, parse the last event's data and append a plan entry with `id: 'gap-close'`, `name: 'PRD Gap Close'`, `body: data.planBody`, `dependsOn: []`, `type: 'plan'`.
- `src/monitor/ui/src/app.tsx` - In the `planArtifacts` useMemo (~line 216), add a condition inside the event loop: when `event.type === 'gap_close:plan_ready'` and `'gap-close'` is not in `seen`, add it to `seen` and push `{ id: 'gap-close', name: 'PRD Gap Close', body: event.planBody }` to `plans`.
- `src/monitor/ui/src/components/timeline/event-card.tsx` - In `eventSummary()`, add case for `'gap_close:plan_ready'` returning a summary with gap count. In `eventDetail()`, add case for `'gap_close:plan_ready'` rendering each gap's requirement, explanation, and complexity.

## Verification

- [ ] `pnpm type-check` passes with zero errors (confirms the new event variant is correctly typed across all five files)
- [ ] `pnpm build` completes with exit code 0
- [ ] `pnpm test` passes with zero failures
- [ ] In `src/engine/events.ts`, the EforgeEvent union contains a `gap_close:plan_ready` variant with `planBody: string` and `gaps: PrdValidationGap[]`
- [ ] In `src/engine/agents/gap-closer.ts`, a `gap_close:plan_ready` event is yielded between Stage 1 completion and Stage 2 start
- [ ] In `src/monitor/server.ts`, `servePlans()` queries `gap_close:plan_ready` events and appends a plan with id `'gap-close'` to the response
- [ ] In `src/monitor/ui/src/app.tsx`, `planArtifacts` useMemo extracts plans from `gap_close:plan_ready` events with id `'gap-close'`
- [ ] In event-card.tsx, `eventSummary()` returns a string containing the gap count for `gap_close:plan_ready` events
- [ ] In event-card.tsx, `eventDetail()` returns gap requirement and explanation text for `gap_close:plan_ready` events
