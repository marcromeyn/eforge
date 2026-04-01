---
description: Initialize eforge in the current project with an interactive setup form
disable-model-invocation: true
---

# /eforge:init

Initialize eforge in this project. Calls the `mcp__eforge__eforge_init` tool which presents a form to select a backend and creates `eforge/config.yaml` with sensible defaults.

## Usage

Run `mcp__eforge__eforge_init` with `{}` to start fresh initialization, or `{ force: true }` to re-initialize an existing project.

If `$ARGUMENTS` contains `--force` or `force`, pass `{ force: true }`.

## After Initialization

Once the tool completes successfully, inform the user:

> eforge initialized. You can customize further with `/eforge:config --edit`.
