---
id: plan-01-engine-core
name: PRD Queue Engine Core
depends_on: []
branch: prd-queue-management/engine-core
---

# PRD Queue Engine Core

## Architecture Context

eforge's engine is event-driven - all communication flows through typed `EforgeEvent`s via `AsyncGenerator`. Agent implementations follow a consistent pattern: load prompt, run backend, parse XML blocks from accumulated text, yield structured events. Config uses Zod schemas with a defaults -> global -> project -> env -> CLI override chain. This plan adds the foundational engine pieces for PRD queue management following these patterns exactly.

## Implementation

### Overview

Add queue event types, config section, PRD queue loading/ordering module, staleness assessor agent, and the `runQueue()` engine surface method. All new code follows existing patterns - the staleness assessor mirrors `assessor.ts`, queue events follow the discriminated union pattern, and config follows the Zod schema + `DEFAULT_CONFIG` + `resolveConfig` + `mergePartialConfigs` pattern.

### Key Decisions

1. **Queue events as a grouped union type** - Define `QueueEvent` as its own discriminated union, then include it in `EforgeEvent` via `| QueueEvent`. This keeps queue events independently referenceable while flowing through existing infrastructure (display, hooks, monitor).
2. **Reuse `resolveDependencyGraph()` for PRD ordering** - PRDs with `depends_on` fields use the same topological sort from `plan.ts`. Within each wave, sort by `priority` (ascending, nulls last) then `created` (ascending).
3. **Staleness check per-PRD, not upfront** - Check staleness just before each PRD runs so later PRDs see changes from earlier ones.
4. **Regex-based status update** - Use regex to replace the `status:` line in frontmatter rather than round-tripping through YAML stringify, which would reformat the file.
5. **`staleness-assessor` as a new `AgentRole`** - Added to both the type union and the `AGENT_ROLES` array in config.

## Scope

### In Scope
- `QueueEvent` type union and `EforgeEvent` integration
- `'staleness-assessor'` addition to `AgentRole` and `AGENT_ROLES`
- `prdQueue` config section (Zod schema, `EforgeConfig` interface, `DEFAULT_CONFIG`, `resolveConfig`, `mergePartialConfigs`)
- `src/engine/prd-queue.ts` module: frontmatter schema, `QueuedPrd` type, `loadQueue()`, `resolveQueueOrder()`, `getPrdDiffSummary()`, `updatePrdStatus()`, `validatePrdFrontmatter()`
- `src/engine/agents/staleness-assessor.ts`: one-shot agent following `assessor.ts` pattern
- `src/engine/prompts/staleness-assessor.md`: agent prompt
- `parseStalenessBlock()` XML parser in `agents/common.ts`
- `runQueue()` method on `EforgeEngine` with `QueueOptions`
- Barrel exports in `src/engine/index.ts`

### Out of Scope
- CLI commands (plan-02)
- Display rendering (plan-02)
- Plugin skill updates (plan-02)
- Tests (plan-02)

## Files

### Create
- `src/engine/prd-queue.ts` - PRD queue loading, parsing, ordering, status updates. Zod schema for frontmatter (`title`, `created`, `priority`, `depends_on`, `status`). `loadQueue()` scans dir for `.md` files, parses frontmatter, gets git metadata via `git log -1 --format="%H %ci" -- <path>`. `resolveQueueOrder()` filters to `pending`, calls `resolveDependencyGraph()` for topological sort, then sorts within each wave by priority (ascending, nulls last) then created (ascending). `getPrdDiffSummary()` runs `git diff --stat <hash> HEAD`. `updatePrdStatus()` regex-replaces the `status:` line in frontmatter. `validatePrdFrontmatter()` is a Zod safeParse wrapper.
- `src/engine/agents/staleness-assessor.ts` - One-shot query agent following `assessor.ts` pattern. Options: `{ backend, prdContent, diffSummary, staleDays, cwd, verbose?, abortController? }`. Loads `staleness-assessor` prompt, runs backend with `tools: 'coding'`, accumulates text, parses `<staleness verdict="proceed|revise|obsolete">` XML block, yields `queue:prd:stale` event. For `revise` verdict, extracts `<revision>` inner content.
- `src/engine/prompts/staleness-assessor.md` - Template variables: `{{prdContent}}`, `{{diffSummary}}`, `{{staleDays}}`, `{{cwd}}`. Instructs agent to: read PRD, review git diff summary, explore codebase if needed, emit exactly one `<staleness>` block with verdict + justification. For `revise`: include `<revision>` with updated PRD. For `obsolete`: explain what shipped.

