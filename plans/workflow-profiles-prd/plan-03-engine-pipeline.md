---
id: plan-03-engine-pipeline
name: Refactor compile/build/adopt in eforge.ts to be profile-driven pipeline
  executors with profile selection pre-step
depends_on:
  - plan-01-config-and-types
  - plan-02-backend-and-prompts
branch: workflow-profiles-prd/engine-pipeline
---

# Engine Pipeline

## Architecture Reference

This module implements [Pipeline stages are named units with a uniform interface], [Profile selection is a pre-pipeline step], and [Config → Engine integration contract] from the architecture.

Key constraints from architecture:
- Pipeline stages are named units with a uniform interface: each accepts a `PipelineContext` and yields `EforgeEvent`s
- Profile selection happens before the compile pipeline starts, using a fixed planner config (not profile-dependent)
- The engine iterates the stage list from the resolved profile and calls each stage in sequence
- Use a stage registry (`Map` of stage name to factory function) rather than inline switch statements
- `plan:scope` continues to be emitted (derived from profile name) during the transition period
- The `complete` scope short-circuits before any pipeline runs
- Built-in profiles encode today's hardcoded behavior exactly

## Scope

### In Scope
- `PipelineContext` interface threaded through all pipeline stages
- `PipelineStage` interface: `(ctx: PipelineContext) => AsyncGenerator<EforgeEvent>`
- Stage registry: `Map<string, PipelineStageFactory>` mapping stage names to factory functions
- Built-in compile stages: `planner`, `plan-review-cycle`, `module-planning`, `cohesion-review-cycle`, `compile-expedition`
- Built-in build stages: `implement`, `review`, `review-fix`, `evaluate`
- Profile selection pre-step: lightweight planner call with fixed config to select a profile
- Refactored `compile()` to iterate compile stages from the resolved profile
- Refactored `build()` planRunner to iterate build stages from the resolved profile
- Refactored `adopt()` to use profile selection (via assessor) and the profile's build pipeline config
- `plan:profile` event handling in compile/adopt flows (consuming events from planner/assessor, forwarding to output)
- `EforgeEngineOptions` extended with optional `profiles` for `--profiles` overlay
- `EforgeEngine.create()` merges `--profiles` overlay into config before resolving
- Thread `profile.agents[role]` config (maxTurns, prompt, tools, model) to agent call sites

### Out of Scope
- Profile type definitions and config parsing (config-and-types module - already complete)
- `ClaudeSDKBackend` model passthrough (backend-and-prompts module)
- Planner/assessor prompt changes for profile selection (backend-and-prompts module)
- `parseProfileBlock` XML parser (config-and-types module)
- CLI `--profiles` flag definition and file parsing (downstream CLI module)
- Monitor UI updates for `plan:profile` (downstream monitor module)
- CLI display rendering of profile selection (downstream CLI/display module)
- Build-phase review cycle parameterization via `ReviewProfileConfig` (future module - this module threads the config but does not implement `maxRounds`, `autoAcceptBelow`, `evaluatorStrictness`, or `perspectives` logic)
- Eval integration with profiles

## Implementation Approach

### Overview

Extract the hardcoded compile and build logic from `EforgeEngine` into named pipeline stages registered in a stage registry. The engine's `compile()`, `build()`, and `adopt()` methods become thin orchestrators that look up stages by name from the resolved profile and call them in sequence. Profile selection is a pre-step in `compile()` that runs before iterating the stage list.

The refactor is incremental: extract each stage as a standalone `async function*` that accepts `PipelineContext`, register it in the stage map, then rewrite the calling method to iterate stages. The extracted stage functions contain the same logic as today - no behavioral changes.

### Key Decisions

1. **Stage registry lives in a new file `src/engine/pipeline.ts`** - Keeps `eforge.ts` focused on the `EforgeEngine` class and its public API. The registry, `PipelineContext`, and `PipelineStage` types live in `pipeline.ts`. Stage implementations can live in the same file since they're thin wrappers around existing agent runners.

2. **`PipelineContext` is a mutable bag threaded through stages** - Stages communicate via shared mutable state on the context (e.g., `ctx.plans`, `ctx.scopeAssessment`, `ctx.expeditionModules`). This matches the current approach where local variables accumulate state across sequential steps in `compile()`. Immutable context would require return values and reduce the uniform stage interface.

