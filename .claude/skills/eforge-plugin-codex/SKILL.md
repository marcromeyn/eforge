---
name: eforge-plugin-codex
description: Set up or switch to the OpenAI Codex backend for eforge. Checks prerequisites, configures the backend, and verifies connectivity.
argument-hint: "[--check|--switch]"
---

# /codex

Set up or switch an eforge project to use the OpenAI Codex backend. Handles prerequisite checks, config updates, and verification.

## Mode Detection

1. If `$ARGUMENTS` contains `--check`, run **check mode** only (Steps 1-2)
2. If `$ARGUMENTS` contains `--switch`, skip checks and go directly to **switch mode** (Step 3)
3. Otherwise, run the full flow (check, then offer to switch)

## Workflow

### Step 1: Check Prerequisites

Verify the codex CLI is available:

```bash
codex --version
```

If not found, tell the user:

> The `codex` CLI is required for the Codex backend. Install it with:
> ```
> npm install -g @openai/codex
> ```
> or via Homebrew: `brew install --cask codex`

Stop if the CLI is missing (unless `--switch` was passed, in which case warn but continue).

### Step 2: Check Authentication

Verify OpenAI API access is configured. Check in order:

1. `OPENAI_API_KEY` environment variable
2. Existing `codex.apiKey` in `eforge/config.yaml` (if file exists)
3. ChatGPT sign-in (the codex CLI supports this natively)

Report what was found. If no auth is detected, inform the user:

> No OpenAI API key found. You can either:
> - Set `OPENAI_API_KEY` in your environment
> - Add `codex.apiKey` to `eforge/config.yaml`
> - Sign in via `codex` CLI (uses your ChatGPT account)

### Step 3: Configure Backend

Read the current `eforge/config.yaml` (if it exists).

**If no config exists**: Tell the user to run `/eforge:init` first, or ask if they want you to create a minimal config with `backend: codex`.

**If config exists**: Determine what changes are needed:

1. Set `backend: codex`
2. If there is no `codex:` section, add one (empty is fine — defaults work)
3. If there are `pi:`-specific model refs with `provider` fields in `agents.models` or `agents.model`, warn that codex uses `{ id }` format without `provider`

Present the proposed changes and ask for confirmation before writing.

### Step 4: Verify

After config is written, run a quick verification:

```bash
codex --version
```

Report success:

> Codex backend configured. eforge will use the `codex` CLI for agent execution.
>
> Default models: `o3` (max), `o4-mini` (balanced/fast)
>
> To customize models, edit `agents.models` in `eforge/config.yaml`.
> To switch back: set `backend: claude-sdk` in your config.

## Error Handling

| Error | Action |
|-------|--------|
| `codex` CLI not found | Show install instructions, stop |
| No `eforge/config.yaml` | Suggest `/eforge:init` or offer to create minimal config |
| Config has `provider` in model refs | Warn and offer to strip provider fields |
| Write permission error | Report and suggest manual edit |
