---
title: Remove `plan:scope` — redundant with `plan:profile`
created: 2026-03-18
status: pending
---

## Problem / Motivation

`plan:scope` and `plan:profile` are two separate events emitted by the planner agent. Scope classifies work complexity (errand/excursion/expedition/complete), while profile selects the workflow pipeline. They share the same EEE vocabulary, which causes confusion - e.g., "scope: errand, profile: excursion" reads contradictory even though it's coherent. Since custom profiles can have arbitrary names beyond the EEE set, scope becomes actively misleading. The profile rationale already communicates the planner's complexity judgment, making scope redundant. No pipeline logic branches on scope - it's purely display.

## Goal

Remove the `plan:scope` event entirely - type definitions, XML parsing, emission logic, rendering, and tests - leaving `plan:profile` as the sole mechanism for communicating the planner's workflow selection and complexity judgment.

Replace the `complete` scope assessment's early-exit behavior with a new `plan:skip` event. When the planner determines that the source is already fully implemented, it emits `<skip>reason</skip>` instead of writing plan files. The CLI and monitor render this event and exit early without building.

## Approach

Systematic removal across seven layers of the codebase:

1. **Type definitions and constants** (`src/engine/events.ts`, `src/engine/index.ts`): Remove `SCOPE_ASSESSMENTS` constant, `ScopeAssessment` type, and `plan:scope` variant from the `EforgeEvent` union. Remove `ScopeAssessment` export.

2. **XML parsing** (`src/engine/agents/common.ts`): Remove `ScopeDeclaration` interface, `VALID_ASSESSMENTS` set, `parseScopeBlock()` function, and related imports.

3. **Planner emission logic** (`src/engine/agents/planner.ts`): Remove `scopeEmitted` flag and all `plan:scope` emission logic, including the fallback that derives `plan:scope` from profile name. Remove related imports. Add `<skip>` XML block parsing and `plan:skip` event emission. In `src/engine/prompts/planner.md`, replace scope assessment instructions with `<skip>` block instructions for the "already complete" case.

4. **Pipeline context** (`src/engine/pipeline.ts`): Remove `scopeAssessment` field from `PipelineContext`, remove `ScopeAssessment` import, and remove hardcoded `plan:scope` emission in the `prd-passthrough` stage.

5. **CLI early-exit** (`src/cli/index.ts`): Replace the `plan:scope`/`scopeComplete` early-exit logic with a `plan:skip` check. The CLI should exit early (success) when it receives `plan:skip`.

6. **CLI/monitor rendering**:
   - `src/cli/display.ts`: Remove `plan:scope` case, add `plan:skip` case.
   - `src/monitor/ui/src/lib/types.ts`: Remove `ScopeAssessment` import if no longer needed.
   - `src/monitor/ui/src/components/timeline/event-card.tsx`: Remove `plan:scope` from event type classification and display handler, add `plan:skip`.
   - `src/monitor/mock-server.ts`: Replace mock `plan:scope` event insertions with `plan:skip` where the assessment was `complete`, remove the rest.

7. **Tests**:
   - `test/agent-wiring.test.ts`: Remove scope-related test cases, add `plan:skip` wiring test.
   - `test/xml-parsers.test.ts`: Remove `parseScopeBlock` tests, add `parseSkipBlock` tests.
   - `test/pipeline.test.ts`: Remove `ScopeAssessment` import.

8. **Plugin version**: Bump version in `eforge-plugin/.claude-plugin/plugin.json` if any plugin code references scope (verify first - likely no change needed).

## Scope

**In scope:**
- Removing all `plan:scope`-related code: types, constants, parsing, emission, rendering, tests, and mock data
- Removing scope assessment instructions from the planner prompt
- Adding `plan:skip` event type with `reason` field
- Adding `<skip>` XML block parsing in planner agent
- Replacing CLI early-exit logic (`src/cli/index.ts`) to use `plan:skip` instead of `plan:scope`/`complete`
- Rendering `plan:skip` in CLI display and monitor

**Out of scope:**
- Changes to `plan:profile` event or profile selection logic
- Pipeline or agent workflow changes beyond the skip signal

## Acceptance Criteria

- `pnpm type-check` passes with no type errors
- `pnpm test` passes - all tests pass
- `pnpm build` produces a clean bundle
- No references to `ScopeAssessment`, `SCOPE_ASSESSMENTS`, `parseScopeBlock`, `ScopeDeclaration`, `VALID_ASSESSMENTS`, or `plan:scope` remain in `src/` or `test/`
- Planner prompt no longer instructs the agent to emit a `<scope>` XML block
- Planner prompt instructs the agent to emit `<skip>reason</skip>` when the source is already fully implemented
- `plan:skip` event type exists in `events.ts` with a `reason: string` field
- CLI exits early (code 0) on `plan:skip` event