3. **Profile selection pre-step replaces the inline scope check** - In `compile()`, before iterating the compile stage list, the engine runs a lightweight profile selection pass. The planner agent (called with fixed default config) emits a `plan:profile` event. The engine resolves the selected profile from `config.profiles` and uses it to configure the rest of the pipeline. If the planner selects `complete`, the engine short-circuits (no profile, no stages).

4. **Build stages operate within the planRunner closure** - The build pipeline runs per-plan inside the `planRunner` closure passed to the Orchestrator. The planRunner iterates `profile.build` stage names and calls each stage with a per-plan context (including `worktreePath` and `planId`). This is a refactor of the existing inline sequence in the planRunner.

5. **Adopt flow reuses profile selection via assessor** - The assessor already runs in adopt to determine scope. With profiles, it also emits `plan:profile`. The adopt flow uses the selected profile's build config but skips the compile pipeline (since adopt provides the plan directly). When scope is excursion/expedition, adopt delegates to the full planner as today, but now the planner also selects a profile.

6. **Agent config threading is explicit, not implicit** - Each stage factory receives `PipelineContext` which includes the resolved `profile`. Stages read `profile.agents[role]` to get per-agent overrides (maxTurns, prompt, tools, model) and pass them to the agent runner options. This replaces the current hardcoded values (e.g., `maxTurns: 50` for builder).

7. **Tracing integration stays in the engine** - `PipelineContext` includes `tracing: TracingContext`. Stages create spans via `ctx.tracing.createSpan()` just like the current inline code does. The `createToolTracker` helper moves to `pipeline.ts` (or stays in `eforge.ts` and is imported).

8. **`validate` build stage is registered but not wired into default profiles** - The `validate` stage exists in the registry for custom profiles (e.g., `migration` profile with `build: ['implement', 'validate']`). The default built-in profiles use `implement, review, review-fix, evaluate` matching today's behavior. Post-merge validation continues to be handled by the Orchestrator, not the build pipeline.

## Files

### Create
- `src/engine/pipeline.ts` - Pipeline context, stage interface, stage registry, built-in stage implementations, `runCompilePipeline()` and `runBuildPipeline()` entry points.

### Modify
- `src/engine/eforge.ts` - Refactor `compile()`, `build()`, `adopt()` to use pipeline functions from `pipeline.ts`. Extract `planExpeditionModules()`, `runReviewCycle()`, `createToolTracker()`, `populateSpan()`, and `hasUnstagedChanges()` to `pipeline.ts` (or keep them and import from pipeline). Add `profiles` overlay to `EforgeEngineOptions`. Profile selection pre-step in `compile()`. Thread resolved profile through to planRunner.

- `src/engine/index.ts` - Re-export `PipelineContext`, `PipelineStage`, and stage registry types from `pipeline.ts`.

## Detailed Changes

### `src/engine/pipeline.ts` (new file)

#### Types

```typescript
import type { EforgeEvent, AgentRole, PlanFile, ClarificationQuestion, ExpeditionModule, ScopeAssessment, ReviewIssue, OrchestrationConfig } from './events.js';
import type { EforgeConfig, ResolvedProfileConfig } from './config.js';
import type { AgentBackend } from './backend.js';
import type { TracingContext, SpanHandle, ToolCallHandle } from './tracing.js';

export interface PipelineContext {
  backend: AgentBackend;
  config: EforgeConfig;
  profile: ResolvedProfileConfig;
  tracing: TracingContext;
  cwd: string;
  planSetName: string;
  sourceContent: string;
  verbose?: boolean;
  auto?: boolean;
  abortController?: AbortController;
  onClarification?: (questions: ClarificationQuestion[]) => Promise<Record<string, string>>;

  // Mutable state passed between stages
  plans: PlanFile[];
  scopeAssessment?: ScopeAssessment;
  expeditionModules: ExpeditionModule[];
}

/** Context for build stages, extends PipelineContext with per-plan fields. */
export interface BuildStageContext extends PipelineContext {
  planId: string;
  worktreePath: string;
  planFile: PlanFile;
  orchConfig: OrchestrationConfig;
  reviewIssues: ReviewIssue[];
}

export type CompileStage = (ctx: PipelineContext) => AsyncGenerator<EforgeEvent>;
export type BuildStage = (ctx: BuildStageContext) => AsyncGenerator<EforgeEvent>;
```

#### Stage Registry

