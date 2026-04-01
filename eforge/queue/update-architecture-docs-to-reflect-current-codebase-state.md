---
title: Update architecture docs to reflect current codebase state
created: 2026-04-01
---

# Update architecture docs to reflect current codebase state

## Problem / Motivation

`docs/architecture.md` has fallen out of sync with the actual codebase. Several agents, event categories, and the plugin communication mechanism are missing or incorrectly described, making the doc misleading for anyone referencing it.

## Goal

Bring `docs/architecture.md` up to date with three minimal, targeted edits so it accurately reflects the current agents, events, and plugin communication model.

## Approach

Make three surgical edits to the existing document, matching the current terse bullet-point style and formatting. All other sections remain untouched.

1. **Agents roles table (around line 143-148)**: Add two missing agents to the appropriate function group rows:
   - `prd-validator` (`runPrdValidator` in `prd-validator.ts`)
   - `dependency-detector` (`runDependencyDetector` in `dependency-detector.ts`)

2. **Event categories table (around line 57-67)**: Add rows for missing event categories that exist in `src/engine/events.ts`:
   - `prd_validation:*` - PRD validation events (`prd_validation:start`, `prd_validation:complete`)
   - `reconciliation:*` - Reconciliation events (`reconciliation:start`, `reconciliation:complete`)
   - `cleanup:*` - Cleanup events (`cleanup:start`, `cleanup:complete`)
   - `approval:*` - Approval flow events (`approval:needed`, `approval:response`)

3. **Plugin section (around line 49-51)**: Change the description from saying the plugin "exposes MCP tools for build, queue, and status operations that invoke the CLI via `npx -y eforge`" to say the plugin exposes MCP tools that communicate with the daemon. The plugin skills (`build`, `status`, `config`, `restart`, `update`) all use `mcp__eforge__eforge_*` tool calls.

## Scope

**In scope:**
- Agent roles table: add `prd-validator` and `dependency-detector`
- Event categories table: add `prd_validation:*`, `reconciliation:*`, `cleanup:*`, `approval:*` rows
- Plugin section: correct communication description from CLI invocation to daemon MCP tools

**Out of scope:**
- All other sections (System Layers, Pipeline, Workflow Profiles, Blind review, Orchestration, Queue and Daemon, Monitor) - these are accurate and must not be touched
- Mermaid diagrams - preserve unchanged
- Any rewriting of sections that are already correct
- Adding commentary, opinions, or expanding scope beyond the three edits

## Acceptance Criteria

- The agent roles table includes `prd-validator` and `dependency-detector` in the appropriate function group rows
- The event categories table includes rows for `prd_validation:*`, `reconciliation:*`, `cleanup:*`, and `approval:*` with their sub-events listed
- The plugin section describes communication with the daemon via MCP tools (mentioning `mcp__eforge__eforge_*` tool calls) instead of CLI invocation via `npx -y eforge`
- Existing formatting style (terse bullet-point) and level of detail are matched
- No other sections of the document are modified
- All Mermaid diagrams are preserved unchanged
