---
id: plan-02-cli-plugin-tests
name: PRD Queue CLI, Plugin, and Tests
depends_on: [plan-01-engine-core]
branch: prd-queue-management/cli-plugin-tests
---

# PRD Queue CLI, Plugin, and Tests

## Architecture Context

The CLI is a thin consumer that iterates engine event streams and renders to stdout via `display.ts`. Commands use commander.js. The plugin provides conversational skills for Claude Code - thin facilitators that use Read/Grep/Glob tools, not CLI invocations. Tests follow vitest patterns with `StubBackend` for agent wiring tests and direct function calls for unit tests. The exhaustive `never` default in `renderEvent()` means all new event types must have display cases or TypeScript will error.

## Implementation

### Overview

Add `eforge queue list` and `eforge queue run` CLI commands, display rendering for all 6 `queue:*` events, update the `/eforge:plan` skill to output to the queue directory with frontmatter, add a new `/eforge:queue` skill, and write tests for PRD parsing/ordering, staleness XML parsing, staleness agent wiring, and config.

### Key Decisions

1. **`queue` as a parent command with subcommands** - `eforge queue list` and `eforge queue run [name]` mirror the existing command structure. `queue run` reuses the same `withMonitor`, `wrapEvents`, `consumeEvents` patterns as the `run` command.
2. **`renderQueueList()` as a standalone function** - Separated from `renderEvent()` since it's called directly by the `list` command, not via the event stream.
3. **Plugin version bump to 1.3.0** - Any plugin change requires a version bump per project conventions.
4. **Test organization** - PRD queue tests in `test/prd-queue.test.ts` (new file), staleness parser tests added to `test/xml-parsers.test.ts`, staleness agent wiring in `test/staleness-assessor.test.ts` (new file), config tests added to `test/config.test.ts`.

## Scope

### In Scope
- `eforge queue list` command: loads queue, renders table
- `eforge queue run [name]` command: creates engine, iterates `engine.runQueue()`, renders events. Flags: `--all`, `--auto`, `--verbose`, `--no-monitor`, `--no-plugins`, `--parallelism`
- Display rendering for all `queue:*` events in `renderEvent()`
- `renderQueueList()` function: table grouped by status, columns for priority/title/created/stale days/depends_on, color-coded stale days
- Update `/eforge:plan` skill: default output to `docs/prd-queue/<name>.md`, include frontmatter with `title`, `created`, `priority`, `status: pending`
- New `/eforge:queue` skill: reads queue directory, parses frontmatter, shows pending PRDs, suggests next actions
- Plugin manifest: add queue skill, bump version to 1.3.0
- Tests: PRD frontmatter validation, queue ordering, status filtering, `updatePrdStatus`, `parseStalenessBlock`, staleness agent wiring, `prdQueue` config

### Out of Scope
- Engine core implementation (plan-01)
- Changes to existing agent implementations
- Monitor dashboard changes for queue events

## Files

### Create
- `eforge-plugin/skills/queue/queue.md` - Thin skill that reads the queue directory (Read + Glob tools), parses YAML frontmatter from each `.md` file, displays pending PRDs with staleness info (days since last commit), and suggests next actions (`eforge queue run <name>` or `eforge queue run --all`). No CLI invocation.
- `test/prd-queue.test.ts` - Tests for: frontmatter validation (valid, missing title, missing created, invalid status, extra fields ignored), queue ordering (priority sort, dependency waves, priority + deps combined, cycle detection delegates to `resolveDependencyGraph`), status filtering (only `pending` PRDs queued), `updatePrdStatus` (status line replacement, insertion when absent). Uses vitest, constructs test data inline.
- `test/staleness-assessor.test.ts` - Agent wiring tests following `test/agent-wiring.test.ts` pattern with `StubBackend`. Tests: yields `queue:prd:stale` with proceed verdict, yields `queue:prd:stale` with revise verdict (includes revision), yields `queue:prd:stale` with obsolete verdict, handles missing staleness block (defaults to proceed), verbose gating of agent events.