```typescript
const compileStages = new Map<string, CompileStage>();
const buildStages = new Map<string, BuildStage>();

export function registerCompileStage(name: string, stage: CompileStage): void {
  compileStages.set(name, stage);
}

export function registerBuildStage(name: string, stage: BuildStage): void {
  buildStages.set(name, stage);
}

export function getCompileStage(name: string): CompileStage {
  const stage = compileStages.get(name);
  if (!stage) throw new Error(`Unknown compile stage: "${name}"`);
  return stage;
}

export function getBuildStage(name: string): BuildStage {
  const stage = buildStages.get(name);
  if (!stage) throw new Error(`Unknown build stage: "${name}"`);
  return stage;
}
```

#### Built-in Compile Stages

**`planner` stage** - Wraps `runPlanner()`. Reads `profile.agents.planner` for maxTurns/prompt/tools/model. Tracks `scopeAssessment`, `expeditionModules`, and `plans` on context. Handles `plan:profile` events from the planner (forwarding them, deriving `plan:scope` when profile matches a built-in). Suppresses planner's `plan:complete` in expedition mode when modules are detected.

```typescript
registerCompileStage('planner', async function* plannerStage(ctx) {
  const agentConfig = ctx.profile.agents.planner;
  const plannerOpts = {
    cwd: ctx.cwd,
    name: ctx.planSetName,
    auto: ctx.auto,
    verbose: ctx.verbose,
    abortController: ctx.abortController,
    backend: ctx.backend,
    onClarification: ctx.onClarification,
    profiles: ctx.config.profiles,
    // Agent config overrides from profile
    ...(agentConfig?.maxTurns && { maxTurns: agentConfig.maxTurns }),
    ...(agentConfig?.prompt && { promptOverride: agentConfig.prompt }),
  };

  const span = ctx.tracing.createSpan('planner', { source: ctx.sourceContent, planSet: ctx.planSetName });
  span.setInput({ source: ctx.sourceContent, planSet: ctx.planSetName });
  const tracker = createToolTracker(span);

  try {
    for await (const event of runPlanner(ctx.sourceContent, plannerOpts)) {
      if (event.type === 'plan:scope') {
        ctx.scopeAssessment = event.assessment;
      }
      if (event.type === 'plan:profile') {
        // Profile selection from planner - resolve into context
        const selectedProfile = ctx.config.profiles[event.profileName];
        if (selectedProfile) {
          // Update the pipeline context's profile to the selected one
          // (The caller handles swapping the stage list if needed)
        }
      }
      if (event.type === 'agent:message' && event.agent === 'planner' && ctx.expeditionModules.length === 0) {
        const modules = parseModulesBlock(event.content);
        if (modules.length > 0) {
          ctx.expeditionModules = modules;
          yield { type: 'expedition:architecture:complete', modules };
        }
      }
      // Suppress planner's plan:complete in expedition mode
      if (event.type === 'plan:complete' && ctx.scopeAssessment === 'expedition' && ctx.expeditionModules.length > 0) {
        continue;
      }
      if (event.type === 'plan:complete') {
        ctx.plans = event.plans;
      }
      tracker.handleEvent(event);
      yield event;
    }
    tracker.cleanup();
    span.end();
  } catch (err) {
    tracker.cleanup();
    span.error(err as Error);
    throw err;
  }
});
```

**`plan-review-cycle` stage** - Wraps `runReviewCycle()` with plan-reviewer and plan-evaluator. Non-fatal: catches errors and emits progress message. Reads `profile.agents['plan-reviewer']` and `profile.agents['plan-evaluator']` for config overrides.

**`module-planning` stage** - Encapsulates the existing `planExpeditionModules()` logic: dependency wave computation, parallel module planner execution, context passing between waves. Reads `profile.agents['module-planner']` for config. Only runs when `ctx.expeditionModules.length > 0`.

**`cohesion-review-cycle` stage** - Wraps `runReviewCycle()` with cohesion-reviewer and cohesion-evaluator. Non-fatal. Only meaningful in expedition mode.

**`compile-expedition` stage** - Wraps `compileExpedition()`. Emits `expedition:compile:start/complete` and `plan:complete` events.

#### Built-in Build Stages

**`implement` stage** - Wraps `builderImplement()`. Reads `profile.agents.builder` for maxTurns/prompt/tools/model. Sets `ctx.planId`-scoped events.