### Modify
- `src/engine/events.ts` - Add `'staleness-assessor'` to `AgentRole` union. Define `QueueEvent` discriminated union type with 6 event types (`queue:start`, `queue:prd:start`, `queue:prd:stale`, `queue:prd:skip`, `queue:prd:complete`, `queue:complete`). Add `| QueueEvent` to the `EforgeEvent` union.
- `src/engine/config.ts` - Add `'staleness-assessor'` to `AGENT_ROLES` array. Add `prdQueue` Zod schema section (`dir: z.string().optional()`, `stalenessThresholdDays: z.number().int().positive().optional()`, `autoRevise: z.boolean().optional()`). Add to `EforgeConfig` interface: `prdQueue: { dir: string; stalenessThresholdDays: number; autoRevise: boolean }`. Add to `DEFAULT_CONFIG`: `prdQueue: Object.freeze({ dir: 'docs/prd-queue', stalenessThresholdDays: 14, autoRevise: false })`. Wire through `resolveConfig()` (use `??` fallback from defaults) and `mergePartialConfigs()` (shallow merge like other object sections). Add `prdQueue` to `stripUndefinedSections()` and `parseRawConfigFallback()`.
- `src/engine/agents/common.ts` - Add `StalenessVerdict` interface (`verdict: 'proceed' | 'revise' | 'obsolete'`, `justification: string`, `revision?: string`). Add `parseStalenessBlock(text)` function that parses `<staleness verdict="...">` XML, extracts justification text (with `<revision>` tag stripped), and extracts revision content if present. Return `null` if no block found.
- `src/engine/eforge.ts` - Add `QueueOptions` interface (`name?`, `all?`, `auto?`, `verbose?`, `noMonitor?`, `abortController?`). Add `async *runQueue(options: QueueOptions)` method that: loads queue from `config.prdQueue.dir`, resolves queue order, iterates PRDs (staleness check -> compile -> build per PRD), updates frontmatter status, yields queue lifecycle events. Import from `prd-queue.ts` and `staleness-assessor.ts`.
- `src/engine/index.ts` - Export `QueueEvent` type from `events.ts`. Export from `prd-queue.ts`: types (`QueuedPrd`, `PrdFrontmatter`, `PrdStatus`), functions (`loadQueue`, `resolveQueueOrder`, `validatePrdFrontmatter`). Export from `staleness-assessor.ts`: `runStalenessAssessor`, `StalenessAssessorOptions`. Export `parseStalenessBlock`, `StalenessVerdict` from `agents/common.ts`. Export `QueueOptions` from `eforge.ts`.

## Verification

- [ ] `pnpm type-check` exits with code 0 (no type errors)
- [ ] `AgentRole` union in `events.ts` includes `'staleness-assessor'`
- [ ] `AGENT_ROLES` array in `config.ts` includes `'staleness-assessor'`
- [ ] `QueueEvent` type has exactly 6 variants: `queue:start`, `queue:prd:start`, `queue:prd:stale`, `queue:prd:skip`, `queue:prd:complete`, `queue:complete`
- [ ] `EforgeEvent` union includes `| QueueEvent`
- [ ] `DEFAULT_CONFIG.prdQueue` has `dir: 'docs/prd-queue'`, `stalenessThresholdDays: 14`, `autoRevise: false`
- [ ] `resolveConfig({})` returns `prdQueue` with all defaults populated
- [ ] `mergePartialConfigs({ prdQueue: { dir: 'a' } }, { prdQueue: { stalenessThresholdDays: 7 } })` shallow-merges to `{ dir: 'a', stalenessThresholdDays: 7 }`
- [ ] `parseStalenessBlock('<staleness verdict="proceed">All good</staleness>')` returns `{ verdict: 'proceed', justification: 'All good' }`
- [ ] `parseStalenessBlock('<staleness verdict="revise">Needs update<revision>new content</revision></staleness>')` returns `{ verdict: 'revise', justification: 'Needs update', revision: 'new content' }`
- [ ] `parseStalenessBlock('no xml here')` returns `null`
- [ ] `EforgeEngine` class has a `runQueue` method that returns `AsyncGenerator<EforgeEvent>`
- [ ] All new types and functions are exported from `src/engine/index.ts`
