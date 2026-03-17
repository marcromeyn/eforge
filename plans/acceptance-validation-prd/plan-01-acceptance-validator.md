---
id: plan-01-acceptance-validator
name: Acceptance Validation Agent
depends_on: []
branch: acceptance-validation-prd/acceptance-validator
---

# Acceptance Validation Agent

## Architecture Context

eforge's build pipeline runs named stages per-plan in worktrees. Post-merge, the orchestrator runs mechanical validation (type-check, tests) with an optional fix cycle. No agent currently compares the implementation diff against the original PRD to verify requirement fulfillment.

This plan adds an `accept` build stage - a one-shot query agent that reads the PRD source and the plan's diff, extracts requirements from the PRD, and produces a structured pass/fail/partial assessment per requirement with evidence. It follows the same agent runner pattern as `plan-reviewer.ts` and `validation-fixer.ts`.

The acceptance validator runs per-plan in the worktree (not post-merge), using `git diff {baseBranch}...HEAD` to get the plan's changes. For errands this is the full diff; for expeditions each plan validates its own module's changes. This fits cleanly into the existing build stage architecture without special orchestrator integration.

## Implementation

### Overview

Add the acceptance validation agent end-to-end: events, XML parser, agent runner, prompt, build stage, config fields, CLI display, and monitor UI support.

### Key Decisions

1. **Per-plan build stage, not post-merge** - The `accept` stage runs in the per-plan build pipeline using the worktree's diff against the base branch. This avoids special orchestrator plumbing and works identically for errands and expeditions. The orchestrator's post-merge validation remains mechanical-only.

2. **Informational by default, strict mode opt-in** - `acceptanceMode: 'report'` (default) emits events but does not fail the build. `acceptanceMode: 'strict'` marks the build as failed when any requirement has status `fail`. This is configured via `review.acceptanceMode` in the profile, extending the existing `ReviewProfileConfig`.

3. **One-shot query with tool access** - The agent gets `tools: 'coding'` so it can read files beyond the diff when needed (e.g., verifying a config file was wired up, checking test coverage). This matches the plan-reviewer pattern.

4. **XML output parsed by engine** - The agent emits `<acceptance-validation>` XML blocks. A new `parseAcceptanceResults()` function in `common.ts` extracts structured results, following the same defensive regex pattern as `parseClarificationBlocks()` and `parseModulesBlock()`.

5. **New `AgentRole` value** - `'acceptance-validator'` is added to the `AgentRole` union in `events.ts` and to `VALID_AGENT_ROLES` sets in `config.ts`. This enables per-agent config overrides (maxTurns, model, prompt) through the profile system.

6. **Built-in profiles include `accept` by default** - All three built-in profiles (errand, excursion, expedition) get `accept` appended to their build stage lists. Custom profiles can omit it for speed.

## Scope

### In Scope
- `AcceptanceRequirement` interface (status, description, evidence fields)
- Three new event types: `accept:start`, `accept:requirement`, `accept:complete`
- XML parser for `<acceptance-validation>` blocks in `common.ts`
- Agent runner in `acceptance-validator.ts` following plan-reviewer pattern
- Prompt file `acceptance-validator.md` with PRD source, diff, and structured output instructions
- `accept` build stage registered in `pipeline.ts`
- `acceptanceMode` field added to `ReviewProfileConfig` (`'report' | 'strict'`, default `'report'`)
- `acceptance-validator` added to `AgentRole` union and all `VALID_AGENT_ROLES` sets
- Built-in profiles updated to include `accept` in build stages
- CLI display rendering for all three acceptance events
- Monitor UI event card summaries for acceptance events
- Unit tests for XML parser and agent wiring

### Out of Scope
- Acceptance failures triggering the validation fixer (future work)
- Eval framework integration for acceptance results as quality signals
- Planner generating explicit acceptance criteria during planning
- Post-merge aggregate acceptance validation across multiple plans

## Files

### Create
- `src/engine/agents/acceptance-validator.ts` — One-shot query agent runner. Loads prompt with PRD source and diff, runs backend, parses XML output, yields acceptance events. ~60-80 lines following plan-reviewer pattern.
- `src/engine/prompts/acceptance-validator.md` — Prompt template. Receives `{{source_content}}` (PRD), `{{diff}}` (git diff output), `{{plan_content}}` (plan file body). Instructs agent to extract requirements from PRD, check each against the diff and codebase, emit `<acceptance-validation>` XML with per-requirement status/evidence.

