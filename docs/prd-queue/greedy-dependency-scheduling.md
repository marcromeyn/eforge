# Greedy Dependency Scheduling

## Problem

The orchestrator executes plans in strict waves derived from topological sort. All plans in a wave must finish before any plan in the next wave can start. This creates unnecessary idle time - if plans A and B are in wave one and plan C depends only on A, C waits for both A and B even though its only real constraint is A.

The dependency graph already encodes the real safety invariant: a plan can start once all its declared dependencies are merged. Waves are a conservative approximation of that invariant, not the invariant itself.

## Goal

Replace wave-based scheduling with greedy dependency-driven scheduling. A plan starts as soon as all its dependencies are merged into the base branch. This maximizes throughput without changing the correctness model - the dependency graph is still the source of truth.

## Current behavior

```
Wave 1: [A, B] → build A and B in parallel → merge A, merge B
Wave 2: [C]    → build C → merge C
                  ↑ C waits for B even though it only depends on A
```

## Proposed behavior

```
t0: Start A and B (no dependencies)
t1: A completes → merge A → start C (all deps merged)
t2: B completes → merge B
t3: C completes → merge C
     ↑ C started as soon as A merged, didn't wait for B
```

## Design

### Scheduler loop

The orchestrator becomes an event-driven scheduler instead of a nested wave loop. The core loop:

1. Initialize: start all plans with zero unmet dependencies
2. Wait for any running plan to complete
3. Merge the completed plan into baseBranch (serialized - one merge at a time)
4. Check all pending plans - start any whose dependencies are now all merged
5. Repeat until no plans remain (pending or running)

### Merge serialization

Merges into baseBranch must be serialized - concurrent merges to the same branch are unsafe. When multiple plans complete around the same time, queue them and merge one at a time. After each merge, re-check pending plans before merging the next (a merge might unblock a high-priority plan).

### Worktree lifecycle

No change to worktree semantics. Each plan still gets its own worktree branched from baseBranch at the point it starts. The difference is that baseBranch may now include more merged changes at worktree creation time than it would in the wave model - this is strictly better since the builder sees a more complete picture.

### Failure propagation

Same as today - when a plan fails, all transitive dependents are marked blocked. The difference is this happens immediately rather than at wave boundaries, which means blocked plans never start at all (no wasted work).

### State tracking

Plan states remain the same (`pending`, `running`, `completed`, `merged`, `failed`, `blocked`). The `wave` concept disappears from the execution model. Events change:

- `wave:start` / `wave:complete` → removed or replaced with `schedule:start` / `schedule:plan:ready` events
- `merge:start` / `merge:complete` → unchanged
- Build events → unchanged

### Concurrency control

The existing `parallelism` setting still caps how many plans run concurrently. The scheduler tracks running count and only starts new plans when a slot opens up AND dependencies are met.

### Post-merge validation

No change. Validation commands still run once at the end after all plans are merged, with the same retry + fixer loop.

## Risks

The risks are engineering complexity, not correctness:

- **Merge conflict exposure is identical** to the wave model. Plans that were in the same wave already built against the same base without seeing each other's changes. Merging one before the other finishes doesn't change the other's conflict risk.
- **State machine complexity** increases. The scheduler needs to track which plans are ready, running, awaiting merge, and merged - reacting to completions dynamically rather than iterating a static wave list.
- **Event stream changes** - consumers (CLI display, monitor) that render wave progress need updating. The monitor UI shows wave-based progress bars today.

## Scope

### In scope

- Replace wave loop in `Orchestrator.execute()` with greedy scheduler
- Merge serialization queue
- Update state tracking (remove wave concept from execution)
- Update event types (replace wave events with scheduling events)
- Update CLI display and monitor UI for new event types
- Update orchestrator tests

### Out of scope

- Priority-based scheduling (all ready plans are equal)
- Speculative execution (starting a plan before deps are fully merged)
- Dynamic re-planning based on intermediate results
