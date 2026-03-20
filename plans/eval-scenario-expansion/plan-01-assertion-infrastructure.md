---
id: plan-01-assertion-infrastructure
name: Assertion Infrastructure
depends_on: []
branch: eval-scenario-expansion/assertion-infrastructure
---

# Assertion Infrastructure

## Architecture Context

The eval suite currently checks only whether eforge succeeds and validation commands pass. This plan adds infrastructure to assert planner decisions - scope selection, build stage composition, and skip detection - so new scenarios can validate that the planner made the right choices, not just that code compiles.

## Implementation

### Overview

Add an `expect` field to scenarios.yaml, preserve orchestration.yaml in result dirs, create a TypeScript expectation checker, and wire it into the runner with summary table output.

### Key Decisions

1. `expect` is optional per-scenario - existing scenarios work unchanged until expect fields are added
2. orchestration.yaml is copied from the workspace's `plans/*/orchestration.yaml` after eforge completes but before workspace cleanup - same pattern as monitor.db preservation
3. `check-expectations.ts` reads orchestration.yaml + monitor.db directly rather than going through result.json - keeps the checker self-contained
4. The summary table gets an "Expect" column between "Validate" and "Tokens" - pass/fail or "-" when no expectations defined
5. A scenario "passes" overall only when eforge + validation + expectations all pass

## Scope

### In Scope
- `expect` field schema in scenarios.yaml (mode, buildStagesContain, buildStagesExclude, skip)
- Parsing expect config in `run.sh`'s `parse_scenarios()` and passing to `run-scenario.sh`
- Preserving orchestration.yaml files in `run-scenario.sh`
- `eval/lib/check-expectations.ts` that reads orchestration.yaml + monitor.db and returns structured pass/fail
- Wiring check-expectations into `run-scenario.sh` after `build-result.ts`
- Updating `run.sh` summary table with Expect column
- Updating pass/fail logic to include expectation results

### Out of Scope
- Perspective assertions (e.g., checking `review.perspectives` contains `security`) - can be added later
- Plan count assertions for expedition scenarios

## Files

### Create
- `eval/lib/check-expectations.ts` — reads orchestration.yaml + monitor.db, checks expect config, writes expectations to result.json

### Modify
- `eval/scenarios.yaml` — rename 3 existing scenario IDs to match `<fixture>-<scope>-<slug>` convention (no expect fields yet - those come in plan-03)
- `eval/run.sh` — extend `parse_scenarios()` to extract `expect` JSON, add Expect column to summary table, update pass/fail logic to include expectations
- `eval/lib/run-scenario.sh` — accept expect JSON as 9th arg, preserve orchestration.yaml after eforge completes, run `check-expectations.ts` after `build-result.ts`

## Verification

- [ ] `parse_scenarios()` outputs a 6th tab-separated field containing the JSON-encoded expect object (empty `{}` when no expect defined)
- [ ] After eforge completes, `run-scenario.sh` copies `plans/*/orchestration.yaml` to `$scenario_dir/orchestration.yaml`
- [ ] `check-expectations.ts` exits 0 and writes an `expectations` key to result.json when expect config has `mode: errand` and orchestration.yaml has `mode: errand`
- [ ] `check-expectations.ts` exits 0 with a failing expectation when modes don't match
- [ ] `check-expectations.ts` checks `buildStagesContain` by scanning all plan entries' `build` arrays in orchestration.yaml (flattening parallel groups)
- [ ] `check-expectations.ts` checks `buildStagesExclude` by scanning all plan entries' `build` arrays in orchestration.yaml (flattening parallel groups)
- [ ] `check-expectations.ts` checks `skip: true` by querying monitor.db for a `plan:skip` event
- [ ] Summary table shows "Expect" column with PASS/FAIL/"-" per scenario
- [ ] A scenario with eforge PASS + validate PASS + expect FAIL counts as failed in the overall passed count
- [ ] Renamed scenario IDs in scenarios.yaml: `todo-api-errand-health-check`, `todo-api-excursion-jwt-auth`, `workspace-api-excursion-engagement`
