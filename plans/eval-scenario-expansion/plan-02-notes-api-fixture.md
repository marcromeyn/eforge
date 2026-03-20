---
id: plan-02-notes-api-fixture
name: Notes API Fixture
depends_on: []
branch: eval-scenario-expansion/notes-api-fixture
---

# Notes API Fixture

## Architecture Context

The eval suite needs a third fixture to host 4 new scenarios covering doc-only updates, dead code cleanup, store refactoring, and search endpoint addition. The fixture must have intentional imperfections baked in - stale docs, dead code paths, and duplicated store patterns - so eforge has something real to fix/refactor/extend.

## Implementation

### Overview

Create `eval/fixtures/notes-api/` following the exact same conventions as `todo-api` and `workspace-api`: ESM-only Express API, in-memory store, vitest tests, same package.json/tsconfig.json/eforge.yaml structure. The fixture must pass `pnpm install && pnpm type-check && pnpm test` as-is.

### Key Decisions

1. Store duplicates the same CRUD pattern for both notes and tags (arrays + ID counters + get/create/update/delete) - gives the refactor-store scenario a real extraction target
2. `src/legacy/importer.ts` imports from `migrator.ts`, but nothing in app.ts, routes, or tests imports from legacy/ - making it unambiguously dead
3. `src/utils/format.ts` has `formatCsv()` and `src/utils/validate.ts` has `validateCsvRow()` that are dead (nothing calls them) but live alongside used functions - tests dead code cleanup within live files
4. `docs/README.md` references CSV import as if it still works and `docs/api-reference.md` has wrong response shapes - gives the doc-update scenario real staleness
5. Types are kept in a separate `types.ts` file (matching workspace-api convention) since both Note and Tag types are used across store and routes

## Scope

### In Scope
- Full fixture with ~15 source files
- Note CRUD routes (GET/POST/PATCH/DELETE /notes)
- Tag CRUD routes (GET/POST/DELETE /tags)
- In-memory store with duplicated patterns for both entities
- Dead code in `src/legacy/` (importer.ts, migrator.ts)
- Dead functions mixed into live util files (formatCsv, validateCsvRow)
- Intentionally stale docs (README.md, api-reference.md)
- Tests for notes, tags, and used format utils
- PRD directory structure (`docs/prd/`) for scenario PRDs (empty - PRDs come in plan-03)

### Out of Scope
- The PRD files themselves (plan-03)
- Search functionality (that's what the add-search scenario builds)

## Files

### Create
- `eval/fixtures/notes-api/package.json` — same deps as todo-api (express, vitest, tsx, typescript)
- `eval/fixtures/notes-api/tsconfig.json` — identical to todo-api
- `eval/fixtures/notes-api/vitest.config.ts` — identical to todo-api
- `eval/fixtures/notes-api/.gitignore` — node_modules, dist, .eforge
- `eval/fixtures/notes-api/eforge.yaml` — same postMergeCommands and hook config as todo-api
- `eval/fixtures/notes-api/src/index.ts` — Express server startup
- `eval/fixtures/notes-api/src/app.ts` — Express app with /notes and /tags router mounts
- `eval/fixtures/notes-api/src/types.ts` — Note and Tag interfaces
- `eval/fixtures/notes-api/src/store.ts` — duplicated CRUD patterns for notes + tags with clearAll()
- `eval/fixtures/notes-api/src/routes/notes.ts` — Note CRUD endpoints
- `eval/fixtures/notes-api/src/routes/tags.ts` — Tag CRUD endpoints
- `eval/fixtures/notes-api/src/utils/format.ts` — formatDate() + truncate() (used) + formatCsv() (dead)
- `eval/fixtures/notes-api/src/utils/validate.ts` — validateTitle() (used) + validateCsvRow() (dead)
- `eval/fixtures/notes-api/src/legacy/importer.ts` — dead: parseCSV() + importNotes(), imports migrator
- `eval/fixtures/notes-api/src/legacy/migrator.ts` — dead: migrate(), imported only by importer
- `eval/fixtures/notes-api/test/notes.test.ts` — note CRUD tests
- `eval/fixtures/notes-api/test/tags.test.ts` — tag CRUD tests
- `eval/fixtures/notes-api/test/format.test.ts` — tests for used format utils only
- `eval/fixtures/notes-api/docs/README.md` — INTENTIONALLY STALE: mentions CSV import, omits tag endpoints
- `eval/fixtures/notes-api/docs/api-reference.md` — INTENTIONALLY STALE: wrong response shapes, missing endpoints
- `eval/fixtures/notes-api/docs/prd/` — empty directory (PRDs created in plan-03)

## Verification

- [ ] `cd eval/fixtures/notes-api && pnpm install && pnpm type-check && pnpm test` passes with 0 errors
- [ ] `src/legacy/importer.ts` exists and exports `parseCSV()` and `importNotes()` functions
- [ ] `src/legacy/migrator.ts` exists and exports `migrate()` function
- [ ] `grep -r "from.*legacy" eval/fixtures/notes-api/src/app.ts eval/fixtures/notes-api/src/routes/ eval/fixtures/notes-api/test/` returns 0 matches (legacy is dead code)
- [ ] `src/utils/format.ts` contains `formatCsv()` function that is not imported by any route, test, or app file
- [ ] `src/utils/validate.ts` contains `validateCsvRow()` function that is not imported by any route, test, or app file
- [ ] `docs/README.md` contains the word "CSV" or "import" (stale reference to dead feature)
- [ ] `docs/api-reference.md` does not list `DELETE /tags/:id` endpoint (missing endpoint = staleness)
- [ ] `src/store.ts` has separate `notes` and `tags` arrays with near-identical CRUD functions for each (duplicated pattern)
- [ ] Notes test creates, reads, updates, and deletes notes
- [ ] Tags test creates, reads, and deletes tags
- [ ] Format test covers `formatDate()` and `truncate()` but NOT `formatCsv()`
