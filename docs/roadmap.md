# Eforge Roadmap

## Plugin Colocation

**Goal**: Keep the eforge Claude Code plugin in-repo so it stays in sync with engine changes.

- Move eforge plugin from `schaake-cc-marketplace` into `claude-marketplace/` in this repo
- Eforge is going open source — no need for a separate private/public split anymore

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
