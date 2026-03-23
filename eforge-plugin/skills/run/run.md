---
description: Validate source and launch eforge run (enqueue + plan + build + validate) via MCP tool with monitor dashboard
argument-hint: "<source> [--queue] [--watch]"
disable-model-invocation: true
---

# /eforge:run

Launch `eforge run` to plan and build from a PRD file or description. Uses the eforge MCP server which communicates with the daemon for orchestration, agent execution, and state management.

## Arguments

- `source` - PRD file path or inline description of what to build (required unless `--queue`)
- `--queue` - (optional) Process all PRDs from the queue instead of a single source
- `--watch` - (optional) Enable watch mode: continuously poll the queue for new PRDs after each cycle
- `--poll-interval <ms>` - (optional) Poll interval in milliseconds for watch mode (default: 5000)

## Workflow

### Step 1: Validate Source

**If `--queue` is in arguments:**
Skip source validation. Will process the entire PRD queue.

**Otherwise**, check that `$ARGUMENTS` is provided and the source is readable:

- **File path**: Verify the file exists with the Read tool. Show a brief summary of what it describes.
- **Inline description**: Note that eforge will use this directly as the source prompt.

If no arguments provided:
1. Check the current conversation for a PRD or plan file path from a prior session
2. If found, read it with the Read tool and show a brief summary
3. Ask the user to confirm before proceeding
4. If no file is found in conversation context, suggest running `/eforge:enqueue` first to create a PRD
- **Stop here** if the user declines or no source is identified

### Step 2: Launch

Call the `mcp__eforge__eforge_run` tool:

- **Normal mode**: `mcp__eforge__eforge_run` with `{ source: "<source>" }`
- **Queue mode**: `mcp__eforge__eforge_run` with `{ flags: ["--queue"] }`
- **Watch mode**: `mcp__eforge__eforge_run` with `{ flags: ["--queue", "--watch"] }`
- **Watch with custom interval**: `mcp__eforge__eforge_run` with `{ flags: ["--queue", "--watch", "--poll-interval", "10000"] }`

The tool returns a JSON response with a `sessionId` that can be used to track progress.

### Step 3: Report Launch

Tell the user:

**For normal mode:**

> Build launched (session: `{sessionId}`). The daemon is running the build in the background.
>
> The run formats your source into a PRD, selects a workflow profile, then compiles and builds. The pipeline varies by profile - errands skip straight to building, while excursions and expeditions go through planning and plan review first. Every profile gets blind code review (a separate agent with no builder context), merge, and post-merge validation.
>
> Use `/eforge:status` for a quick inline status check.

**For queue mode:**

> Queue processing launched (session: `{sessionId}`).
>
> Each queued PRD goes through the same pipeline: formatting, profile selection, compile, build with blind review, merge, and validation.
>
> Use `/eforge:status` for a quick inline status check.

**For watch mode (--watch):**

> Queue watch mode started (session: `{sessionId}`). The queue will be polled for new PRDs after each cycle.
>
> Use `/eforge:status` for a quick inline status check.

## Error Handling

| Error | Action |
|-------|--------|
| Source file not found | Check path, suggest `/eforge:enqueue` to create one |
| No arguments provided | Check conversation for plan file; if none found, suggest `/eforge:enqueue` |
| MCP tool returns error | Show the error message from the daemon response |
| Daemon connection failure | The MCP proxy auto-starts the daemon; if it still fails, suggest running `eforge daemon start` manually |
