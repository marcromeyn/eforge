---
id: plan-03-prds-and-scenarios
name: PRDs and Scenario Config
depends_on: [plan-01-assertion-infrastructure, plan-02-notes-api-fixture]
branch: eval-scenario-expansion/prds-and-scenarios
---

# PRDs and Scenario Config

## Architecture Context

With assertion infrastructure in place and the notes-api fixture created, this plan adds all 6 new PRDs and wires up the complete scenarios.yaml with 9 scenarios and expect configurations. PRDs follow the conventions established by existing fixture docs (markdown with Overview, Requirements, Non-goals sections).

## Implementation

### Overview

Create 6 new PRD files across the 3 fixtures, then update scenarios.yaml with all 9 scenarios including expect fields for planner decision validation.

### Key Decisions

1. PRDs are written to test specific planner decisions - each PRD is crafted so the "correct" planner behavior is unambiguous (e.g., the skip PRD describes exactly what db.ts already implements)
2. The notes-api PRDs live under `docs/prd/` (subdirectory) since there are 4 of them, while existing todo-api and workspace-api PRDs live directly in `docs/`
3. `todo-api/docs/skip-already-done.md` deliberately uses the exact function signatures and interface fields from `db.ts` so the planner has no ambiguity about whether work is complete
4. `workspace-api/docs/add-extension-modules.md` describes 3 truly independent modules that create only new files - designed to unambiguously trigger expedition scope
5. Expect fields are conservative - we assert mode and stage presence/absence but not review perspective selection (that's harder to validate reliably)

## Scope

### In Scope
- 4 notes-api PRDs: update-docs, refactor-store, dead-code-cleanup, add-search
- 1 workspace-api PRD: add-extension-modules (expedition)
- 1 todo-api PRD: skip-already-done (skip detection)
- Complete scenarios.yaml with 9 scenarios and expect configs on all of them

### Out of Scope
- Running the scenarios (that's manual eval)
- Perspective assertions in expect config

## Files

### Create
- `eval/fixtures/notes-api/docs/prd/update-docs.md` — PRD: fix stale README and API reference
- `eval/fixtures/notes-api/docs/prd/refactor-store.md` — PRD: extract EntityStore<T> from duplicated patterns
- `eval/fixtures/notes-api/docs/prd/dead-code-cleanup.md` — PRD: remove legacy/ and dead utils
- `eval/fixtures/notes-api/docs/prd/add-search.md` — PRD: add GET /notes/search?q= with test spec
- `eval/fixtures/workspace-api/docs/add-extension-modules.md` — PRD: 3 independent feature modules (expedition)
- `eval/fixtures/todo-api/docs/skip-already-done.md` — PRD: describes what db.ts already implements (skip)

### Modify
- `eval/scenarios.yaml` — replace all content: 9 scenarios with expect fields, renamed IDs

## Verification

- [ ] `eval/scenarios.yaml` contains exactly 9 scenario entries
- [ ] Scenario IDs match: `todo-api-errand-health-check`, `todo-api-excursion-jwt-auth`, `todo-api-errand-skip`, `workspace-api-excursion-engagement`, `workspace-api-expedition-extensions`, `notes-api-errand-update-docs`, `notes-api-excursion-refactor-store`, `notes-api-excursion-dead-code`, `notes-api-excursion-search`
- [ ] All 9 scenarios have an `expect` field with at least a `mode` value
- [ ] `todo-api-errand-skip` has `expect.skip: true`
- [ ] `todo-api-errand-health-check` has `expect.buildStagesExclude` containing `test-cycle`
- [ ] `notes-api-excursion-search` has `expect.buildStagesContain` containing `test-cycle`
- [ ] `workspace-api-expedition-extensions` has `expect.mode: expedition`
- [ ] `skip-already-done.md` describes a Todo interface with id, title, completed, createdAt fields and CRUD functions matching db.ts
- [ ] `add-extension-modules.md` describes 3 independent modules (bookmarks, categories, activity) that each create only new files
- [ ] `update-docs.md` references the stale README and api-reference.md files
- [ ] `refactor-store.md` references the duplicated CRUD patterns in store.ts
- [ ] `dead-code-cleanup.md` references `src/legacy/`, `formatCsv()`, and `validateCsvRow()`
- [ ] `add-search.md` includes explicit test cases for the search endpoint
- [ ] `eval/run.sh --dry-run` completes without errors for all 9 scenarios (fixture dirs exist, PRD files exist)
