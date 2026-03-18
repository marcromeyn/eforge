---
title: Schema-Driven Agent Prompts: Zod-to-YAML Across All Structured Blocks
created: 2026-03-18
status: pending
---

# Schema-Driven Agent Prompts: Zod-to-YAML Across All Structured Blocks

## Problem / Motivation

The `<generated-profile>` work establishes a pattern: define Zod schemas with `.describe()`, generate YAML via `z.toJSONSchema()` + `yaml.stringify()`, inject into prompts. This keeps format instructions in sync with validation. Currently, other structured XML blocks that agents emit (review issues, evaluations, clarifications, staleness verdicts, modules, plan frontmatter) use hand-written types and manual format documentation in prompts - these are not schema-driven and can drift out of sync with their parsers.

## Goal

Apply the Zod-to-YAML schema pattern to all structured XML blocks across every agent prompt, so format instructions are generated from the same schemas that validate agent output.

## Approach

Create a new leaf-level `src/engine/schemas.ts` file containing all Zod schemas with `.describe()` annotations and a shared `getSchemaYaml(schema, cacheKey)` utility that converts schemas to YAML via `z.toJSONSchema()`. Derive TypeScript types from schemas instead of hand-writing interfaces. Inject schema YAML into prompts via template variables alongside existing XML examples (examples stay for serialization format, schema YAML documents field semantics and allowed values). Optionally add `schema.safeParse()` validation in parsers.

**Implementation order:**

- **Phase 1**: `schemas.ts` + ReviewIssue (highest multiplier - 7 prompts). Establishes the pattern.
- **Phase 2**: EvaluationVerdict (3 prompts, different XML structure - validates pattern flexibility).
- **Phase 3**: Clarification, Staleness, Module (1-2 prompts each, straightforward).
- **Phase 4**: PlanFile frontmatter (lowest priority, YAML not XML).

Phase 1 must complete first (creates `schemas.ts` and utilities). Phases 2-4 are independent of each other.

## Scope

### In scope — Convert (structured types with enums/validation)

| Block | Prompts | Parser | Current type location |
|-------|---------|--------|----------------------|
| `<review-issues>` | 7 reviewer prompts | `reviewer.ts:parseReviewIssues()` | `events.ts:ReviewIssue` |
| `<evaluation>` | 3 evaluator prompts | `builder.ts:parseEvaluationBlock()` | `builder.ts:EvaluationVerdict` |
| `<clarification>` | planner.md | `common.ts:parseClarificationBlocks()` | `events.ts:ClarificationQuestion` |
| `<staleness>` | staleness-assessor.md | `common.ts:parseStalenessBlock()` | `common.ts:StalenessVerdict` |
| `<modules>` | planner.md | `common.ts:parseModulesBlock()` | `events.ts:ExpeditionModule` |
| Plan frontmatter | planner.md, module-planner.md | `plan.ts:parsePlanFile()` | `events.ts:PlanFile` |

### Out of scope — Skip (too simple for schema overhead)

- `<skip>` — bare string
- `<profile>` — name + rationale text
- `<doc-update-summary>` — single count attribute

### Detailed changes

**1. Create `src/engine/schemas.ts`**

New file - leaf-level (imports only `zod/v4` and `yaml`, no engine imports). Contains:

**All Zod schemas with `.describe()` annotations:**
- `reviewIssueSchema` — severity enum, category (string base), file, line, description, fix
- Per-perspective category enums: `reviewCategoriesGeneral`, `reviewCategoriesCode`, `reviewCategoriesSecurity`, `reviewCategoriesApi`, `reviewCategoriesDocs`, `reviewCategoriesPlanReview`
- `evaluationEvidenceSchema` — staged, fix, rationale, ifAccepted, ifRejected
- `evaluationVerdictSchema` — file, action enum, reason, hunk, evidence
- `clarificationQuestionSchema` — id, question, context, options, default
- `stalenessVerdictSchema` — verdict enum, reason, revision
- `expeditionModuleSchema` — id, description, dependsOn
- `planFileFrontmatterSchema` — id, name, depends_on, branch, migrations

