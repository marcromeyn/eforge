---
id: plan-01-add-pi-package-consumer
name: Add Pi Package as Architecture Consumer
depends_on: []
branch: document-pi-package-as-architecture-consumer/add-pi-package-consumer
---

# Add Pi Package as Architecture Consumer

## Architecture Context

The `docs/architecture.md` file documents the system's thin consumers (CLI, Monitor, Plugin) but omits the Pi package (`pi-package/`), which is a native Pi extension providing the same operational surface as the Claude Code plugin. The Pi package already exists in the codebase and is referenced in AGENTS.md as needing parity with `eforge-plugin/`.

## Implementation

### Overview

Three targeted edits to `docs/architecture.md`:
1. Add "Pi package" to the opening paragraph's consumer list
2. Add a `PiPkg` node in the System Layers mermaid diagram
3. Add a new `### Pi Package` section after the existing `### Plugin` section

### Key Decisions

1. Mirror the Plugin section's structure and level of detail for consistency - the Pi Package section follows the same pattern of directory reference, integration mechanism, and capability list.
2. Use "native Pi tools" as the arrow label in the mermaid diagram, paralleling Plugin's "MCP tools" label - this accurately describes how Pi extensions register tools.
3. List the skill-based slash commands (`/eforge:build`, `/eforge:status`, etc.) derived from the actual `pi-package/skills/` directory contents: `eforge-build`, `eforge-config`, `eforge-init`, `eforge-restart`, `eforge-status`, `eforge-update`.

## Scope

### In Scope
- Editing the opening paragraph on line 3 to include "Pi package"
- Adding `PiPkg` node and arrow in the System Layers mermaid diagram Consumers subgraph
- Adding a `### Pi Package` section after `### Plugin`

### Out of Scope
- Code changes to `pi-package/` itself
- Changes to any other documentation files
- Modifications to any other sections of `docs/architecture.md`

## Files

### Modify
- `docs/architecture.md` — Add Pi package to opening paragraph consumer list, add PiPkg node to mermaid diagram, add new Pi Package section after Plugin section

## Verification

- [ ] Line 3 of `docs/architecture.md` contains "Pi package" in the consumer list alongside CLI, web monitor, and Claude Code plugin
- [ ] The System Layers mermaid diagram contains a `PiPkg` node inside the `Consumers` subgraph with a labeled arrow to `EforgeEngine`
- [ ] A `### Pi Package` section exists between the `### Plugin` section and the `## Event System` section
- [ ] The Pi Package section references `pi-package/` as the directory, mentions native Pi tools communicating with the daemon via HTTP API, lists the operational surface (init, build, queue, status, config, daemon management), and mentions skill-based slash commands
