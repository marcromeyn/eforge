---
id: plan-01-engine-enqueue
name: Engine Enqueue Foundation
depends_on: []
branch: minimal-plugin-skill-api-enqueue-run-status/engine-enqueue
---

# Engine Enqueue Foundation

## Architecture Context

This plan adds the formatter agent, `enqueuePrd()` file I/O utility, and `EforgeEngine.enqueue()` method - then removes `adopt()` and rewires `run <source>` to flow through enqueue. The engine is the foundation layer; CLI and plugin changes come in a follow-up plan.

The formatter agent follows the established one-shot agent pattern (see `assessor.ts`, `staleness-assessor.ts`). It uses `AgentBackend` - no direct SDK imports. The `enqueuePrd()` function is pure file I/O in `prd-queue.ts`. The `enqueue()` method on `EforgeEngine` orchestrates these as an `AsyncGenerator<EforgeEvent>`.

## Implementation

### Overview

1. Add `enqueue:start` and `enqueue:complete` event types to the discriminated union
2. Create the formatter agent (one-shot query, no tools) with its prompt
3. Add `enqueuePrd()` and `inferTitle()` to `prd-queue.ts`
4. Add `EforgeEngine.enqueue()` method
5. Remove `EforgeEngine.adopt()` and `AdoptOptions`
6. Update barrel exports
7. Add tests for `enqueuePrd()` and formatter agent wiring

### Key Decisions

1. **Formatter is toolless** - it reformats text, never explores the codebase. Use `tools: 'none'` in the backend call (the `AgentRunOptions` interface already supports `'none' | 'coding' | 'readonly'` - verify this; if not, omit the `tools` field and set `maxTurns: 1` to prevent tool use). The prompt instructs it to output only the reformatted content.
2. **`enqueuePrd()` is a pure function** - no agent calls, no events. Takes formatted content + metadata, writes a file, returns result. This keeps it testable without `StubBackend`.
3. **`enqueue()` reads the source, runs the formatter, calls `enqueuePrd()`** - it yields `enqueue:start`, formatter agent lifecycle events, and `enqueue:complete`. The queue dir comes from `this.config.prdQueue.dir`.
4. **Adopt removal is clean** - delete the `adopt()` method (~lines 232-439), delete `AdoptOptions` from events.ts, remove `'adopt'` from the `phase:start` command union. The assessor agent (`assessor.ts`) and its prompt (`assessor.md`) stay - they're useful elsewhere and not adopt-specific.
5. **`AgentRole` union gets `'formatter'`** - add it alongside the existing roles.

## Scope

### In Scope
- New event types: `enqueue:start`, `enqueue:complete`
- New agent role: `formatter`
- New file: `src/engine/agents/formatter.ts` (one-shot agent runner)
- New file: `src/engine/prompts/formatter.md` (prompt template)
- New functions in `src/engine/prd-queue.ts`: `enqueuePrd()`, `inferTitle()`
- New method: `EforgeEngine.enqueue()`
- Remove: `EforgeEngine.adopt()`, `AdoptOptions` type
- Remove `'adopt'` from `phase:start` command union
- Updated barrel exports in `src/engine/index.ts`
- New test file: `test/prd-queue-enqueue.test.ts`
- New test file: `test/formatter-agent.test.ts`

### Out of Scope
- CLI command changes (plan-02)
- Plugin skill changes (plan-02)
- Documentation updates (plan-02)
- Removing the assessor agent or its prompt (still useful for other purposes)

## Files

### Create
- `src/engine/agents/formatter.ts` - One-shot formatter agent runner. Pattern: same as `assessor.ts`. Calls `backend.run()` with the formatter prompt, accumulates `agent:message` content, returns the full text as the formatted PRD body. Yields agent lifecycle events per `isAlwaysYieldedAgentEvent()`.
- `src/engine/prompts/formatter.md` - Prompt instructing the agent to accept any input format and reformat into standard PRD sections (Problem/Motivation, Goal, Approach, Scope, Acceptance Criteria). Must preserve ALL details - no additions, no omissions. Output only the formatted content, no commentary. Use `{{source}}` template variable for the input content.
- `test/prd-queue-enqueue.test.ts` - Tests for `enqueuePrd()`: frontmatter correctness (title, created=today, status=pending), slug generation (`My Feature` -> `my-feature.md`), duplicate slug handling (`-2`, `-3` suffix), queue dir auto-creation, priority/depends_on preservation. Uses `node:fs` with temp directories - no mocks.
- `test/formatter-agent.test.ts` - Tests for formatter agent wiring using `StubBackend`: agent receives source content and yields formatted output; events sequence includes `agent:start`, `agent:stop`, `agent:result`; title inference from content. Pattern matches `test/agent-wiring.test.ts`.

### Modify
- `src/engine/events.ts` - (1) Add `'formatter'` to `AgentRole` union. (2) Add `enqueue:start` and `enqueue:complete` to `EforgeEvent` union: `{ type: 'enqueue:start'; source: string }` and `{ type: 'enqueue:complete'; id: string; filePath: string; title: string }`. (3) Remove `AdoptOptions` interface. (4) Remove `'adopt'` from the `phase:start` command union (change `'compile' | 'build' | 'adopt'` to `'compile' | 'build'`). (5) Add `EnqueueOptions` interface: `{ name?: string; verbose?: boolean; auto?: boolean; abortController?: AbortController }`.
- `src/engine/prd-queue.ts` - Add `enqueuePrd()` function: builds frontmatter (title, created=today ISO, status='pending', optional priority/depends_on), generates slug from title (lowercase, hyphens, strip special chars), handles duplicate slugs by appending `-2`/`-3`, creates queue dir if needed via `mkdir`, writes file, returns `{ id, filePath, frontmatter }`. Add `inferTitle()`: extracts title from first `# ` heading, falls back to deslugifying filename.
- `src/engine/eforge.ts` - (1) Add `async *enqueue(source, options?)` method: resolves source content (read file if path, use as-is if inline), calls `inferTitle()`, runs formatter agent, calls `enqueuePrd()`, yields `enqueue:start`/`enqueue:complete` events plus agent lifecycle events. (2) Delete the entire `adopt()` method (~lines 232-439). (3) Remove `AdoptOptions` import from events.
- `src/engine/index.ts` - (1) Add exports for `enqueuePrd`, `inferTitle` from `prd-queue.js`. (2) Add export for `runFormatter` from `agents/formatter.js`. (3) Add export for `EnqueueOptions` from `events.js`. (4) Remove `AdoptOptions` from the type exports.

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes - all existing tests still green, new tests in `test/prd-queue-enqueue.test.ts` and `test/formatter-agent.test.ts` pass
- [ ] `pnpm build` succeeds without errors
- [ ] `AdoptOptions` type no longer exists in `src/engine/events.ts`
- [ ] `adopt()` method no longer exists in `src/engine/eforge.ts`
- [ ] `'adopt'` is not in the `phase:start` command union
- [ ] `EforgeEngine.enqueue()` method exists and returns `AsyncGenerator<EforgeEvent>`
- [ ] `enqueuePrd()` is exported from `src/engine/index.ts`
- [ ] `runFormatter` is exported from `src/engine/index.ts`
- [ ] `formatter.md` prompt file exists in `src/engine/prompts/`
- [ ] Formatter agent file exists at `src/engine/agents/formatter.ts`
- [ ] `AgentRole` union includes `'formatter'`
- [ ] `EforgeEvent` union includes `enqueue:start` and `enqueue:complete` variants
