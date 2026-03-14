# Eforge Roadmap

## Monitor Dashboard Enhancements

**Goal**: Richer visualization in the existing web monitor.

- Dependency graph view (plan execution order and wave assignment)
- Plan file preview with syntax highlighting
- Wave-level grouping in timeline (currently shows per-plan pipeline only)
- File change heatmap (merge conflict risk)

---

## Event Hooks

**Goal**: Let users run shell commands in response to engine events — notifications, webhooks, cost logging — without modifying engine internals.

- `hooks` section in `eforge.yaml` with glob patterns on event types
- `withHooks()` async generator middleware (fire-and-forget, never blocks pipeline)
- Hooks receive full `EforgeEvent` as JSON on stdin (same pattern as Claude Code hooks)

See [GitHub issue #1](https://github.com/schaakesolutionsllc/eforge/issues/1).

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
