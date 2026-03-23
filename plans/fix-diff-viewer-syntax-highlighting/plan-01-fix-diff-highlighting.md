---
id: plan-01-fix-diff-highlighting
name: Fix Diff Viewer Syntax Highlighting
depends_on: []
branch: fix-diff-viewer-syntax-highlighting/fix-diff-highlighting
---

# Fix Diff Viewer Syntax Highlighting

## Architecture Context

The eforge monitor UI has two components that use Shiki for syntax highlighting: `diff-viewer.tsx` (Changes tab diffs) and `plan-body-highlight.tsx` (Plans tab markdown/code). Each creates its own `Highlighter` instance with different language sets. The diff viewer's Shiki initialization fails silently on Mac, causing diffs to render as plain monochrome text. Additionally, `git diff-tree -p` output includes a bare commit SHA line that isn't valid diff syntax.

## Implementation

### Overview

1. Extract a shared Shiki highlighter utility into `src/monitor/ui/src/lib/shiki.ts` that caches a single instance with all needed languages (including `diff`).
2. Refactor both `diff-viewer.tsx` and `plan-body-highlight.tsx` to use the shared highlighter.
3. Fix the `cancelled` pass-by-value bug in `diff-viewer.tsx` where `highlightEntries` receives a boolean snapshot instead of a ref/closure.
4. Add a visible warning indicator when highlighting fails instead of silent fallback.
5. Add `--no-commit-id` to the two `git diff-tree -p` calls in `server.ts` (lines 645 and 680).
6. Add `.wasm` MIME type to `server.ts` MIME_TYPES map.

### Key Decisions

1. **Shared highlighter module** — Both components already cache at module level; unifying into one module eliminates duplicate Shiki instances and ensures `diff` language is always available. Pattern: export an async `getHighlighter()` that lazily creates and caches a single instance.
2. **Cancelled ref pattern** — Replace the `cancelled` boolean parameter in `highlightEntries` with a direct closure over the `cancelled` variable from the outer `useEffect` scope, so the check reflects the current value during async init.
3. **Error visibility** — Show a small dimmed "Highlighting unavailable" text below the fallback `<pre>` block rather than silently dropping to plain text. This makes debugging easier without disrupting the UI.
4. **`--no-commit-id` flag** — The commit SHA is already available as a separate field in the API response; stripping it from the diff output removes noise that isn't valid diff syntax.

## Scope

### In Scope
- New shared Shiki highlighter utility (`src/monitor/ui/src/lib/shiki.ts`)
- Refactoring `diff-viewer.tsx` to use shared highlighter, fix cancelled bug, add error indicator
- Refactoring `plan-body-highlight.tsx` to use shared highlighter
- Adding `--no-commit-id` to `git diff-tree -p` calls in `server.ts`
- Adding `.wasm` MIME type to `server.ts`

### Out of Scope
- Changing the `shiki` package version
- Modifying the DiffViewer or PlanBodyHighlight props interfaces
- Changing the API contract between frontend and server
- Replacing Shiki with an alternative renderer

## Files

### Create
- `src/monitor/ui/src/lib/shiki.ts` — Shared `getHighlighter()` utility that lazily creates and caches a single Shiki `Highlighter` with all needed languages (the `CODE_LANGS` list from `plan-body-highlight.tsx` plus `'diff'`), using `github-dark` theme.

### Modify
- `src/monitor/ui/src/components/heatmap/diff-viewer.tsx` — Remove inline Shiki creation (lines 5, 28, 106-116). Import shared `getHighlighter()`. Fix `highlightEntries` to close over the `cancelled` variable from the parent `useEffect` scope instead of receiving it as a boolean parameter. Add a `[highlightFailed, setHighlightFailed]` state. In the catch block, set `highlightFailed = true`. In the render section, when no highlighted HTML exists and `highlightFailed` is true, show a dimmed "Highlighting unavailable" indicator below the fallback `<pre>`.
- `src/monitor/ui/src/components/preview/plan-body-highlight.tsx` — Remove `CODE_LANGS` array and inline `createHighlighter` call. Import shared `getHighlighter()` from `@/lib/shiki`. Remove `highlighterRef` (the shared utility handles caching). Update `initHighlighter` to call the shared utility.
- `src/monitor/server.ts` — Line 645: add `'--no-commit-id'` before `'-p'` in the `git diff-tree` args array. Line 680: same change. Line ~20: add `'.wasm': 'application/wasm'` to the `MIME_TYPES` map.

## Verification

- [ ] `pnpm build` completes with zero type or build errors
- [ ] `pnpm type-check` passes with zero errors
- [ ] `src/monitor/ui/src/lib/shiki.ts` exports a `getHighlighter()` function that returns `Promise<Highlighter>`
- [ ] `diff-viewer.tsx` imports from `@/lib/shiki` and does not contain `createHighlighter`
- [ ] `plan-body-highlight.tsx` imports from `@/lib/shiki` and does not contain `createHighlighter` or `CODE_LANGS`
- [ ] `diff-viewer.tsx` `highlightEntries` function does not accept a `cancelled` or `isCancelled` parameter — it reads the `cancelled` variable from the enclosing `useEffect` closure
- [ ] `diff-viewer.tsx` contains a `highlightFailed` state and renders a visible indicator (text containing "unavailable" or a warning icon) when highlighting fails
- [ ] `server.ts` contains `'--no-commit-id'` in both `git diff-tree` calls (lines ~645 and ~680)
- [ ] `server.ts` MIME_TYPES map contains `'.wasm': 'application/wasm'`
- [ ] `shiki.ts` language list includes `'diff'` plus all languages from the original `CODE_LANGS` array
