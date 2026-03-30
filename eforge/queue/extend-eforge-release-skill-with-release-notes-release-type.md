---
title: Extend eforge-release Skill with Release Notes & Release Type
created: 2026-03-30
status: pending
---

# Extend eforge-release Skill with Release Notes & Release Type

## Problem / Motivation

The `/eforge-release` skill currently only supports patch releases and generates no release notes. There is no way to perform minor or major releases, no automated changelog, and no GitHub Release creation. This means release notes must be written manually, there is no permanent archive of releases on GitHub, and the changelog is not maintained.

## Goal

Extend the `/eforge-release` skill to support configurable release types (patch, minor, major) and auto-generate release notes from the git log, publishing them to both a rolling `CHANGELOG.md` and GitHub Releases.

## Approach

All changes are confined to a single file: `.claude/skills/eforge-release/SKILL.md`.

### Release Type Detection

Parse `$ARGUMENTS` before the existing workflow steps:
- `--major` - major bump
- `--minor` - minor bump
- `--patch` or empty - patch bump (default)

Update the skill frontmatter:
- `description` - mention release notes, remove "patch" specificity
- `argument-hint` - set to `"[--patch|--minor|--major]"`

### Release Notes Generation (new Step 3, after existing Steps 1-2)

- **3a**: Find previous tag via `git describe --tags --abbrev=0` (fall back to root commit if no tags)
- **3b**: Collect commits via `git log $PREV_TAG..HEAD --oneline`
- **3c**: Filter out noise commits matching:
  - Version bumps (`^\w+ \d+\.\d+\.\d+$`)
  - `enqueue(`
  - `cleanup(`
  - `plan(`
  - `Merge `
  - `bump plugin version`
- **3d**: Clean commit messages - strip hash, strip `plan-NN-` from scopes, extract description after `: `, deduplicate by description text
- **3e**: Group by conventional commit type into sections (Features, Bug Fixes, Refactoring, Performance, etc.) - omit empty sections
- **3f**: Format as markdown with `### Features`, `### Bug Fixes`, etc. headings and bullet entries
- If no meaningful commits found after filtering, use a simple "Maintenance release" note

### Rolling CHANGELOG.md Update (new Step 4)

- If `CHANGELOG.md` doesn't exist, create it with a `# Changelog` heading
- Compute the new version number (current version from `package.json` + bump type)
- Prepend a new entry after the `# Changelog` heading: `## [X.Y.Z] - YYYY-MM-DD` followed by the grouped release notes
- **Trim to 20 entries** - if there are more than 20 `## [` sections, remove the oldest ones and add a footer: `> Older releases: see [GitHub Releases](https://github.com/eforge-build/eforge/releases)`
- Commit: `git add CHANGELOG.md && git commit -m "docs: update CHANGELOG.md for vX.Y.Z"`
- Changelog commit is separate from the version bump commit to keep `pnpm version` commit clean

### Version Bump, Push, and GitHub Release (Step 5)

- Run `pnpm version <bump-type>` using the resolved type
- Run `git push origin --follow-tags`
- Run `gh release create v<new-version> --title "v<new-version>" --notes "<release-notes>"`

### Enhanced Summary (Step 6)

Report: new version, release type, link to the GitHub release, npm publish reminder.

### Key Design Decisions

- **Dual publish** - rolling CHANGELOG.md (last 20 releases) for quick scanning + GitHub Releases for permanent archive
- **Rolling window of 20** - keeps CHANGELOG.md scannable; older entries trimmed with pointer to GitHub Releases
- **Keep `disable-model-invocation: true`** - release workflows should never auto-trigger
- **No LLM summarization needed** - commit messages already follow conventional commits; mechanical extraction is sufficient
- **Deduplicate commits** - eforge workflow produces duplicate `feat(plan-NN-...)` messages when builds retry; keep only first occurrence

## Scope

**In scope:**
- Release type argument parsing (`--patch`, `--minor`, `--major`)
- Auto-generated release notes from git log with noise filtering
- Rolling `CHANGELOG.md` (last 20 releases)
- GitHub Releases via `gh release create`
- Updated skill frontmatter (description, argument-hint)
- Commit message deduplication
- Conventional commit type grouping

**Out of scope:**
- Changes to any file other than `.claude/skills/eforge-release/SKILL.md`
- LLM-based summarization of commits
- npm publish automation

## Acceptance Criteria

- Argument hint in frontmatter is set to `"[--patch|--minor|--major]"`
- Running `/eforge-release` with no arguments performs a patch release (default behavior preserved)
- Running with `--minor` or `--major` performs the corresponding version bump via `pnpm version`
- Release notes are auto-generated from `git log` between the previous tag and HEAD
- Commits matching noise patterns (`enqueue(`, `cleanup(`, `plan(`, version bumps, merge commits, `bump plugin version`) are excluded from release notes
- Commit messages are deduplicated by description text
- Release notes are grouped by conventional commit type with markdown section headings (`### Features`, `### Bug Fixes`, etc.) - empty sections omitted
- If no meaningful commits remain after filtering, release notes default to "Maintenance release"
- `CHANGELOG.md` is created if it does not exist, with a `# Changelog` heading
- New changelog entry is prepended with format `## [X.Y.Z] - YYYY-MM-DD`
- `CHANGELOG.md` is trimmed to 20 entries maximum, with a footer linking to GitHub Releases for older entries
- Changelog commit (`docs: update CHANGELOG.md for vX.Y.Z`) is separate from and precedes the `pnpm version` commit
- `gh release create` is called with the new version tag, title, and generated release notes
- Summary output includes: new version, release type, GitHub release link, npm publish reminder
- Filtering rules cover the commit patterns seen in `git log v0.2.0..HEAD`
- `disable-model-invocation: true` remains set in the skill frontmatter
