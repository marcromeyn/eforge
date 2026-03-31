---
title: Implement eforge-release skill with release notes and release type
created: 2026-03-31
status: running
---

# Implement eforge-release skill with release notes and release type

## Problem / Motivation

Commit `9f1bc3c` was supposed to extend the `/eforge-release` skill with release notes generation, changelog management, and configurable release types, but the eforge build only created plan files and never modified the actual skill file. The cleanup commit `5138401` then removed the plan files. The skill remains in its original state - patch-only, no changelog, no release notes.

## Goal

Rewrite `.claude/skills/eforge-release/SKILL.md` to support configurable release types (`--patch`, `--minor`, `--major`), automatic release notes generation from conventional commits, changelog management, and GitHub Release creation.

## Approach

Complete rewrite of the single file `.claude/skills/eforge-release/SKILL.md`. The new workflow expands from 4 steps to 7 steps.

### Frontmatter updates

- `description`: Mention release type support and release notes (drop "patch version" wording)
- `argument-hint`: `"[--patch|--minor|--major]"`
- Keep `disable-model-invocation: true`

### New workflow

**Step 1: Parse Arguments** - Read `$ARGUMENTS` for `--patch`, `--minor`, `--major`. Default to `patch`.

**Step 2: Check Git Status** - Unchanged from current. Three outcomes: clean, all staged, unstaged/untracked (stop).

**Step 3: Commit Staged Changes** - Unchanged. Delegates to `/git:commit-message-policy`.

**Step 4: Generate Release Notes**
- Find previous tag: `git describe --tags --abbrev=0` (fallback: root commit via `git rev-list --max-parents=0 HEAD`)
- Collect commits: `git log $PREV_TAG..HEAD --oneline`
- Filter noise: version bumps (`^\w+ \d+\.\d+\.\d+$`), `enqueue(`, `cleanup(`, `plan(`, `Merge `, `bump plugin version`
- Strip `plan-NN-` prefixes from scopes (e.g., `feat(plan-01-foo)` -> `feat(foo)`)
- Deduplicate by description text (keep first)
- Group by conventional commit type into sections: Features (`feat`), Bug Fixes (`fix`), Refactoring (`refactor`), Documentation (`docs`), Maintenance (`chore`/`ci`/`build`/`test`), Other (anything else)
- Omit empty sections. If nothing remains, use "Maintenance release"

**Step 5: Update CHANGELOG.md**
- Compute new version via `node -e` semver increment on current `package.json` version
- Create `CHANGELOG.md` with `# Changelog` heading if it doesn't exist
- Prepend `## [X.Y.Z] - YYYY-MM-DD` entry with release notes after the heading
- Trim to 20 `## [` sections max; add footer linking to GitHub Releases if trimmed
- Commit: `git add CHANGELOG.md && git commit -m "docs: update CHANGELOG.md for vX.Y.Z"`

**Step 6: Bump Version and Push**
- `pnpm version <bump-type>` (creates version commit + tag)
- `git push origin --follow-tags`

**Step 7: Create GitHub Release and Summary**
- `gh release create v<version> --title "v<version>" --notes "<release-notes>"`
- Report: new version, release type, GitHub release link, npm publish reminder

## Scope

**In scope:**
- Complete rewrite of `.claude/skills/eforge-release/SKILL.md`
- Release type argument parsing (`--patch`, `--minor`, `--major`, default `patch`)
- Automatic release notes generation from git log with noise filtering and grouping
- CHANGELOG.md creation and maintenance (capped at 20 entries)
- GitHub Release creation via `gh`
- Summary output with version, release type, GitHub release link, and npm publish reminder

**Out of scope:**
- N/A

## Acceptance Criteria

- Running `/eforge-release` with no arguments defaults to a patch bump
- Running `/eforge-release --minor` bumps the minor version
- CHANGELOG.md is created if it doesn't exist, or updated if it does, with grouped release notes under a `## [X.Y.Z] - YYYY-MM-DD` heading
- A GitHub Release is created with the same grouped release notes
- Noise filtering strips eforge workflow commits (`enqueue(`, `cleanup(`, `plan(`, `Merge `, version bumps, `bump plugin version`)
- `plan-NN-` prefixes are stripped from conventional commit scopes
- Commits are deduplicated by description text
- Empty sections are omitted from release notes; if all commits are filtered, notes read "Maintenance release"
- CHANGELOG.md is trimmed to 20 version sections max, with a footer linking to GitHub Releases if trimmed