### Modify
- `src/cli/index.ts` - Add `queue` parent command via `program.command('queue').description('Manage PRD queue')`. Add `list` subcommand that creates engine, calls `loadQueue()`, calls `renderQueueList()`. Add `run [name]` subcommand with flags (`--all`, `--auto`, `--verbose`, `--no-monitor`, `--no-plugins`, `--parallelism`), creates engine, iterates `engine.runQueue()` with `wrapEvents()` + `consumeEvents()` + `withMonitor()`, same session/hook wiring as the `run` command.
- `src/cli/display.ts` - Add cases in `renderEvent()` for: `queue:start` (header with queue dir and count), `queue:prd:start` (spinner with PRD title), `queue:prd:stale` (color-coded verdict: green=proceed, yellow=revised, red=obsolete), `queue:prd:skip` (dimmed skip message), `queue:prd:complete` (succeed/fail spinner), `queue:complete` (summary line: processed/skipped/failed). Add `renderQueueList(prds: QueuedPrd[])` function: table grouped by status (pending first, then completed, then obsolete/skipped dimmed), columns for priority, title, created, stale days, depends_on. Color-code stale days: green <7, yellow 7-14, red >14.
- `eforge-plugin/skills/plan/plan.md` - Update Step 4 (Write PRD): default output to `docs/prd-queue/<name>.md` (or configured queue dir). Include YAML frontmatter with `title`, `created` (today's ISO date), `priority` (ask user or omit), `status: pending`. Encourage Problem / Goal / Design / Scope body sections. Update Step 5 (Suggest Next Step): change from `/eforge:run {path}` to "PRD enqueued. Run `eforge queue list` to see the queue, or `eforge queue run <name>` to build it now."
- `eforge-plugin/.claude-plugin/plugin.json` - Add `"./skills/queue/queue.md"` to `commands` array. Bump version from `1.2.0` to `1.3.0`.
- `test/xml-parsers.test.ts` - Add `describe('parseStalenessBlock')` section: `proceed` verdict returns `{ verdict: 'proceed', justification }`, `revise` verdict extracts revision content, `obsolete` verdict returns correctly, missing block returns `null`, malformed verdict (not proceed/revise/obsolete) returns `null`.
- `test/config.test.ts` - Add tests for: `prdQueue` section parsing from YAML (valid values), defaults applied when `prdQueue` omitted, merge behavior (project `prdQueue` overrides global `prdQueue` per-field).

## Verification

- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` exits with code 0 (all tests pass, new + existing)
- [ ] `pnpm build` exits with code 0
- [ ] `renderEvent()` exhaustive switch handles all 6 `queue:*` event types without falling through to the `never` default
- [ ] `eforge queue --help` prints help text showing `list` and `run` subcommands
- [ ] `eforge queue list` loads PRDs from `docs/prd-queue/` and renders a table (or "No PRDs in queue" if empty)
- [ ] `eforge queue run --help` shows `--all`, `--auto`, `--verbose`, `--no-monitor`, `--no-plugins`, `--parallelism` flags
- [ ] Plugin version in `eforge-plugin/.claude-plugin/plugin.json` is `1.3.0`
- [ ] Plugin `commands` array includes `./skills/queue/queue.md`
- [ ] `/eforge:plan` skill Step 4 writes PRD to `docs/prd-queue/<name>.md` with YAML frontmatter containing `title`, `created`, `status: pending`
- [ ] `test/prd-queue.test.ts` has tests for: valid frontmatter, missing title, missing created, invalid status, priority sort, dependency waves, status filtering, `updatePrdStatus` replacement and insertion
- [ ] `test/staleness-assessor.test.ts` has tests for: proceed/revise/obsolete verdicts, missing staleness block defaults to proceed, verbose gating
- [ ] `test/xml-parsers.test.ts` has `parseStalenessBlock` tests for: proceed/revise/obsolete, missing block, malformed verdict
- [ ] `test/config.test.ts` has `prdQueue` tests for: parsing, defaults, merge behavior
