# Analysis: OpenProse + eforge Integration

## Executive Summary

OpenProse and eforge solve overlapping problems from opposite directions. Prose is a **language for describing multi-agent workflows** declaratively; eforge is a **purpose-built engine that executes one specific multi-agent workflow** (spec-to-verified-code). They are complementary, not competing. The eforge pipeline *could* be represented in Prose, but doing so would trade engine-level guarantees for generality. A more productive integration is using Prose as an authoring layer *on top of* eforge, or using eforge as a specialized backend that Prose programs can invoke.

---

## System Comparison

| Dimension | eforge | OpenProse |
|-----------|--------|-----------|
| **What it is** | Agentic build engine | Multi-agent workflow language |
| **Core abstraction** | Pipeline stages + agent roles | Services with contracts (requires/ensures) |
| **Execution model** | Topological sort of plan dependency graph, semaphore-limited parallelism | Forme container auto-wires contracts, VM spawns subagent sessions |
| **State** | `.eforge/state.json` + git worktrees | `.prose/runs/{id}/` + workspace/bindings filesystem |
| **Data flow** | Implicit via filesystem (worktree contents) | Explicit via declared contracts + file pointers |
| **Orchestration** | Hardcoded pipeline phases (compile -> build -> validate -> finalize) | User-defined program composition |
| **Error handling** | Agent retry loops, validation-fixer, gap-closer | Declared `errors:` contracts, degraded output paths |
| **Parallelism** | Dependency-wave scheduling with `AsyncEventQueue` | Forme detects independent services, VM batches `Task` calls |
| **Extension** | Agent roles + backend abstraction | Any markdown component with contracts |
| **Runtime** | Node.js process, Claude Agent SDK / Pi SDK | Inside an AI session (Claude Code, OpenCode, Amp) |

---

## Can eforge's Flow Be Represented in Prose?

**Yes, structurally.** The eforge pipeline maps naturally onto Prose concepts:

### Mapping

```
eforge concept          -> Prose concept
─────────────────────────────────────────
EforgeEngine            -> Program (kind: program)
Agent role (planner,    -> Service (kind: service)
  builder, reviewer...)
PipelineComposition     -> Program's services: list + execution block
Plan dependency graph   -> Forme auto-wiring via requires/ensures
Worktree isolation      -> Workspace/bindings separation
EforgeEvent stream      -> VM state.md log
Review cycle            -> Loop pattern (retry with evaluator)
Expedition waves        -> Parallel execution pattern
```

### Example: Excursion as a Prose Program

```yaml
---
name: excursion
kind: program
services: [planner, pipeline-composer, builder, reviewer, evaluator, validator]
---

requires:
- prd: a product requirements document describing desired changes
- codebase_context: access to the target repository

ensures:
- verified_code: implemented, reviewed, and validated code changes merged to the target branch

### Execution
let plan = call planner with prd, codebase_context
let pipeline = call pipeline-composer with plan
let implementation = call builder with plan
loop:
  let review = call reviewer with implementation
  let verdict = call evaluator with review, implementation
  break if verdict.accepted
  let implementation = call builder with review.issues, implementation
let result = call validator with implementation
```

### What Works

- **Service contracts** cleanly express what each agent role needs and produces.
- **Forme's auto-wiring** can infer the planner->builder->reviewer dependency chain from contracts alone.
- **Parallel execution** of independent plans maps to Prose's parallel pattern.
- **Shapes** can express delegation boundaries (e.g., builder delegates to no one, reviewer is prohibited from editing code).
- **Persistent agents** could model stateful reviewers that remember prior feedback rounds.

### What Breaks or Gets Worse

1. **Git worktree management.** eforge's worktree lifecycle (create per-plan, merge, cleanup) is deeply integrated with its orchestrator. Prose has no concept of git worktrees -- a Prose service would need to shell out to git, losing the engine's lock-retry, merge-conflict-resolution, and state-tracking guarantees.

2. **Typed event stream.** eforge emits a rich discriminated union of 60+ event types (`EforgeEvent`) consumed by the monitor UI, CLI renderer, and plugin. Prose's state tracking is a simple append-only `state.md` log with emoji markers. Representing `build:review:start { planId, round, perspective }` in Prose would require custom conventions outside the language.

3. **Pipeline composition is dynamic.** eforge's pipeline-composer agent *selects which stages to run* based on scope analysis. In Prose, the service list and execution block are static per program definition. You'd need a meta-program or conditional execution to replicate this.

