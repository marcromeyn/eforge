---
id: plan-02-docs-plugin-projectconfig
name: Update docs, plugin skill, project config, and bump plugin version
depends_on: [plan-01-config-and-consumers]
branch: simplify-eforge-config-remove-build-parallelism-autorevise-rename-queue-parallelism/docs-plugin-projectconfig
---

# Update docs, plugin skill, project config, and bump plugin version

## Architecture Context

After plan-01 removes the config fields and adds `maxConcurrentBuilds` in source code and tests, the documentation, plugin skill config interview, project config file, and plugin version must be updated to match. These are all non-code prose/config files that depend on plan-01's type changes being in place.

## Implementation

### Overview

1. Update `docs/config.md` to remove old fields, add `maxConcurrentBuilds`, rewrite parallelism section
2. Update `docs/architecture.md` to remove `build.parallelism` reference
3. Update `eforge-plugin/skills/config/config.md` interview and reference sections
4. Update `eforge/config.yaml` to use top-level `maxConcurrentBuilds`
5. Bump plugin version in `eforge-plugin/.claude-plugin/plugin.json`

### Key Decisions

1. **Parallelism section rewrite** - Two dimensions remain: plan parallelism (automatic, no config) and queue concurrency (`maxConcurrentBuilds`). The three-dimension section collapses to two.
2. **Plugin version bump to 0.5.13** - Required by project convention when changing anything in the plugin directory.

## Scope

### In Scope
- Rewrite `docs/config.md` parallelism section and config reference
- Update `docs/architecture.md` orchestration description
- Update `eforge-plugin/skills/config/config.md` interview sections 2 and 10, plus config reference
- Update `eforge/config.yaml` to move `prdQueue.parallelism: 2` to top-level `maxConcurrentBuilds: 2`
- Bump `eforge-plugin/.claude-plugin/plugin.json` version to `0.5.13`

### Out of Scope
- Source code changes (handled in plan-01)
- Test changes (handled in plan-01)

## Files

### Modify
- `docs/config.md` - Remove `parallelism: <cpu-count>` from build section. Remove `autoRevise: true` and `parallelism: 1` from prdQueue section. Add top-level `maxConcurrentBuilds: 2` to config reference. Rewrite "Parallelism" section: plan parallelism is automatic (plans run as soon as dependencies allow, no throttle needed for IO-bound LLM work), queue concurrency via `maxConcurrentBuilds`. Update CLI override reference from `--queue-parallelism` to `--max-concurrent-builds`.
- `docs/architecture.md` - Line 185: Replace `configurable via build.parallelism` with a note that plans run as soon as dependencies are met (IO-bound, no throttle needed).
- `eforge-plugin/skills/config/config.md` - Section 2 ("Build settings"): Remove `parallelism` from list, keep `postMergeCommands`, `maxValidationRetries`. Section 10 ("PRD queue"): Remove `autoRevise`. Add `maxConcurrentBuilds` as a top-level field in interview (new section or folded into queue section). Config reference: Remove `parallelism: 4` from build section. Remove `autoRevise: false` from prdQueue section. Add `maxConcurrentBuilds: 2` at top level with comment.
- `eforge/config.yaml` - Remove `prdQueue.parallelism: 2`, add top-level `maxConcurrentBuilds: 2`.
- `eforge-plugin/.claude-plugin/plugin.json` - Change `"version": "0.5.12"` to `"version": "0.5.13"`.

## Verification

- [ ] `grep -r 'build\.parallelism\|build:.*parallelism' docs/ eforge-plugin/skills/` returns no matches
- [ ] `grep -r 'autoRevise' docs/ eforge-plugin/skills/` returns no matches
- [ ] `grep -r 'prdQueue\.parallelism\|prdQueue:.*parallelism' docs/ eforge-plugin/skills/ eforge/config.yaml` returns no matches
- [ ] `grep 'maxConcurrentBuilds' docs/config.md` returns at least one match
- [ ] `grep 'maxConcurrentBuilds' eforge-plugin/skills/config/config.md` returns at least one match
- [ ] `grep 'maxConcurrentBuilds: 2' eforge/config.yaml` returns a match
- [ ] `grep '"version": "0.5.13"' eforge-plugin/.claude-plugin/plugin.json` returns a match
- [ ] `grep -- '--queue-parallelism' docs/` returns no matches
- [ ] `grep -- '--max-concurrent-builds' docs/config.md` returns a match