**`review` stage** - Wraps `runParallelReview()`. Stores issues in `ctx.reviewIssues`. Reads `profile.review.strategy` to determine parallel vs single (today: always uses `runParallelReview` which handles this internally via `shouldParallelizeReview()`). Future: respect `strategy: 'single' | 'parallel'` from profile.

**`review-fix` stage** - Wraps `runReviewFixer()`. Only runs if `ctx.reviewIssues.length > 0`.

**`evaluate` stage** - Wraps `builderEvaluate()`. Only runs if there are unstaged changes (via `hasUnstagedChanges()`).

**`validate` stage** - Placeholder for inline validation (not used in default profiles). Runs validation commands and yields `validation:*` events.

#### Pipeline Runners

```typescript
/**
 * Run the compile pipeline stages in sequence.
 * Handles profile selection pre-step, then iterates stages from the resolved profile.
 */
export async function* runCompilePipeline(
  ctx: PipelineContext,
): AsyncGenerator<EforgeEvent> {
  for (const stageName of ctx.profile.compile) {
    const stage = getCompileStage(stageName);
    yield* stage(ctx);
  }
}

/**
 * Run the build pipeline stages in sequence for a single plan.
 */
export async function* runBuildPipeline(
  ctx: BuildStageContext,
): AsyncGenerator<EforgeEvent> {
  yield { type: 'build:start', planId: ctx.planId };

  for (const stageName of ctx.profile.build) {
    const stage = getBuildStage(stageName);
    yield* stage(ctx);

    // Check if implementation failed - skip remaining stages
    if (stageName === 'implement' && ctx.plans.length === 0) {
      // Implementation failure is signaled via build:failed event
      // which the stage already emitted
      return;
    }
  }

  yield { type: 'build:complete', planId: ctx.planId };
}
```

#### Helpers (moved from `eforge.ts`)

- `createToolTracker(span)` - unchanged
- `populateSpan(span, data)` - unchanged
- `hasUnstagedChanges(cwd)` - unchanged
- `getAgentMaxTurns(profile, role, defaultTurns)` - new helper to read maxTurns from profile with fallback

### `src/engine/eforge.ts` Changes

#### `EforgeEngineOptions` extension

```typescript
export interface EforgeEngineOptions {
  // ... existing fields ...
  /** Additional profiles to add to the palette (from --profiles files) */
  profileOverrides?: Record<string, import('./config.js').PartialProfileConfig>;
}
```

#### `EforgeEngine.create()` - merge profile overrides

After loading config, if `options.profileOverrides` is set, merge them into the config's profiles before resolving:

```typescript
if (options.profileOverrides) {
  // Merge profile overrides into the config
  const { resolveProfileExtensions } = await import('./config.js');
  const mergedPartials = { ...options.profileOverrides };
  config = {
    ...config,
    profiles: resolveProfileExtensions(mergedPartials, config.profiles),
  };
}
```

#### `compile()` refactor

1. **Profile selection pre-step**: After resolving source content and before running stages, call the planner with a lightweight profile-selection prompt. Parse the `plan:profile` event to determine the profile name. Resolve the profile from `config.profiles`. If `complete`, short-circuit.

2. **Build `PipelineContext`**: Construct a `PipelineContext` with the selected profile, backend, config, tracing, and mutable state containers.

3. **Commit + plan review**: After the compile pipeline, commit plan artifacts and run plan-review-cycle (same as today but using the stage or the existing inline code). The plan-review-cycle is part of the compile stage list, so it runs as a pipeline stage.

4. **Expedition handling**: The `module-planning`, `cohesion-review-cycle`, and `compile-expedition` stages are in the expedition profile's compile list. They run in sequence as part of the pipeline iteration.

```typescript
async *compile(source: string, options: Partial<CompileOptions> = {}): AsyncGenerator<EforgeEvent> {
  // ... existing phase:start, source resolution ...

  try {
    // Profile selection pre-step (when profiles are available)
    let selectedProfile = this.config.profiles['excursion']; // default fallback
    // ... run lightweight selection, parse plan:profile event, resolve profile ...

    const ctx: PipelineContext = {
      backend: this.backend,
      config: this.config,
      profile: selectedProfile,
      tracing,
      cwd,
      planSetName,
      sourceContent,
      verbose: options.verbose,
      auto: options.auto,
      abortController: options.abortController,
      onClarification: this.onClarification,
      plans: [],
      expeditionModules: [],
    };

    // Run compile pipeline
    yield* runCompilePipeline(ctx);

    // Commit plan artifacts (required for worktree-based builds)
    if (ctx.plans.length > 0) {
      const planDir = resolve(cwd, 'plans', planSetName);
      await exec('git', ['add', planDir], { cwd });
      await exec('git', ['commit', '-m', `plan(${planSetName}): initial planning artifacts`], { cwd });
    }
  } finally {
    // ... existing phase:end, tracing flush ...
  }
}
```

