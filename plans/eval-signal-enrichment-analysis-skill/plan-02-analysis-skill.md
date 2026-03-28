---
id: plan-02-analysis-skill
name: Create Eval Analysis Skill
depends_on: []
branch: eval-signal-enrichment-analysis-skill/analysis-skill
---

# Create Eval Analysis Skill

## Architecture Context

eforge uses Claude Code skills (`.claude/skills/`) for project-scoped automation guidance. The eval harness (separate repo at `eforge-build/eval`) exposes MCP tools (`eval_runs`, `eval_observations`, `eval_scenario_detail`, `eval_run`, `eval_results`) for programmatic eval data access. This plan creates a skill that guides Claude Code through structured eval result analysis with anti-bias gating rules to prevent over-correction when proposing changes based on eval data.

## Implementation

### Overview

Create `.claude/skills/eval-analysis/SKILL.md` containing the full analysis methodology, MCP tool usage instructions, and all five anti-bias gating rules. The skill is a standalone markdown file with no code dependencies.

### Key Decisions

1. The skill lives at `.claude/skills/eval-analysis/SKILL.md` following the existing pattern (`eforge-daemon-restart/`, `eforge-release/`).
2. The skill description targets trigger phrases like "/eval-analysis", "analyze eval results", "what do the evals show".
3. All five gating rules are embedded directly in the skill prompt so they are always present in context when the skill activates - not referenced from an external document.

## Scope

### In Scope
- Creating `.claude/skills/eval-analysis/SKILL.md` with full methodology
- All five anti-bias gating rules embedded in the skill prompt
- MCP tool usage instructions for `eval_runs`, `eval_observations`, `eval_scenario_detail`, `eval_run`, `eval_results`
- Regression gate workflow (baseline + candidate comparison)

### Out of Scope
- Changes to the eval harness MCP tools
- Changes to eforge engine code
- Automated eval triggering (skill guides manual workflow)

## Files

### Create
- `.claude/skills/eval-analysis/SKILL.md` - Analysis skill with methodology and gating rules

## Verification

- [ ] `.claude/skills/eval-analysis/SKILL.md` exists and is valid markdown
- [ ] The skill frontmatter contains a description that triggers on "eval-analysis", "analyze eval results", "what do the evals show"
- [ ] The skill prompt instructs use of `eval_runs` MCP tool to check for recent runs
- [ ] The skill prompt instructs use of `eval_observations` MCP tool to pull observations
- [ ] The skill prompt instructs use of `eval_scenario_detail` MCP tool for affected scenarios
- [ ] The skill prompt instructs use of `eval_run` MCP tool to kick off runs
- [ ] The skill prompt instructs use of `eval_results` with `compare` parameter for regression comparison
- [ ] All five anti-bias gating rules are present: (1) never reduce sensitivity, (2) never shift threshold in one direction, (3) always require counter-scenario, (4) prefer scenario additions over behavior changes, (5) respect confidence thresholds
- [ ] The skill instructs reading the relevant eforge prompt/config before reasoning about root cause
- [ ] The skill instructs presenting findings conversationally with data, hypothesis, and proposed action