**Shared utility:**
- `getSchemaYaml(schema, cacheKey)` — `z.toJSONSchema()` → strip `$schema`/`~standard` → `yaml.stringify()`, cached per key
- Convenience exports: `getReviewIssueSchemaYaml(categorySchema?)`, `getEvaluationSchemaYaml()`, etc.

**2. Derive types from schemas — `src/engine/events.ts`**

Replace hand-written interfaces with type aliases:
- `ReviewIssue` → `z.output<typeof reviewIssueSchema>`
- `ClarificationQuestion` → `z.output<typeof clarificationQuestionSchema>`
- `ExpeditionModule` → `z.output<typeof expeditionModuleSchema>`

Similarly in `builder.ts` for `EvaluationVerdict`/`EvaluationEvidence`, and `common.ts` for `StalenessVerdict`.

**3. Update prompts — inject `{{schema_yaml}}` variables**

Each prompt gets a schema YAML section alongside its existing XML example. The XML example stays (shows serialization format), the schema YAML documents field semantics and allowed values.

**Reviewer prompts** (7 files): Add `{{review_issue_schema}}` with perspective-specific categories:
- `reviewer.md` → `reviewCategoriesGeneral`
- `reviewer-code.md` → `reviewCategoriesCode`
- `reviewer-security.md` → `reviewCategoriesSecurity`
- `reviewer-api.md` → `reviewCategoriesApi`
- `reviewer-docs.md` → `reviewCategoriesDocs`
- `plan-reviewer.md`, `cohesion-reviewer.md` → `reviewCategoriesPlanReview`

**Evaluator prompts** (3 files): Add `{{evaluation_schema}}`:
- `plan-evaluator.md`, `cohesion-evaluator.md`, builder's evaluator prompt

**Planner prompt**: Add `{{clarification_schema}}`, `{{module_schema}}`, `{{plan_frontmatter_schema}}`

**Staleness assessor prompt**: Add `{{staleness_schema}}`

**4. Update agent runners — pass schema YAML to `loadPrompt()`**

- `reviewer.ts` `composeReviewPrompt()` — generate and pass review issue schema YAML
- `parallel-reviewer.ts` — pass perspective-specific schema per prompt
- `plan-reviewer.ts`, `cohesion-reviewer.ts` — pass plan review category schema
- `builder.ts` evaluator path — pass evaluation schema
- `plan-evaluator.ts`, `cohesion-evaluator.ts` — pass evaluation schema
- `planner.ts` `buildPrompt()` — pass clarification, module, plan frontmatter schemas
- `staleness-assessor.ts` — pass staleness schema

**5. Optional: Zod validation in parsers**

Add `schema.safeParse()` after regex extraction in each parser. Drop invalid items (same behavior, formalized). Can be done per-parser incrementally.

**6. Tests — `test/schemas.test.ts`**

- Each `getXxxSchemaYaml()` returns valid YAML containing expected field names and descriptions
- Caching works (same reference on repeated calls)
- Valid data passes `safeParse`, invalid data fails
- Existing `test/xml-parsers.test.ts` should pass unchanged

## Acceptance Criteria

- `src/engine/schemas.ts` exists as a leaf-level file (imports only `zod/v4` and `yaml`, no engine imports) containing all listed Zod schemas with `.describe()` annotations and the `getSchemaYaml()` utility with caching
- Hand-written TypeScript interfaces (`ReviewIssue`, `ClarificationQuestion`, `ExpeditionModule`, `EvaluationVerdict`, `EvaluationEvidence`, `StalenessVerdict`) are replaced with `z.output<typeof ...>` type aliases derived from the schemas
- All 7 reviewer prompts include `{{review_issue_schema}}` with perspective-specific category enums injected
- All 3 evaluator prompts include `{{evaluation_schema}}` injected
- Planner prompt includes `{{clarification_schema}}`, `{{module_schema}}`, and `{{plan_frontmatter_schema}}` injected
- Staleness assessor prompt includes `{{staleness_schema}}` injected
- Agent runners pass the generated schema YAML to `loadPrompt()` for template variable substitution
- `test/schemas.test.ts` covers: YAML output contains expected field names and descriptions, caching returns same reference, valid data passes `safeParse`, invalid data fails
- `pnpm test` — all existing and new tests pass
- `pnpm type-check` — no regressions from type alias swap
- `pnpm build` — clean build
