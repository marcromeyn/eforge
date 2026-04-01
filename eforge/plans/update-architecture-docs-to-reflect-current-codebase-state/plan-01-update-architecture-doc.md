---
id: plan-01-update-architecture-doc
name: Update architecture.md with missing agents, events, and plugin communication
depends_on: []
branch: update-architecture-docs-to-reflect-current-codebase-state/update-architecture-doc
---

# Update architecture.md with missing agents, events, and plugin communication

## Architecture Context

`docs/architecture.md` has three sections that are out of sync with the current codebase. All other sections are accurate. This plan makes three targeted edits matching the existing terse bullet-point style.

## Implementation

### Overview

Three surgical edits to `docs/architecture.md`:

1. Add missing agents to the agent roles table
2. Add missing event categories to the event categories table
3. Correct the plugin communication description and Mermaid diagram

### Key Decisions

1. Match the existing formatting style exactly - terse table rows, no additional commentary
2. Update the Mermaid diagram's plugin arrow from `"invokes via CLI"` to `"MCP tools"` since the plugin communicates with the daemon, not the CLI

## Scope

### In Scope
- Agent roles table: add `prd-validator` to Planning row, `dependency-detector` to Planning row
- Event categories table: add rows for `prd_validation:*`, `reconciliation:*`, `cleanup:*`, `approval:*`
- Plugin section (line 51): change CLI invocation description to daemon MCP tools
- Mermaid diagram (line 29): update plugin arrow label from `"invokes via CLI"` to `"MCP tools"`

### Out of Scope
- All other sections of architecture.md
- Any non-documentation files
- Expanding or rewriting sections that are already correct

## Files

### Modify
- `docs/architecture.md` - Three targeted edits:
  1. **Agent roles table (line 145)**: Add `prd-validator` and `dependency-detector` to the Planning row. Current: `formatter, planner, module-planner, staleness-assessor`. New: `formatter, planner, module-planner, staleness-assessor, prd-validator, dependency-detector`
  2. **Event categories table (lines 57-67)**: Add four new rows after the existing `queue:*` row:
     - `prd_validation:*` - PRD validation (`prd_validation:start`, `prd_validation:complete`)
     - `reconciliation:*` - Reconciliation (`reconciliation:start`, `reconciliation:complete`)
     - `cleanup:*` - Cleanup (`cleanup:start`, `cleanup:complete`)
     - `approval:*` - Approval flow (`approval:needed`, `approval:response`)
  3. **Plugin section (line 51)**: Replace "It exposes MCP tools for build, queue, and status operations that invoke the CLI via `npx -y eforge`." with "It exposes MCP tools that communicate with the daemon via `mcp__eforge__eforge_*` tool calls for build, queue, status, config, and daemon operations."
  4. **Mermaid diagram (line 29)**: Change `Plugin -->|"invokes via CLI"| CLI` to `Plugin -->|"MCP tools"| EforgeEngine` since the plugin talks to the daemon, not the CLI

## Verification

- [ ] The Planning row in the agent roles table contains exactly: `formatter, planner, module-planner, staleness-assessor, prd-validator, dependency-detector`
- [ ] The event categories table contains rows for `prd_validation:*`, `reconciliation:*`, `cleanup:*`, and `approval:*`
- [ ] Each new event category row lists its sub-events (e.g., `prd_validation:start`, `prd_validation:complete`)
- [ ] The plugin section mentions `mcp__eforge__eforge_*` tool calls and daemon communication
- [ ] The plugin section does not mention `npx -y eforge` or CLI invocation
- [ ] The Mermaid diagram shows the plugin connecting to `EforgeEngine` via "MCP tools", not to CLI via "invokes via CLI"
- [ ] No other sections of the document are modified
- [ ] All three existing Mermaid diagrams remain syntactically valid (no broken graph definitions)
