---
title: Fix planner scope assessment + delete unused assessor agent
created: 2026-03-18
status: pending
---

## Problem / Motivation

The planner prompt assesses scope almost entirely based on dependency structure, causing it to classify high-volume mechanical refactors as errands even when they touch 20+ files and exceed builder capacity. Additionally, the assessor agent (`assessor.ts` + `assessor.md`) is dead code - defined but never called from any pipeline stage. The planner already handles scope assessment, profile selection, and plan generation in one pass, making the assessor redundant.

## Goal

Fix the planner's scope assessment to weigh multiple dimensions (dependency structure, execution volume, independence, risk surface) instead of over-indexing on dependencies alone, and delete the unused assessor agent to reduce dead code.

## Approach

### 1. Fix planner scope assessment — `src/engine/prompts/planner.md`

**Replace the scope level table** (lines 79-84). Remove "This is the default" from errand:

```markdown
| Level | Plans | When to use |
|-------|-------|-------------|
| **complete** | 0 | The source document is fully implemented. No gaps remain. Do NOT write any plan files. |
| **errand** | 1 | Focused change in one area. Low execution volume — a handful of files, straightforward edits. |
| **excursion** | 2-3 | Work that benefits from splitting — either dependency ordering, natural independence that enables parallelism, or volume that would strain a single builder session. |
| **expedition** | 4+ | Large initiative spanning multiple subsystems with a meaningful dependency graph. Requires architectural decisions. |
```

**Replace the "Use these concrete indicators" block** (lines 86-93) with multi-dimensional guidance:

```markdown
Weigh these dimensions together — no single dimension determines scope:

| Dimension | What to assess |
|-----------|---------------|
| **Dependency structure** | Do changes need sequencing? Must a migration land before dependent code? Are there ordering constraints between subsystems? |
| **Execution volume** | How many files need edits? How many distinct changes? A builder agent has ~30 turns per session — plans that require many mechanical edits across many files risk exceeding that capacity. |
| **Independence** | Are there natural boundaries where work is independent? Independent targets can be parallelized as separate plans even without dependency edges. |
| **Risk surface** | How many integration points? Are changes to shared/core code involved? Higher risk warrants more review surface. |

Use these file count indicators as real signals, not soft suggestions:

| Indicator | errand | excursion | expedition |
|-----------|--------|-----------|------------|
| Files to change | 1-5 | 5-15 | 15+ |
| Database changes | None | 1-2 migrations | Schema redesign |
| Architecture impact | None | Fits existing | Requires new patterns |
| Integration points | 0-1 | 2-4 | 5+ |
```

**Replace the splitting guidance** (lines 97-106):

```markdown
**Split into multiple plans when:**
- A database migration must complete before dependent code can be built
- Independent subsystems with zero shared files can be parallelized
- There is a genuine dependency ordering that the orchestrator needs to know about
- The total execution volume would strain a single builder session (~30 turns) — split along natural independence boundaries

**Do NOT split when:**
- Different files are involved but the change is genuinely atomic and low-volume
- Backend and frontend changes can be done in one pass
- Tests or docs accompany a feature — they belong in the same plan as the code they test/document
```

**Add independent assessment instruction** after the splitting guidance:

```markdown
**Important**: Assess scope based on your own codebase exploration, not on labels or scope claims in the source document. If a source calls itself an "errand" but your exploration reveals 15+ files need changes, trust your exploration.
```

### 2. Delete dead code

- Delete `src/engine/agents/assessor.ts`
- Delete `src/engine/prompts/assessor.md`
- Delete `test/assessor-wiring.test.ts`

### 3. Remove assessor references from remaining code

- `src/engine/events.ts` — remove `'assessor'` from the `AgentRole` union type (keep `'staleness-assessor'`)
- `src/engine/pipeline.ts` — remove the `assessor: 20` entry from `AGENT_MAX_TURNS_DEFAULTS`
- `src/engine/config.ts` — remove `'assessor'` from the agent role list (keep `'staleness-assessor'`)
- `test/agent-wiring.test.ts` — remove the unused `import { runAssessor }` line

### 4. Update CLAUDE.md

Remove the Assessor from the agent list and update the agent count.

## Scope

**In scope:**
- Rewriting the planner prompt's scope assessment guidance to be multi-dimensional
- Deleting the assessor agent (`assessor.ts`, `assessor.md`, `assessor-wiring.test.ts`)
- Removing all `'assessor'` references from types, config, pipeline, and tests
- Updating CLAUDE.md to reflect the removal

**Out of scope:**
- Changes to the `staleness-assessor` agent (different, active agent)
- Changes to planner logic outside of scope assessment
- Any other agent modifications

## Acceptance Criteria

1. `pnpm type-check` passes
2. `pnpm test` passes
3. No references to `assessor.ts` or `assessor.md` remain in the codebase (except `staleness-assessor` references)
4. The planner prompt includes multi-dimensional scope guidance covering dependency structure, execution volume, independence, and risk surface
5. The planner prompt includes file count indicator table with concrete thresholds per scope level
6. The planner prompt includes the independent assessment instruction (trust exploration over source labels)
7. `src/engine/agents/assessor.ts`, `src/engine/prompts/assessor.md`, and `test/assessor-wiring.test.ts` are deleted
8. `'assessor'` is removed from `AgentRole` in `events.ts`, from `AGENT_MAX_TURNS_DEFAULTS` in `pipeline.ts`, and from the agent role list in `config.ts`
9. CLAUDE.md agent list no longer includes the Assessor and the agent count is updated
