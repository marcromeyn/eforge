---
title: Add config validation to `/eforge:build` skill
created: 2026-03-29
status: pending
---



# Add config validation to `/eforge:build` skill

## Problem / Motivation

The `/eforge:build` skill enqueues PRDs for the daemon to build but never validates `eforge/config.yaml` first. If the config has errors (bad YAML, invalid profile stages, schema violations), the build fails later during execution with poor error context. The `eforge_config` MCP tool already supports a `validate` action that returns `{ valid: boolean, errors: string[] }` - it just needs to be called before enqueueing.

## Goal

Add a validation guard clause to the build skill so that config errors are caught and surfaced clearly before a build is enqueued, preventing builds that would fail with poor error context.

## Approach

- Add a validation guard clause at the top of Step 5 (Enqueue & Report) in the build skill. This keeps the step count at 5 (no renumbering), runs after the user has confirmed they want to build, and blocks the enqueue if config is invalid.
- Before enqueueing, call `mcp__eforge__eforge_config` with `{ action: "validate" }`.
  - If `valid` is `true`: proceed silently.
  - If `valid` is `false`: show the errors, suggest `/eforge:config` to fix, and stop without enqueueing.
- Add a row to the Error Handling table: `Config validation fails` → `Show errors, suggest fixing config, do not enqueue`.

## Scope

**In scope:**

- **File: `eforge-plugin/skills/build/build.md`**
  - **Edit 1:** Insert validation guard at the top of Step 5, before the `mcp__eforge__eforge_build` call.
  - **Edit 2:** Add a new row to the Error Handling table for config validation failure.

**Out of scope:**

- N/A

## Acceptance Criteria

1. The modified `build.md` contains the validation guard before the enqueue call in Step 5.
2. Step numbering and forward references in Steps 1-4 are unchanged.
3. The Error Handling table includes a new row: `Config validation fails | Show errors, suggest fixing config, do not enqueue`.
