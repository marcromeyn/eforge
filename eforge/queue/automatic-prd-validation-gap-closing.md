---
title: Automatic PRD Validation Gap Closing
created: 2026-04-01
---

# Automatic PRD Validation Gap Closing

## Problem / Motivation

When PRD validation (the final build step) finds gaps between the PRD and implementation, the build fails immediately. For long builds (1h+, millions of tokens), this is painful because the gaps are often small and could be automatically fixed. No recovery is attempted today - the build simply stops and the user must manually intervene or restart.

Current flow:

```
executePlans -> validate -> prdValidate -> finalize
```

When `prdValidate` finds gaps, it sets `state.status = 'failed'` and the build stops.

## Goal

Add a single automatic gap-closing attempt before failing the build, so that small PRD validation gaps can be resolved without wasting an entire long-running build.

## Approach

New flow:

```
executePlans -> validate -> prdValidate -> [if gaps + gapCloser: gapClose -> validate] -> finalize
```

When `prdValidate` finds gaps and a `gapCloser` callback is available:
1. Run a gap closer agent (implements fixes directly in merge worktree)
2. Re-run post-merge validation (type-check, tests) to verify changes
3. Proceed to finalize if validation passes
4. Only one attempt - no re-running PRD validation after gap closing

### Key Design Decisions

- **Inline modification of `prdValidate`** (not a new phase) - the gap closer is tightly coupled to PRD validation and needs the gaps data. Follows the pattern of `validate` calling `validationFixer` inline.
- **Re-validation via orchestrator sequencing** - after `prdValidate` sets `gapClosePerformed`, the orchestrator re-runs `validate`. This avoids duplicating validation logic.
- **Always enabled when PRD validation is enabled** - no separate config toggle. If you have `prdFilePath`, you get gap closing.
- **One attempt only** - a `gapClosePerformed` flag prevents re-entry.
- **No re-running PRD validation** - gap closing is the final attempt; post-merge validation confirms nothing broke.

### Event Flow (Success Case)

```
validation:complete { passed: true }       -- initial post-merge validation passes
prd_validation:start                       -- PRD validation begins
prd_validation:complete { passed: false }  -- gaps found
gap_close:start                            -- gap closer begins
agent:start { agent: 'gap-closer' }        -- agent runs with coding tools
agent:stop                                 -- agent finishes
gap_close:complete                         -- gap closer done
validation:start                           -- re-run post-merge validation
validation:complete { passed: true }       -- validation passes
merge:finalize:start                       -- finalize proceeds
merge:finalize:complete                    -- build succeeds
```

### Files to Create

#### 1. `src/engine/agents/gap-closer.ts`
New agent following the `validation-fixer.ts` pattern:
- `GapCloserOptions` interface (backend, cwd, gaps, prdContent, verbose, abortController)
- `runGapCloser()` async generator yielding `EforgeEvent`s
- Formats gaps into prompt context, runs agent with `tools: 'coding'`, `maxTurns: 30`
- Emits `gap_close:start` and `gap_close:complete` events
- Agent errors are non-fatal (catch and continue, re-throw AbortError)

#### 2. `src/engine/prompts/gap-closer.md`
Prompt template with `{{prd}}`, `{{gaps}}`, `{{attribution}}` placeholders. Instructs the agent to:
- Read each gap and understand what requirement is not satisfied
- Explore relevant source files
- Make minimal targeted changes to close gaps
- Run validation commands to verify
- Commit all changes in a single commit

### Files to Modify

#### 3. `src/engine/events.ts`
- Add `'gap-closer'` to the `AgentRole` union (line 10)
- Add two event variants after `prd_validation:complete` (line 244):
  ```
  | { type: 'gap_close:start' }
  | { type: 'gap_close:complete' }
  ```

#### 4. `src/engine/orchestrator.ts`
- Add `GapCloser` callback type (after `PrdValidator` type, ~line 52):
  ```typescript
  export type GapCloser = (cwd: string, gaps: PrdValidationGap[]) => AsyncGenerator<EforgeEvent>;
  ```
- Add `gapCloser?: GapCloser` to `OrchestratorOptions`
- Pass `gapCloser` into `PhaseContext` construction (~line 153)
- Modify `execute()` sequencing (~lines 158-162): after `prdValidate`, if `ctx.gapClosePerformed` is true and state is not failed, re-run `validate` before `finalize`

#### 5. `src/engine/orchestrator/phases.ts`
- Add to `PhaseContext` interface:
  - `gapCloser?: GapCloser` (import type from orchestrator)
  - `gapClosePerformed: boolean`
- Modify `prdValidate()` function (~lines 492-513):
  - Capture gaps from `prd_validation:complete` event instead of immediately failing
  - If gaps found and `gapCloser` available: call gap closer, set `ctx.gapClosePerformed = true`
  - Only set `state.status = 'failed'` if no gap closer or gap closer errored

#### 6. `src/engine/eforge.ts`
- Import `runGapCloser` from `./agents/gap-closer.js`
- Import `GapCloser` type from orchestrator
- Create gap closer closure (~after line 646) following the PRD validator pattern:
  - Only created when `options.prdFilePath` is provided (same condition as prdValidator)
  - Reads PRD content, creates tracing span, wraps `runGapCloser()`
- Pass `gapCloser` to `Orchestrator` constructor

#### 7. `src/cli/display.ts`
- Add cases before the `default` exhaustive check (~line 686):
  ```
  case 'gap_close:start': startSpinner('gap-close', 'Closing PRD validation gaps...');
  case 'gap_close:complete': succeedSpinner('gap-close', 'Gap closing complete');
  ```

#### 8. `src/monitor/ui/src/components/timeline/event-card.tsx`
- Add summary cases for `gap_close:start` and `gap_close:complete`
- Add detail case if needed

## Scope

### In Scope
- New gap closer agent (`src/engine/agents/gap-closer.ts`) and prompt (`src/engine/prompts/gap-closer.md`)
- New event types (`gap_close:start`, `gap_close:complete`) and `'gap-closer'` agent role
- Orchestrator and phase modifications to support gap closing and re-validation
- CLI display support for new events
- Monitor UI timeline support for new events
- Unit test (`test/gap-closer.test.ts`) following `test/validation-fixer.test.ts` pattern

### Out of Scope
- Multiple gap-closing attempts (one attempt only)
- Re-running PRD validation after gap closing
- Separate configuration toggle for gap closing (always enabled when PRD validation is enabled)
- Gap closing without PRD validation enabled

## Acceptance Criteria

- When PRD validation finds gaps and gap closing is available, the gap closer agent runs automatically before the build is marked as failed
- The gap closer agent uses coding tools with `maxTurns: 30` and works directly in the merge worktree
- Agent errors in the gap closer are non-fatal (caught and continued, except AbortError which is re-thrown)
- After gap closing completes successfully, post-merge validation (type-check, tests) is re-run automatically
- If re-validation passes, the build proceeds to finalize successfully
- Gap closing runs at most once per build (the `gapClosePerformed` flag prevents re-entry)
- PRD validation is not re-run after gap closing
- Gap closing is automatically enabled whenever `prdFilePath` is provided (no separate config)
- `gap_close:start` and `gap_close:complete` events are emitted and displayed in both CLI (spinners) and monitor UI (timeline)
- `'gap-closer'` is added to the `AgentRole` union in events
- `pnpm type-check` passes with new events handled in all exhaustive switches
- `pnpm build` succeeds (tsup bundles correctly)
- Unit test in `test/gap-closer.test.ts` covers the gap closing flow following the `test/validation-fixer.test.ts` pattern
