---
title: Add `eforge config init` CLI command
created: 2026-03-29
status: pending
---

# Add `eforge config init` CLI command

## Problem / Motivation

New users must manually create `eforge/config.yaml` before they can use eforge. The README currently tells them to do this by hand, which adds friction to onboarding. There is also no mention of the `/eforge:config` Claude Code plugin skill that can guide users through interactive setup.

## Goal

Provide an `eforge config init` CLI command that scaffolds a minimal valid config interactively, and update documentation to point users to both the CLI command and the `/eforge:config` plugin skill.

## Approach

### 1. New CLI subcommand: `eforge config init`

**File:** `src/cli/index.ts` (~line 586, after existing config subcommands)

Add a new subcommand to the existing `config` parent command:

```
eforge config init [--backend <claude-sdk|pi>]
```

**Flow:**

1. Check if `eforge/config.yaml` already exists via `findConfigFile(process.cwd())`. If so, print message and exit.
2. **Backend selection:**
   - If `--backend` flag provided, use it.
   - Otherwise, prompt: `Backend (claude-sdk / pi) [claude-sdk]:` - default to `claude-sdk`.
3. **If backend is `pi`, collect additional required fields:**
   - Prompt: `Pi provider [openrouter]:` - default to `openrouter`.
   - Prompt: `Model ID (e.g. anthropic/claude-sonnet-4-6):` - no default, required. Re-prompt if empty.
4. Create `eforge/` directory if needed (`mkdir`).
5. Write `eforge/config.yaml`:
   - For `claude-sdk`:
     ```yaml
     backend: claude-sdk
     ```
   - For `pi`:
     ```yaml
     backend: pi

     pi:
       provider: openrouter

     agents:
       models:
         max: anthropic/claude-sonnet-4-6
     ```
6. Validate via `validateConfigFile()`.
7. Print success: `Config written to eforge/config.yaml` with pointer to docs and `/eforge:config`.

**Interactive prompts** use `readline/promises` - same pattern as existing CLI code (`src/cli/interactive.ts`, daemon stop prompt at ~line 743).

**Dependencies to reuse:**

- `findConfigFile()` from `src/engine/config.ts:410`
- `validateConfigFile()` from `src/engine/config.ts:908`
- `readline/promises` (Node built-in)
- `chalk` (already imported)
- `yaml` package `stringify()` (already used in `config show`)

### 2. Update README.md

**File:** `README.md` (line 76)

Replace:

```
Create `eforge/config.yaml` with at minimum `backend: claude-sdk` (or `backend: pi` for the Pi multi-provider backend).
```

With:

```
Initialize config via the CLI or Claude Code plugin:

\`\`\`bash
eforge config init
\`\`\`

Or use `/eforge:config` in Claude Code for interactive setup. You can also manually create `eforge/config.yaml` - see [docs/config.md](docs/config.md).
```

### 3. Update docs/config.md

**File:** `docs/config.md` (after line 2)

Add a tip after the opening description:

```
**Quick start:** Run `eforge config init` to create a minimal config, or use `/eforge:config` in Claude Code for guided interactive setup.
```

## Scope

**In scope:**

- `eforge config init` subcommand with interactive prompts and `--backend` flag
- Config file generation for both `claude-sdk` and `pi` backends
- Existence check to prevent overwriting an existing config
- Validation of the generated config via `validateConfigFile()`
- README.md update with new quick-start instructions
- docs/config.md update with quick-start tip

**Out of scope:**

- N/A

## Acceptance Criteria

1. `pnpm build` compiles successfully.
2. `pnpm type-check` passes.
3. Running `eforge config init` in a directory without existing config creates a valid `eforge/config.yaml`.
4. Running `eforge config init` again in the same directory refuses to overwrite and prints a message.
5. Running `eforge config init --backend pi` prompts for provider (default `openrouter`) and model ID (required, re-prompts if empty), then writes the correct config.
6. Running `eforge config init --backend claude-sdk` writes a minimal config without extra prompts.
7. README.md and docs/config.md contain the updated documentation text.