4. **Concurrency primitives.** eforge uses a counting semaphore + async event queue for fine-grained parallelism control. Prose's parallelism is batch-level (all independent services in a wave). There's no way to express "run up to 3 plans concurrently from a pool of 8" in Prose without VM extensions.

5. **Resume/recovery.** eforge persists plan-level state and can resume a failed build from the last successful plan. Prose's resumability is session-scoped -- if the VM session dies, you restart from the manifest.

6. **Review cycle semantics.** eforge's review-evaluate-fix loop has specific semantics: the evaluator compares against a pre-implementation commit, issues have severity tiers, and auto-accept thresholds are configurable. Expressing this in Prose requires encoding these semantics into service contracts and strategies, which is possible but verbose.

---

## Integration Strategies

### Option A: Prose as eforge's Authoring Layer

**Prose programs define *what* to build; eforge executes *how*.**

A Prose program could describe a multi-service workflow where one service is "invoke eforge":

```yaml
---
name: feature-factory
kind: program
services: [requirements-analyst, eforge-builder, qa-tester]
---

requires:
- feature_request: a natural language feature request

ensures:
- merged_pr: a pull request with implemented, tested code
```

The `eforge-builder` service would invoke `eforge build` as a tool, receiving the refined PRD from the requirements-analyst and producing code changes. This keeps eforge's engine guarantees intact while letting Prose orchestrate the broader workflow (requirements gathering, QA, deployment).

**Verdict:** Most practical. Preserves both systems' strengths. eforge becomes a "build service" callable from Prose programs.

### Option B: Rewrite eforge Internals in Prose

Replace `src/engine/orchestrator/` and agent prompt construction with Prose programs and services.

**Verdict:** Architecturally clean but impractical. You'd lose:
- TypeScript type safety on the event stream
- Fine-grained concurrency control
- Git worktree lifecycle management
- The monitor UI's real-time event consumption
- Resume/recovery semantics

The engine's value is precisely in these implementation details that a general-purpose workflow language can't express without becoming a general-purpose programming language.

### Option C: Prose-Flavored Plan Files

Replace eforge's plan file format (YAML frontmatter + markdown) with Prose component format. Plans become Prose services with contracts:

```yaml
---
name: implement-oauth
kind: service
---

requires:
- auth_spec: OAuth2 implementation specification
- existing_auth_module: current authentication code

ensures:
- oauth_implementation: working OAuth2 flow with tests
- migration_guide: upgrade path from current auth

errors:
- incompatible_api: third-party API doesn't support required OAuth flow

strategies:
- If the existing module uses session-based auth, preserve backward compatibility
```

**Verdict:** Interesting for expressiveness. The `requires/ensures` contracts give the planner agent structured output format. The `errors` and `strategies` fields add resilience semantics that eforge's current plan format lacks. This could be adopted incrementally without changing the engine.

### Option D: Shared Service Library

Build a library of Prose services that wrap eforge's agent roles. These become reusable building blocks in both systems:

- `eforge/reviewer` -- a Prose service wrapping eforge's review agent with contracts
- `eforge/planner` -- a Prose service wrapping eforge's planning agent
- etc.

**Verdict:** Useful if Prose gains traction as a standard. Creates a bridge without coupling the systems.

---

## Recommendation

**Start with Option A (Prose as authoring layer) + elements of Option C (contract-enriched plan files).**

1. **Create an `eforge-builder` Prose service** that wraps `eforge build` as a tool invocation. This lets Prose programs orchestrate broader workflows that include code generation as one step.

2. **Adopt Prose's `requires/ensures/errors/strategies` vocabulary in eforge plan files.** This is a format change, not an engine change. It makes plans more expressive and self-documenting without altering execution semantics.

3. **Do not rewrite eforge's orchestrator in Prose.** The engine's value is in its implementation-level guarantees (worktree isolation, typed events, semaphore parallelism, resume). These are below the abstraction level Prose operates at.

4. **Watch Prose's VM evolution.** If Prose adds structured event emission, fine-grained concurrency, and persistent state recovery, Option B becomes more viable. Today it would be a regression.

---

## Conclusion

Prose and eforge are at different abstraction levels. Prose is a workflow *language* -- it describes what agents do and how they connect. eforge is a workflow *engine* -- it implements specific execution guarantees for a specific domain (code generation). The right integration is compositional: Prose programs can invoke eforge as a service, and eforge can adopt Prose's contract vocabulary to make its plan files more expressive. A full rewrite of eforge in Prose would sacrifice the engine-level guarantees that make eforge valuable.
