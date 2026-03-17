---
id: plan-02-cli-plugin-docs
name: CLI, Plugin, and Documentation Updates
depends_on: [plan-01-engine-enqueue]
branch: minimal-plugin-skill-api-enqueue-run-status/cli-plugin-docs
---

# CLI, Plugin, and Documentation Updates

## Architecture Context

With the engine enqueue foundation in place (plan-01), this plan wires the new `engine.enqueue()` into the CLI and plugin surface. The CLI gets a new `eforge enqueue` command, the `run` command loses `--adopt`, and the plugin collapses from 7 skills to 6 (removing `plan` and `queue`, adding `enqueue`). The `run` command flow changes from `compile(source)` to `enqueue(source) -> compile(queuedFile) -> build(planSet)`.

## Implementation

### Overview

1. Add `eforge enqueue <source>` CLI command
2. Update `eforge run` - remove `--adopt`, add `--queue`, wire through enqueue
3. Add display renderers for `enqueue:start` and `enqueue:complete`
4. Create `/eforge:enqueue` plugin skill
5. Update `/eforge:run` plugin skill (remove adopt, add --queue)
6. Update `/eforge:status` plugin skill (show queue state, update references)
7. Delete `/eforge:plan` and `/eforge:queue` plugin skills
8. Update `plugin.json` (remove plan/queue, add enqueue, bump version to 1.4.0)
9. Update `CLAUDE.md` and `README.md`

### Key Decisions

1. **`run <source>` flow change** - The `run` action becomes: enqueue(source) -> get queued file path -> compile(queuedFile) -> build(planSet). This means every `run` invocation creates a formatted PRD in the queue before compiling. The enqueue events are rendered inline during the run flow.
2. **`--queue` flag on run** - When `--queue` is present, `<source>` becomes optional and the command delegates to `engine.runQueue()`. This provides backwards compat with `eforge queue run`.
3. **`eforge queue run` stays** - Keep `eforge queue list` and `eforge queue run` as-is for backwards compat. The `queue` subcommand group still exists.
4. **Plugin version bump to 1.4.0** - Breaking change (removing skills), so minor version bump per convention.
5. **Display exhaustiveness** - The `renderEvent()` switch in `display.ts` uses a `never` default for exhaustiveness. Adding `enqueue:start`/`enqueue:complete` cases and removing `phase:start` adopt handling keeps the exhaustive check working.

## Scope

### In Scope
- New CLI command: `eforge enqueue <source>`
- CLI `run` command: remove `--adopt` flag, add `--queue` flag, make `<source>` optional when `--queue` present, wire run flow through enqueue
- Display: add `enqueue:start` and `enqueue:complete` renderers
- New plugin skill: `eforge-plugin/skills/enqueue/enqueue.md`
- Update plugin skill: `eforge-plugin/skills/run/run.md`
- Update plugin skill: `eforge-plugin/skills/status/status.md`
- Delete plugin skill: `eforge-plugin/skills/plan/plan.md` (and directory)
- Delete plugin skill: `eforge-plugin/skills/queue/queue.md` (and directory)
- Update `eforge-plugin/.claude-plugin/plugin.json`
- Update `CLAUDE.md` (CLI commands, agent list, plugin description)
- Update `README.md` (skills table, CLI usage, mermaid flowchart, common flags)

### Out of Scope
- Engine changes (completed in plan-01)
- Monitor UI changes
- Eval harness changes

## Files

### Create
- `eforge-plugin/skills/enqueue/enqueue.md` - Plugin skill for `/eforge:enqueue`. Frontmatter: `description: "Normalize any input and add it to the eforge queue"`, `argument-hint: "<source>"`, `disable-model-invocation: true`. Workflow: validate source from `$ARGUMENTS` (file path or check conversation for plan file); run `eforge enqueue <source>` via Bash; report title and queue location; suggest `/eforge:run --queue` or `/eforge:run <source>`.

