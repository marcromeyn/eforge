# Eforge Roadmap

## Why Plugin, Not TUI

The original PRD planned a TUI. We're dropping it in favor of a Claude Code plugin:

1. **Context** — Users already have codebase context, MCP tools, and prior discussion in Claude Code. A TUI starts cold.
2. **Redundancy** — Claude Code already provides interactive prompts, file browsing, diff display, and approval gates.
3. **Proven pattern** — The orchestrate plugin demonstrates CLI subprocess delegation works for parallel worktree builds.

The CLI with `--auto` covers headless/CI. The monitor dashboard covers visualization.

## Architecture Boundary: Engine vs Plugin

**Engine** — Everything that runs without Claude Code: plan generation, review cycles, build execution, orchestration, state management, monitoring, tracing.

**Plugin** — Thin orchestration: requirement refinement in conversation context, launching `eforge` CLI as subprocess, status rendering, cross-plugin coordination. A **launcher and facilitator**, not a reimplementation.

## Relationship to Orchestrate & EEE Plugins

Graduated replacement. Phase 5: eforge plugin supersedes both for planning and execution. Phase 8: deprecate them entirely.

---

## Monitor Dashboard Enhancements

**Goal**: Richer visualization in the existing web monitor.

- Dependency graph view (plan execution order and wave assignment)
- Plan file preview with syntax highlighting
- Wave-level grouping in timeline (currently shows per-plan pipeline only)
- File change heatmap (merge conflict risk)

---

## Planning Intelligence

**Goal**: Go from rough idea to refined, reviewed plans entirely within Claude Code.

- **Plan iteration** — Review and refine generated plans in-conversation, re-run review cycle
- **Plan templates** — Common patterns (API endpoint, migration, refactor, feature flag)

---

## Integration & Maturity

**Goal**: Full lifecycle coverage, CI support, provider flexibility.

- **Headless/CI** — `--json` CLI output flag, webhook notifications
- **Provider abstraction** — Second `AgentBackend` implementation for non-SDK environments
- **Plugin consolidation** — Deprecate orchestrate + EEE plugins, migration guide
