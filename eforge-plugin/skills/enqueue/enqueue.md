---
description: Normalize any input and add it to the eforge queue via MCP tool
argument-hint: "<source>"
disable-model-invocation: true
---

# /eforge:enqueue

Normalize a source document (PRD file, inline prompt, or rough notes) and add it to the eforge queue. Uses the eforge MCP server which delegates to the daemon's formatter agent to produce a well-structured PRD with frontmatter.

## Arguments

- `source` — file path to a PRD, plan, or markdown document; or an inline description of what to build

## Workflow

### Step 1: Validate Source

Check that `$ARGUMENTS` is provided:

- **File path**: Verify the file exists with the Read tool. Show a brief summary of what it describes.
- **Inline description**: Note that eforge will use this directly as the source prompt.
- **Nothing provided**: Check the current conversation for a plan file or PRD that could be enqueued. If none found, ask the user what they want to enqueue.

**Stop here** if no source is identified.

### Step 2: Enqueue

Call the `mcp__eforge__eforge_enqueue` tool with `{ source: "<source>" }`.

The tool returns a JSON response confirming the enqueue operation with the PRD title and file path.

### Step 3: Report Result

After successful enqueue, tell the user:

> Enqueued: **{title}** -> `{filePath}`
>
> Next steps:
> - `/eforge:run --queue` to process the queue
> - `/eforge:run {filePath}` to build this PRD directly
> - `/eforge:status` to check build progress

## Error Handling

| Error | Action |
|-------|--------|
| Source file not found | Check path, suggest alternatives |
| No arguments provided | Check conversation for relevant files; if none, ask the user |
| MCP tool returns error | Show the error message from the daemon response |
| Daemon connection failure | The MCP proxy auto-starts the daemon; if it still fails, suggest running `eforge daemon start` manually |
