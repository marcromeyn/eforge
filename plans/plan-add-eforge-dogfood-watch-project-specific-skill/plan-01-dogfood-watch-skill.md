---
id: plan-01-dogfood-watch-skill
name: Create eforge-dogfood-watch Skill
depends_on: []
branch: plan-add-eforge-dogfood-watch-project-specific-skill/dogfood-watch-skill
---

# Create eforge-dogfood-watch Skill

## Architecture Context

Project-specific Claude Code skills are auto-discovered from `.claude/skills/{name}/SKILL.md` - no registration needed. The directory `.claude/skills/eforge-dogfood-watch/` already exists but is empty.

The existing `/eforge:run` skill in `eforge-plugin/skills/run/run.md` provides the pattern to follow: YAML frontmatter with `description` and `disable-model-invocation: true`, step-by-step procedural workflow, `run_in_background: true` for long bash commands, and structured error handling tables.

The key difference from `eforge run --queue --watch` is that this skill rebuilds eforge between each queue cycle. Since eforge modifies its own source during dogfooding, the running Node.js process uses stale code. The skill loops at the Claude Code level - build, check queue, run queue (single cycle), repeat - so each `eforge run --queue` invocation uses a freshly compiled binary.

## Implementation

### Overview

Create `.claude/skills/eforge-dogfood-watch/SKILL.md` with a procedural loop that:
1. Builds eforge (`pnpm build`) - stops on failure
2. Checks the PRD queue for pending items via glob + frontmatter read
3. Runs `eforge run --queue --auto --verbose` (single cycle, no `--watch`) as a background task
4. Reports outcome, loops back to step 1

### Key Decisions

1. **No `--watch` flag on eforge** - the skill IS the watch loop, with a full rebuild between cycles. Using `--watch` would defeat the purpose since the long-running process wouldn't pick up source changes.
2. **30s poll interval** for empty queue - longer than eforge's default 5s because each poll cycle includes a full `pnpm build`.
3. **`run_in_background: true`** for the eforge run step - matches the `/eforge:run` skill pattern and avoids bash timeout on long builds.
4. **3 consecutive all-fail exit condition** - prevents infinite loops when there's a systemic issue with the build pipeline.
5. **Step-by-step Claude iteration** (not a bash while loop) - Claude can read queue state, report results, and handle errors with judgment between cycles.

## Scope

### In Scope
- `.claude/skills/eforge-dogfood-watch/SKILL.md` with full workflow definition

### Out of Scope
- Changes to eforge CLI or engine
- Changes to the eforge plugin
- Any other skill files

## Files

### Create
- `.claude/skills/eforge-dogfood-watch/SKILL.md` — Project-specific skill for dogfood queue watching with rebuild between cycles

## Verification

- [ ] `.claude/skills/eforge-dogfood-watch/SKILL.md` exists and contains valid YAML frontmatter with `description` and `disable-model-invocation: true`
- [ ] Frontmatter `description` field mentions dogfooding, queue watching, and rebuilding between cycles
- [ ] Workflow includes 4 steps: build, check queue, run queue, report & loop
- [ ] Build step runs `pnpm build` and specifies stopping the loop on build failure
- [ ] Queue check step uses Glob on `docs/prd-queue/*.md` and reads frontmatter to count pending PRDs
- [ ] Queue check step polls every 30 seconds when no pending PRDs are found
- [ ] Run step uses `eforge run --queue --auto --verbose` with `run_in_background: true`
- [ ] Run step does NOT use `--watch` flag
- [ ] Exit conditions are defined: build failure, user says stop, 3 consecutive all-fail cycles
