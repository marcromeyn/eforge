---
id: plan-01-fix-missing-orchestration-yaml
name: Fix crash when orchestration.yaml is missing in plannerStage
depends_on: []
branch: fix-crash-when-orchestration-yaml-is-missing-in-plannerstage/fix-missing-orchestration-yaml
---

# Fix crash when orchestration.yaml is missing in plannerStage

## Architecture Context

In `plannerStage` (src/engine/pipeline.ts), when the planner agent emits a `plan:complete` event, the pipeline injects pipeline metadata into `orchestration.yaml` and then parses it to backfill `dependsOn` into plan events. The `parseOrchestrationConfig()` call is already protected by a try/catch, but `injectPipelineIntoOrchestrationYaml()` sits outside it. If the planner fails to write `orchestration.yaml`, the unprotected `readFile()` inside `injectPipelineIntoOrchestrationYaml()` throws ENOENT and crashes the compile.

## Implementation

### Overview

Move the `injectPipelineIntoOrchestrationYaml()` call inside the existing try/catch block so both it and `parseOrchestrationConfig()` are protected. On failure, fall through to yield unenriched plans. Add a test verifying this graceful fallback.

### Key Decisions

1. Reuse the existing try/catch rather than adding a new one - keeps the code minimal and the fallback behavior (yield unenriched plans) is already correct.
2. Add a comment explaining why the try/catch covers both calls.

## Scope

### In Scope
- Move `injectPipelineIntoOrchestrationYaml()` inside the try/catch in `plannerStage`'s `plan:complete` handler
- Add a test in `test/pipeline.test.ts` verifying `plannerStage` emits `plan:complete` with unenriched plans when `orchestration.yaml` is missing

### Out of Scope
- Changes to `injectPipelineIntoOrchestrationYaml()` itself
- Changes to `parseOrchestrationConfig()`
- Any other pipeline stages or files

## Files

### Modify
- `src/engine/pipeline.ts` - Move `await injectPipelineIntoOrchestrationYaml(orchYamlPath, ctx.pipeline, ctx.baseBranch)` inside the existing try/catch block (~line 814)
- `test/pipeline.test.ts` - Add test: register a custom planner compile stage that emits `plan:complete`, point `cwd` at a temp dir with no `orchestration.yaml`, run `runCompilePipeline`, and assert the output `plan:complete` event contains the original unenriched plans (no throw)

## Verification

- [ ] `injectPipelineIntoOrchestrationYaml()` is the first statement inside the try block, before `parseOrchestrationConfig()`
- [ ] When `orchestration.yaml` does not exist on disk, `plannerStage` emits a `plan:complete` event containing the original unenriched plans array
- [ ] No ENOENT error propagates from `plannerStage` when `orchestration.yaml` is missing
- [ ] `pnpm type-check` passes
- [ ] `pnpm test` passes