### Modify
- `src/cli/index.ts` - (1) Add `enqueue <source>` command: calls `engine.enqueue(source)`, wraps with session/hooks/monitor, consumes events via `consumeEvents()`, prints result. (2) Update `run` command: remove `--adopt` option, add `--queue` option, make `<source>` argument optional (use `[source]` syntax). When `--queue` is present and no `<source>`, delegate to `engine.runQueue()`. When `<source>` is present, change flow to: consume enqueue events -> get file path from `enqueue:complete` event -> compile(filePath) -> build(planSet). Remove the `options.adopt` ternary that chose between `engine.adopt()` and `engine.compile()`. (3) Remove the `adopt` import and `AdoptOptions` references. (4) Update the run command description to remove adopt mention.
- `src/cli/display.ts` - (1) Add `case 'enqueue:start'`: log `Enqueuing from ${chalk.cyan(event.source)}...` with a spinner. (2) Add `case 'enqueue:complete'`: succeed spinner with `Enqueued: ${chalk.cyan(event.title)} -> ${chalk.dim(event.filePath)}`. (3) In the `phase:start` case, the `event.command` union no longer includes `'adopt'` - remove any adopt-specific handling if present (currently none - the same display applies).
- `eforge-plugin/skills/run/run.md` - Remove `--adopt` from arguments and all adopt inference logic (auto-detection of `~/.claude/plans/`, prior `/plan` session). Add `--queue` to arguments. When `--queue`: invoke `eforge run --queue --auto --verbose`. Replace `/eforge:plan` references with `/eforge:enqueue`. Simplify the monitor message to one variant (remove adopt-specific explanation). Update the lifecycle description to: Enqueue -> Profile selection -> Planning -> Plan review -> Building -> Code review -> Merging -> Validation.
- `eforge-plugin/skills/status/status.md` - After build state display, add queue state section: use Glob to find PRDs in `docs/prd-queue/`, parse frontmatter, show pending count. Replace any `/eforge:plan` references with `/eforge:enqueue`.
- `eforge-plugin/.claude-plugin/plugin.json` - Remove `./skills/plan/plan.md` and `./skills/queue/queue.md` from skills array. Add `./skills/enqueue/enqueue.md`. Bump `version` from `"1.3.0"` to `"1.4.0"`.
- `CLAUDE.md` (project root) - Update CLI commands section: add `eforge enqueue <source>`, remove `--adopt` from `eforge run`. Update agent loop description to include Formatter. Update plugin description to reflect 3 primary skills (enqueue, run, status) + roadmap skills. Add Formatter to the agent list.
- `README.md` - (1) Plugin skills table (~line 93): add `/eforge:enqueue` row with description "Normalize input and add to queue". (2) CLI Usage (~line 100): add `eforge enqueue docs/my-feature.md` example, remove `eforge run docs/my-feature.md --adopt` example. (3) Mermaid flowchart (~line 29): add enqueue/formatter step: `Start --> Formatter["Formatter"] --> Queue["Queue"] --> Planner` (replacing `Start --> Planner`). (4) Common flags table (~line 117): remove `--adopt` if listed (it's not currently in the table, but verify), add `--queue` with description "Process all PRDs from the queue".

### Delete
- `eforge-plugin/skills/plan/plan.md` - Replaced by `/eforge:enqueue`
- `eforge-plugin/skills/queue/queue.md` - Queue viewing merged into `/eforge:status`; queue running via `/eforge:run --queue`

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes - all existing tests still green
- [ ] `pnpm build` succeeds without errors
- [ ] `eforge-plugin/.claude-plugin/plugin.json` lists exactly 6 skills: enqueue, run, status, roadmap-init, roadmap, roadmap-prune
- [ ] `eforge-plugin/.claude-plugin/plugin.json` version is `"1.4.0"`
- [ ] `eforge-plugin/skills/plan/` directory does not exist
- [ ] `eforge-plugin/skills/queue/` directory does not exist
- [ ] `eforge-plugin/skills/enqueue/enqueue.md` exists with `disable-model-invocation: true`
- [ ] `src/cli/index.ts` has no references to `--adopt` or `engine.adopt`
- [ ] `src/cli/index.ts` registers an `enqueue` command
- [ ] `src/cli/display.ts` handles `enqueue:start` and `enqueue:complete` event types
- [ ] `display.ts` exhaustive switch compiles (no `never` type errors)
- [ ] README.md mermaid flowchart includes a Formatter/Queue step before Planner
- [ ] README.md CLI usage section includes `eforge enqueue` example
- [ ] README.md does not reference `--adopt`
- [ ] CLAUDE.md lists Formatter in the agent descriptions
