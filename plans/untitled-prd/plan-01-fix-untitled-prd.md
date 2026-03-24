---
id: plan-01-fix-untitled-prd
name: Fix Untitled PRD Title for Inline MCP Descriptions
depends_on: []
branch: untitled-prd/fix-untitled-prd
---

# Fix Untitled PRD Title for Inline MCP Descriptions

## Architecture Context

The enqueue flow in `src/engine/eforge.ts` runs `inferTitle()` on the raw `sourceContent` before the formatter agent processes it. For inline descriptions (no file path, no `# ` heading), `inferTitle()` has no heading to match and no filename slug fallback, so it returns "Untitled PRD". The formatter agent already produces well-structured output — it just needs to include a title heading so `inferTitle()` can extract it post-formatting.

## Implementation

### Overview

Two changes:
1. Add an instruction to the formatter prompt requiring a `# Title` heading as the first line of output.
2. Move the `inferTitle()` call in `enqueue()` to run on `formattedBody` instead of `sourceContent`.

### Key Decisions

1. The formatter generates the title from the input content — this keeps `inferTitle()` unchanged and reuses its existing heading regex.
2. `options.name` remains the highest priority override, checked before `inferTitle()` runs on the formatted output.
3. The `fallbackSlug` parameter (derived from source filename) is still passed to `inferTitle()` — for file-based sources where the formatter might fail, the slug fallback remains available.

## Scope

### In Scope
- `src/engine/prompts/formatter.md` — add title heading instruction
- `src/engine/eforge.ts` — move `inferTitle()` call to after formatting

### Out of Scope
- Changes to `inferTitle()` logic
- Changes to `enqueuePrd()` or `prd-queue.ts`
- Any other agent prompts or subsystems

## Files

### Modify
- `src/engine/prompts/formatter.md` — Add a rule requiring the formatter to output a concise `# Title` heading as the first line, derived from the input content, above the PRD sections.
- `src/engine/eforge.ts` — Move line 283 (`const title = options.name ?? inferTitle(...)`) to after line 296 (after `formattedBody` is assigned), changing the first argument from `sourceContent` to `formattedBody`.

## Verification

- [ ] `inferTitle(formattedBody)` is called after the formatter runs (not before)
- [ ] `options.name` is still checked first via `??` operator before `inferTitle()` runs
- [ ] The formatter prompt includes an explicit instruction to emit a `# Title` heading as the first line
- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes with zero failures
