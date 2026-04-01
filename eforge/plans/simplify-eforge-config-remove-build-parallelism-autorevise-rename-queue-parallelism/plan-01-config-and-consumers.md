---
id: plan-01-config-and-consumers
name: Remove config fields, add maxConcurrentBuilds, update all consumers and tests
depends_on: []
branch: simplify-eforge-config-remove-build-parallelism-autorevise-rename-queue-parallelism/config-and-consumers
---

# Remove config fields, add maxConcurrentBuilds, update all consumers and tests

## Architecture Context

The eforge config defines types in `src/engine/config.ts` that are consumed throughout the engine, CLI, and tests. Removing `build.parallelism`, `prdQueue.autoRevise`, and `prdQueue.parallelism` from the Zod schema, TypeScript type, defaults, and resolution logic will cause type errors in every consumer. All consumers must be updated in the same plan to maintain a compilable codebase.

The new top-level `maxConcurrentBuilds` field (default `2`) replaces `prdQueue.parallelism` semantically. Plan-level parallelism in the orchestrator becomes automatic (based on plan count) rather than configurable.

## Implementation

### Overview

1. Modify `src/engine/config.ts`: remove three fields from schema/type/defaults/resolution, add `maxConcurrentBuilds`, update `mergePartialConfigs`
2. Modify `src/engine/orchestrator.ts`: remove `parallelism` from options, use `config.plans.length || 1`
3. Modify `src/engine/orchestrator/phases.ts`: remove `availableParallelism` import if no longer needed
4. Modify `src/engine/eforge.ts`: remove build parallelism consumer, remove autoRevise guard, switch queue parallelism to `maxConcurrentBuilds`
5. Modify `src/cli/index.ts`: replace CLI options and `buildConfigOverrides`
6. Update all test files referencing removed fields

### Key Decisions

1. **Plan parallelism = plan count** - Since plan execution is IO-bound (LLM API calls), there is no reason to throttle. The orchestrator already has dependency-based scheduling via its semaphore; setting parallelism to `config.plans.length || 1` means all dependency-ready plans start immediately.
2. **Auto-revision always on** - The `autoRevise` guard is removed; revision runs unconditionally when the staleness verdict is `'revise'` and a revision is available.
3. **Default maxConcurrentBuilds = 2** - Replaces `prdQueue.parallelism` default of `1`, reflecting that most users want some concurrency.

## Scope

### In Scope
- Remove `build.parallelism` from Zod schema, `EforgeConfig` type, `DEFAULT_CONFIG`, `resolveConfig()`, and `mergePartialConfigs()`
- Remove `prdQueue.autoRevise` from Zod schema, `EforgeConfig` type, `DEFAULT_CONFIG`, `resolveConfig()`
- Remove `prdQueue.parallelism` from Zod schema, `EforgeConfig` type, `DEFAULT_CONFIG`, `resolveConfig()`
- Add top-level `maxConcurrentBuilds` to Zod schema, `EforgeConfig` type, `DEFAULT_CONFIG`, `resolveConfig()`, `mergePartialConfigs()`
- Remove `parallelism` from `OrchestratorOptions` and use `config.plans.length || 1` in orchestrator
- Remove `availableParallelism` imports from `config.ts` and `orchestrator.ts` if unused after changes
- Remove autoRevise conditional in `eforge.ts` line 787
- Replace `prdQueue.parallelism` reads in `eforge.ts` with `maxConcurrentBuilds`
- Replace CLI `--parallelism` and `--queue-parallelism` with `--max-concurrent-builds`
- Rewrite `buildConfigOverrides()` in CLI
- Update all test assertions and config fixtures

### Out of Scope
- Removing `watchPollIntervalMs` dead code
- Documentation updates (handled in plan-02)
- Plugin skill updates (handled in plan-02)

## Files

### Modify
- `src/engine/config.ts` - Remove `build.parallelism`, `prdQueue.autoRevise`, `prdQueue.parallelism` from schema/type/defaults/resolution. Add top-level `maxConcurrentBuilds`. Update `mergePartialConfigs()`. Remove `availableParallelism` import if unused.
- `src/engine/orchestrator.ts` - Remove `parallelism` from `OrchestratorOptions`. Change line 152 to use `config.plans.length || 1`. Remove `availableParallelism` import.
- `src/engine/orchestrator/phases.ts` - Check if `availableParallelism` import is still needed (it may be used by `computeMaxConcurrency` or other code); remove if unused.
- `src/engine/eforge.ts` - Remove `const parallelism = config.build.parallelism` (line 654) and `parallelism,` from Orchestrator constructor (line 661). Change `if (this.config.prdQueue.autoRevise && revision)` to `if (revision)` (line 787). Change `this.config.prdQueue.parallelism` to `this.config.maxConcurrentBuilds` (lines 970, 1189).
- `src/cli/index.ts` - Remove `--parallelism` option, replace `--queue-parallelism` with `--max-concurrent-builds`, rewrite `buildConfigOverrides()` to use `maxConcurrentBuilds`.
- `test/config.test.ts` - Remove `build.parallelism` assertion (line 12). Update postMergeCommands test to not set `parallelism: 4` (line 68). Replace build merge test (lines 235-241) with different field. Remove `autoRevise` assertions (lines 351-363). Update prdQueue merge test (lines 366-381) to remove `autoRevise`. Add test for `maxConcurrentBuilds` default = 2. Add test for merging `maxConcurrentBuilds`.
- `test/dependency-detector.test.ts` - Change `prdQueue.parallelism` test (lines 226-228) to `maxConcurrentBuilds` test with value `2`.
- `test/greedy-queue-scheduler.test.ts` - Update `createTestEngine` default config (line 41) and all test configs (lines 81, 170, 214) to use top-level `maxConcurrentBuilds` instead of `prdQueue.parallelism`. Remove `autoRevise: false` from all configs.
- `test/watch-queue.test.ts` - Remove `autoRevise: false` from prdQueue config (line 56).

## Verification

- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` exits with code 0 (all tests pass)
- [ ] `pnpm build` exits with code 0
- [ ] `grep -r 'build\.parallelism\|build\[.parallelism.\]' src/ test/` returns no matches (field fully removed)
- [ ] `grep -r 'autoRevise' src/ test/` returns no matches (field fully removed)
- [ ] `grep -r 'prdQueue\.parallelism\|prdQueue\[.parallelism.\]' src/ test/` returns no matches (field fully removed)
- [ ] `grep -r 'maxConcurrentBuilds' src/engine/config.ts` returns matches in schema, type, defaults, resolution, and merge
- [ ] `grep -r '--parallelism\|--queue-parallelism' src/cli/` returns no matches (old CLI options removed)
- [ ] `grep -r '--max-concurrent-builds' src/cli/index.ts` returns a match (new CLI option exists)