### Modify
- `src/engine/events.ts` — Add `'acceptance-validator'` to `AgentRole` union type. Add `AcceptanceRequirement` interface (`status: 'pass' | 'fail' | 'partial'`, `description: string`, `evidence: string`). Add three event types to `EforgeEvent` union: `accept:start` (with `planId`), `accept:requirement` (with `planId`, `requirement: AcceptanceRequirement`), `accept:complete` (with `planId`, `requirements: AcceptanceRequirement[]`, `passed: boolean`).
- `src/engine/agents/common.ts` — Add `parseAcceptanceResults()` function. Parses `<acceptance-validation><requirement status="..."><description>...</description><evidence>...</evidence></requirement></acceptance-validation>` XML blocks into `AcceptanceRequirement[]`. Defensive regex parsing, returns empty array on malformed input.
- `src/engine/pipeline.ts` — Import `runAcceptanceValidator` from new agent file. Register `accept` build stage. Stage gets diff via `git diff {baseBranch}...HEAD` in worktree, reads source content and plan body from context, calls agent, yields events. Checks `ctx.profile.review.acceptanceMode` - if `'strict'` and any requirement failed, sets `ctx.buildFailed = true`.
- `src/engine/config.ts` — Add `acceptanceMode?: 'report' | 'strict'` to `ReviewProfileConfig`. Add `'acceptance-validator'` to both `VALID_AGENT_ROLES` (parsing set, line ~306) and `VALID_AGENT_ROLES_SET` (validation set, line ~601). Add `'report'` and `'strict'` to acceptance mode parsing in `parseRawConfig()`. Add `acceptanceMode` validation in `validateProfileConfig()` using a `VALID_ACCEPTANCE_MODES_SET` (reject values other than `'report'` or `'strict'`). Update `DEFAULT_BUILD_STAGES` to include `'accept'` after `'evaluate'`. Add `acceptanceMode` to `DEFAULT_REVIEW` with value `'report'`.
- `src/cli/display.ts` — Add three cases to `renderEvent()` switch: `accept:start` updates build spinner text to "acceptance validation..."; `accept:requirement` logs per-requirement line with colored status (green pass, red fail, yellow partial) and evidence; `accept:complete` logs summary with pass/fail/partial counts.
- `src/monitor/ui/src/components/timeline/event-card.tsx` — Add `eventSummary()` cases for `accept:start`, `accept:requirement`, `accept:complete`. Add classification in `classifyEvent()` for the new event types.
- `src/monitor/mock-server.ts` — Add sample acceptance events to mock data if mock events are defined there (for monitor development).

### Test
- `test/xml-parsers.test.ts` — Add tests for `parseAcceptanceResults()`: well-formed XML with pass/fail/partial statuses, empty block, malformed XML, missing fields, multiple requirements.
- `test/agent-wiring.test.ts` — Add acceptance validator wiring tests using `StubBackend`: verify events emitted in correct order (`accept:start` → `agent:*` → `accept:requirement` per result → `accept:complete`), verify prompt includes source content and diff, verify strict mode sets `buildFailed`, verify report mode does not set `buildFailed`.
- `test/pipeline.test.ts` — Add test that `accept` stage is registered and callable, verify it appears in default build stage list.

## Verification

- [ ] `pnpm type-check` exits 0 with no new type errors
- [ ] `pnpm test` exits 0 with all existing tests passing
- [ ] `parseAcceptanceResults()` returns 3 requirements from XML containing one pass, one fail, one partial status
- [ ] `parseAcceptanceResults()` returns empty array for malformed XML (missing tags, no block)
- [ ] `runAcceptanceValidator()` yields `accept:start` as first non-agent event and `accept:complete` as last non-agent event
- [ ] `accept:complete` event contains `passed: true` when all requirements have status `pass` or `partial`
- [ ] `accept:complete` event contains `passed: false` when any requirement has status `fail`
- [ ] `accept` build stage is registered and returned by `getBuildStageNames()`
- [ ] Built-in profiles (errand, excursion, expedition) all include `'accept'` in their `build` arrays
- [ ] `ReviewProfileConfig.acceptanceMode` defaults to `'report'` when not specified in config
- [ ] When `acceptanceMode` is `'strict'` and a requirement fails, the build stage sets `ctx.buildFailed = true`
- [ ] When `acceptanceMode` is `'report'` and a requirement fails, `ctx.buildFailed` remains falsy
- [ ] `renderEvent()` handles all three acceptance event types without hitting the `never` default case
- [ ] `'acceptance-validator'` is accepted as a valid agent role in profile config parsing
