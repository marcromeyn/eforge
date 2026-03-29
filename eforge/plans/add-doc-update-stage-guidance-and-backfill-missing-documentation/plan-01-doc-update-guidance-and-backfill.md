---
id: plan-01-doc-update-guidance-and-backfill
name: Doc-update Stage Guidance and Documentation Backfill
depends_on: []
branch: add-doc-update-stage-guidance-and-backfill-missing-documentation/doc-update-guidance-and-backfill
---

# Doc-update Stage Guidance and Documentation Backfill

## Architecture Context

The planner prompt (`planner.md`) has a "Test stage guidance" block (lines 368-372) that tells the planner when to include/omit test stages. No equivalent block exists for `doc-update`, causing the planner to inconsistently omit the stage for user-facing changes. The same gap exists in `module-planner.md`. Additionally, `docs/config.md` and `CLAUDE.md` are stale - missing coverage of Pi backend, tester agent, daemon CLI, and several config sections.

## Implementation

### Overview

Add a "Doc-update stage guidance" section to both planner prompts (mirroring the test stage guidance pattern), then backfill missing documentation in `docs/config.md` and `CLAUDE.md`.

### Key Decisions

1. Place doc-update guidance immediately after the test stage guidance block in both prompts to maintain the pattern of stage-specific guidance sections grouped together.
2. Default to including `doc-update` since the doc-updater is cheap (emits `count="0"` if nothing needs updating) - the guidance lists explicit omission criteria rather than inclusion criteria.
3. Keep CLAUDE.md additions minimal - 2-line entries for new agents, inline additions to existing lists - rather than restructuring existing sections.

## Scope

### In Scope

- `src/engine/prompts/planner.md` - add doc-update stage guidance block after line 372
- `src/engine/prompts/module-planner.md` - add doc-update stage guidance block after line 163
- `docs/config.md` - add `backend`, `pi`, `daemon`, and `autoBuild` config sections
- `CLAUDE.md` - add test build stages, tester/test-writer agents, daemon CLI commands, update agent file count, add `pi` to merge strategy list

### Out of Scope

- Changes to engine code or agent implementations
- Restructuring existing documentation sections

## Files

### Modify

- `src/engine/prompts/planner.md` - Insert "Doc-update stage guidance" section after line 372 (after the "Test stage guidance" block). Content:
  - Include `doc-update` (parallel with `implement`) when the plan changes: CLI commands, config schema/defaults, agent behavior, pipeline stages, public API surface, or architecture
  - Omit for: pure bug fixes, test-only changes, internal refactors with no user-facing impact
  - Default to including it - the doc-updater emits `count="0"` if no updates are needed
  - Example patterns: `build: [[implement, doc-update], review-cycle]` for user-facing changes, `build: [implement, review-cycle]` for internal changes

- `src/engine/prompts/module-planner.md` - Insert matching doc-update stage guidance after line 163 (after the build/review config tailoring paragraph). Same rules as planner.md, adapted for module context. Add to the existing examples: "For modules with user-facing changes, include `doc-update` parallel with `implement`: `[[implement, doc-update], review-cycle]`"

- `docs/config.md` - Add the following sections to the `eforge/config.yaml` code block and surrounding documentation:
  - `backend` field: `'claude-sdk' | 'pi'`, default `'claude-sdk'`. Controls which LLM backend the engine uses.
  - `pi` section: `provider` (default `'openrouter'`), `model` (default `'anthropic/claude-sonnet-4'`), `thinkingLevel` (`'medium'`), `extensions.autoDiscover` (`true`), `compaction.enabled` (`true`), `compaction.threshold` (`100_000`), `retry.maxRetries` (`3`), `retry.backoffMs` (`1000`). Add note that Pi backend is experimental/untested.
  - `daemon` section: `idleShutdownMs` (default `7_200_000` / 2 hours). Set to `0` to disable and run forever.
  - `autoBuild` in `prdQueue`: `true` (daemon automatically builds after enqueue)
  - Brief "Pi Backend" paragraph covering `PI_API_KEY` env var and provider-specific API key resolution
  - Add `pi` to the config merge strategy object list in the "Config Layers" section

- `CLAUDE.md` - Add the following:
  - In the "Build stages" line (line 42): append `test-write`, `test`, `test-fix`, `test-cycle` to the existing list
  - After the `review-cycle` composite stage note (line 44): add `test-cycle` composite stage explanation
  - In the agent list (lines 59-75): add Tester and Test Writer agents (2 lines each, following existing format)
  - In CLI commands section (lines 174-186): add `eforge daemon start/stop/status/kill` commands
  - In project structure agents comment (line 104): update "15 agent files" to "17 agent files" (there are 17 files in `src/engine/agents/` including `common.ts` and `tester.ts`)
  - In merge strategy section (line 133): add `pi` to the object sections list

## Verification

- [ ] `src/engine/prompts/planner.md` contains a "Doc-update stage guidance" section immediately after the "Test stage guidance" block (after line 372) with inclusion criteria (CLI commands, config schema, agent behavior, pipeline stages, API surface, architecture), omission criteria (bug fixes, test-only, internal refactors), and a default-to-include rule
- [ ] `src/engine/prompts/module-planner.md` contains equivalent doc-update guidance after line 163 with the same rules adapted for module context
- [ ] `docs/config.md` contains `backend: 'claude-sdk'` field with `'claude-sdk' | 'pi'` type documentation
- [ ] `docs/config.md` contains `pi` section with all 6 sub-fields (`provider`, `model`, `thinkingLevel`, `extensions`, `compaction`, `retry`) and defaults matching `DEFAULT_CONFIG` in `src/engine/config.ts`
- [ ] `docs/config.md` contains `daemon` section with `idleShutdownMs: 7_200_000` default
- [ ] `docs/config.md` contains `autoBuild: true` under `prdQueue` section
- [ ] `CLAUDE.md` build stages line includes `test-write`, `test`, `test-fix`, `test-cycle`
- [ ] `CLAUDE.md` agent list includes Tester and Test Writer entries
- [ ] `CLAUDE.md` CLI commands section includes `eforge daemon start`, `eforge daemon stop`, `eforge daemon status`, `eforge daemon kill`
- [ ] `CLAUDE.md` agent file count reads "17 agent files" (matching actual count in `src/engine/agents/`)
- [ ] `CLAUDE.md` merge strategy object sections list includes `pi`
- [ ] `pnpm type-check` passes
- [ ] `pnpm build` passes