Note: The git commit of plan artifacts happens *between* compile stages. Specifically, after `planner` (or after `compile-expedition` for expeditions) and before `plan-review-cycle`. This requires either:
- (a) Making the commit a pipeline stage itself (`commit-artifacts`), or
- (b) Keeping it as inline logic in `compile()` between `runCompilePipeline()` and a separate `plan-review-cycle` call.

**Decision**: Option (b) - keep the git commit inline in `compile()`. The commit is engine infrastructure, not an agent stage. The compile pipeline runs all stages *except* `plan-review-cycle`, then the engine commits, then runs `plan-review-cycle` as a separate call. This is achieved by splitting the stage iteration: iterate stages before `plan-review-cycle`, commit, then run `plan-review-cycle`.

Actually, a cleaner approach: the `planner` stage already handles the full planning flow. The `plan-review-cycle` stage already knows about git (it runs reviewers that read committed files). So the sequence is:
1. Run all compile stages up to and including the last stage before `plan-review-cycle`
2. Commit artifacts
3. Run `plan-review-cycle` stage

This can be encoded as:
```typescript
for (const stageName of ctx.profile.compile) {
  if (stageName === 'plan-review-cycle') {
    // Commit artifacts before plan review
    if (ctx.plans.length > 0) {
      await commitPlanArtifacts(cwd, planSetName);
    }
  }
  const stage = getCompileStage(stageName);
  yield* stage(ctx);
}
```

#### `build()` refactor

The planRunner closure inside `build()` is refactored to iterate `profile.build` stages instead of the hardcoded implement → review → review-fix → evaluate sequence:

```typescript
const planRunner = async function* (planId, worktreePath) {
  const planFile = planFileMap.get(planId);
  if (!planFile) {
    yield { type: 'build:failed', planId, error: `Plan file not found: ${planId}` };
    return;
  }

  const buildCtx: BuildStageContext = {
    ...pipelineCtx,  // base PipelineContext
    planId,
    worktreePath,
    planFile,
    orchConfig,
    reviewIssues: [],
  };

  yield* runBuildPipeline(buildCtx);
};
```

The `pipelineCtx` is constructed from the resolved profile (loaded from config) and threaded into the planRunner.

