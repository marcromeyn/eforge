# Workflow Profiles Architecture

## Vision and Goals

Replace the hardcoded scope-to-pipeline mapping with config-driven **workflow profiles**. A profile declares which compile/build stages run, in what order, and with what agent parameters. The planner auto-selects a profile from available descriptions, and users can define custom profiles via `eforge.yaml` or `--profiles` files.

The key outcome: different types of work (migrations, security features, quick refactors) can run different agent pipelines without code changes - and those pipelines can be compared via the eval framework.

## Core Architectural Principles

### 1. Profiles live in config, not in code

Built-in profiles are constants in `DEFAULT_CONFIG.profiles` (same pattern as other defaults). They participate in the merge chain - a project-level `eforge.yaml` can override fields on a built-in profile by name. No separate "profile registry" or file-based profile definitions outside of config.

### 2. Profile selection is a pre-pipeline step

Profile selection happens *before* the compile pipeline starts, using a fixed planner config (not profile-dependent). This avoids the circular dependency of needing to run the planner to select a profile while the profile configures the planner. The selection pass is lightweight - the planner reads profile descriptions and the PRD, picks the best match, and emits a `plan:profile` event.

### 3. Pipeline stages are named units with a uniform interface

Each compile/build stage (e.g., `planner`, `plan-review-cycle`, `implement`, `review`) is a function that accepts a `PipelineContext` and yields `EforgeEvent`s. The engine iterates the stage list from the resolved profile and calls each stage in sequence. The complex expedition stages (`module-planning`, `cohesion-review-cycle`, `compile-expedition`) are encapsulated as single named stages.

### 4. Backwards-compatible event transition

`plan:profile` is the new canonical event. `plan:scope` continues to be emitted (derived from profile name when it matches a built-in) during the transition period. This keeps existing monitor UI, hooks, and tests functional while consumers migrate.

### 5. Extension chains resolve at config load time

Profile `extends` chains are resolved once during config loading, not at runtime. This keeps the engine simple - it only ever sees fully-resolved `ResolvedProfileConfig` objects. Circular extensions are detected and rejected at parse time.

## Shared Data Model

### ProfileConfig (raw, pre-resolution)

```typescript
interface ProfileConfig {
  description: string;
  extends?: string;
  compile?: string[];
  build?: string[];
  agents?: Partial<Record<AgentRole, AgentProfileConfig>>;
  review?: ReviewProfileConfig;
}
```

### ResolvedProfileConfig (after extension resolution)

```typescript
interface ResolvedProfileConfig {
  description: string;
  compile: string[];
  build: string[];
  agents: Partial<Record<AgentRole, AgentProfileConfig>>;
  review: ReviewProfileConfig;
}
```

### AgentProfileConfig (per-agent overrides)

```typescript
interface AgentProfileConfig {
  maxTurns?: number;
  prompt?: string;       // prompt name or path
  tools?: ToolPreset;    // 'coding' | 'none'
  model?: string;        // model override
}
```

### ReviewProfileConfig

```typescript
interface ReviewProfileConfig {
  strategy: 'auto' | 'single' | 'parallel';
  perspectives: string[];       // e.g., ['code', 'security']
  maxRounds: number;
  autoAcceptBelow?: 'suggestion' | 'warning';
  evaluatorStrictness: 'strict' | 'standard' | 'lenient';
}
```

### PipelineContext (threaded through stages)

```typescript
interface PipelineContext {
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
  expeditionModules?: ExpeditionModule[];
}
```

## Integration Contracts

### Config → Engine

- `EforgeConfig.profiles` is a `Record<string, ResolvedProfileConfig>` (extensions already resolved)
- The engine reads `config.profiles` to get the palette for profile selection
- After selection, the engine reads the selected profile's `compile`, `build`, `agents`, and `review` fields to configure the pipeline

### Engine → Agents

- Agent call sites read `profile.agents[role]` for maxTurns, prompt, tools, and model overrides
- `AgentRunOptions` gains an optional `model` field; `ClaudeSDKBackend` passes it to the SDK
- `loadPrompt()` supports path-based prompt resolution when the value contains `/`

### Engine → Events

- `plan:profile` event carries `{ profileName: string; rationale: string }`
- `plan:scope` continues to be emitted, derived from profile name when it matches `errand | excursion | expedition`
- Profile name is included in `phase:start` metadata for downstream consumers

### CLI → Engine

- `--profiles <path>` adds profiles from a YAML file to the palette
- Multiple `--profiles` flags layer on top of each other
- The flag is additive, not selective - it doesn't choose a profile, it adds options

### Config merge chain for profiles

```
built-in defaults (DEFAULT_CONFIG.profiles)
  → global ~/.config/eforge/config.yaml profiles section
  → project eforge.yaml profiles section
  → --profiles file(s) profiles section
  → resolve extends chains (detect cycles)
  → freeze into EforgeConfig.profiles
```

Profiles merge by name at each layer. Within a profile, `agents` shallow-merges per-agent. `compile` and `build` arrays replace (not concatenate). `review` shallow-merges per-field.

## Technical Decisions

### Pipeline stage registry vs. inline switch

**Decision**: Use a stage registry (Map of stage name to factory function) rather than inline switch statements.

**Rationale**: The registry allows profiles to reference stages by name without the engine knowing all possible stages at compile time. It also makes testing easier - tests can register stub stages. The factory pattern aligns with the existing `runPlanner`, `builderImplement`, etc. function structure.

### Profile selection via planner vs. separate agent

**Decision**: Use the existing planner agent for profile selection, not a separate "profile selector" agent.

**Rationale**: The planner already explores the codebase and understands the PRD. A separate agent would duplicate that work. The selection pass uses fixed default config (not profile-dependent) to avoid the chicken-and-egg problem. This is the same agent with a different prompt section - not a fundamentally different operation.

### `plan:scope` transition strategy

**Decision**: Keep `plan:scope` as a derived event during transition, emit alongside `plan:profile`.

**Rationale**: Ripping out `plan:scope` would break the monitor UI, hooks, CLI display, and tests simultaneously. The transition approach lets each consumer migrate independently. `plan:scope` can be deprecated after all consumers switch to `plan:profile`.

### Review cycle unification (deferred)

**Decision**: Start with option 2 (configure separately) - make the build-phase review accept config from the profile's `review` section without unifying with `runReviewCycle()`.

**Rationale**: Unifying the two review paths is a larger refactor with its own risks. The PRD says either approach works. Starting with separate configuration gets profiles shipping faster. Unification can follow as an incremental improvement.

### Eval integration (deferred)

**Decision**: Defer eval profile comparison to a follow-up. The `eval/scenarios.yaml` profile field and comparison reporting are not part of this initial implementation.

**Rationale**: Profiles need to ship and stabilize before comparison tooling makes sense. The eval framework can add profile support once the config schema is settled.

## Quality Attributes

- **Backwards compatibility**: Default behavior is identical. Built-in profiles encode today's hardcoded behavior. `plan:scope` continues to work.
- **Extensibility**: Users can define custom profiles with `extends` inheritance. New stages can be registered without modifying existing code.
- **Testability**: Profile resolution (extension chains, merge semantics) is pure logic testable without backends. Pipeline stages are individually testable via `StubBackend`.
- **Observability**: `plan:profile` events carry the selected profile name and rationale. The monitor can display and filter by profile.