For `build()`, the profile is determined by looking at the plan set's metadata or using the default profile. Since `build()` doesn't run a planner, the profile must either:
- Be stored in the orchestration config (plan-time metadata), or
- Default to `excursion` (the safe default that matches today's behavior)

**Decision**: Default to `excursion` for `build()` when no profile is stored. A future enhancement can store the selected profile name in `orchestration.yaml` during compile and read it back during build.

#### `adopt()` refactor

The adopt flow uses the assessor for profile/scope selection. After the assessor emits `plan:profile`, the engine resolves the profile and uses its build pipeline config. The compile pipeline doesn't apply to adopt (adopt skips planning). The existing delegation to `runPlanner()` for excursion/expedition scope continues as today, with the planner also selecting a profile.

### `src/engine/index.ts` Changes

Add re-exports:

```typescript
// --- pipeline ---
export type { PipelineContext, BuildStageContext, CompileStage, BuildStage } from './pipeline.js';
export { getCompileStage, getBuildStage, registerCompileStage, registerBuildStage, runCompilePipeline, runBuildPipeline } from './pipeline.js';
```

## Testing Strategy

### Unit Tests

All tests in `test/pipeline.test.ts` (new file).

**Stage registry**:
- `getCompileStage('planner')` returns a function (built-in stage registered at module load)
- `getCompileStage('nonexistent')` throws `Error` with message containing `"Unknown compile stage"`
- `getBuildStage('implement')` returns a function
- `getBuildStage('nonexistent')` throws `Error` with message containing `"Unknown build stage"`
- `registerCompileStage('custom', fn)` followed by `getCompileStage('custom')` returns `fn`
- `registerBuildStage('custom', fn)` followed by `getBuildStage('custom')` returns `fn`

**`runCompilePipeline`**:
- With a profile having `compile: ['planner', 'plan-review-cycle']`, calls both stages in order. Test with stub stages that yield marker events (e.g., `plan:progress` with stage name). Verify marker events appear in order.
- With a profile having `compile: ['planner']` (no plan-review-cycle), only the planner stage runs.
- With an empty `compile: []`, yields zero events.
- With an unknown stage name in `compile`, throws `Error` containing `"Unknown compile stage"`.

**`runBuildPipeline`**:
- With a profile having `build: ['implement', 'review', 'review-fix', 'evaluate']`, calls all four stages in order. Test with stub stages yielding marker events.
- Emits `build:start` before first stage and `build:complete` after last stage.
- With `build: ['implement', 'validate']` (custom profile), calls implement then validate.
- With an unknown stage name in `build`, throws `Error` containing `"Unknown build stage"`.

**Agent config threading** (tested via stub stages):
- When `profile.agents.builder.maxTurns` is set to 25, the `implement` stage passes `maxTurns: 25` to the backend (verified via StubBackend that records options).
- When `profile.agents.builder` is undefined, the `implement` stage falls back to `config.agents.maxTurns` (the global default).

**`PipelineContext` mutable state**:
- When the `planner` stage sets `ctx.plans`, the `plan-review-cycle` stage can read `ctx.plans`. Test by running two stub stages where the first sets context and the second asserts it.

### Integration Tests (not unit-tested per CLAUDE.md conventions)

- `EforgeEngine.compile()` with built-in profiles produces identical event sequences to today's hardcoded flow
- `EforgeEngine.build()` planRunner iterates build stages from the resolved profile
- `EforgeEngine.adopt()` handles profile selection from assessor

## Verification

- [ ] `pnpm type-check` passes with zero errors after all changes
- [ ] `pnpm test` passes - all existing tests remain green, all new tests pass
- [ ] `getCompileStage('planner')` returns a function without throwing
- [ ] `getCompileStage('nonexistent')` throws an `Error` whose message contains `"Unknown compile stage"`
- [ ] `getBuildStage('implement')` returns a function without throwing
- [ ] `getBuildStage('nonexistent')` throws an `Error` whose message contains `"Unknown build stage"`
- [ ] `registerCompileStage('test-stage', fn)` makes the stage retrievable via `getCompileStage('test-stage')`
- [ ] `runCompilePipeline` with `compile: ['planner', 'plan-review-cycle']` yields events from both stages in that order
- [ ] `runCompilePipeline` with `compile: []` yields zero events from the pipeline itself
- [ ] `runBuildPipeline` emits `build:start` as the first event and `build:complete` as the last event
- [ ] `runBuildPipeline` with `build: ['implement', 'review', 'review-fix', 'evaluate']` calls all four stages in sequence
- [ ] When `profile.agents.builder.maxTurns` is 25, the `implement` stage's backend call receives `maxTurns: 25` (not the default 50)
- [ ] When `profile.agents.builder` is undefined, the `implement` stage uses `config.agents.maxTurns` as the maxTurns value
- [ ] `PipelineContext.plans` set by the `planner` stage is readable by subsequent stages in the same pipeline run
- [ ] `EforgeEngineOptions.profileOverrides` is typed as `Record<string, PartialProfileConfig> | undefined`
- [ ] Built-in compile stages registered: `planner`, `plan-review-cycle`, `module-planning`, `cohesion-review-cycle`, `compile-expedition` (5 stages in the compile registry)
- [ ] Built-in build stages registered: `implement`, `review`, `review-fix`, `evaluate`, `validate` (5 stages in the build registry)
- [ ] `PipelineContext`, `BuildStageContext`, `CompileStage`, `BuildStage` types are re-exported from `src/engine/index.ts`
- [ ] The default `build()` behavior (without a stored profile) uses the `excursion` profile's build stages, which are `['implement', 'review', 'review-fix', 'evaluate']` - matching today's hardcoded sequence
- [ ] `compile()` commits plan artifacts before running the `plan-review-cycle` stage
- [ ] `compile()` with a profile whose compile list is `['planner']` (no plan-review-cycle) still commits artifacts and does not run plan review
- [ ] When the planner selects `complete` during profile selection, `compile()` short-circuits with `plan:complete` containing zero plans and does not iterate any compile stages
