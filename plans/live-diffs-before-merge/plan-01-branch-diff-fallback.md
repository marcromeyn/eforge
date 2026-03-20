---
id: plan-01-branch-diff-fallback
name: Branch-Based Diff Fallback
depends_on: []
branch: live-diffs-before-merge/branch-diff-fallback
---

# Branch-Based Diff Fallback

## Architecture Context

The monitor's `serveDiff` function in `src/monitor/server.ts` serves file diffs for the Changes tab in the web dashboard. It resolves a merge commit SHA via `resolveCommitSha` and uses `git diff-tree` to produce diffs. During active builds, `resolveCommitSha` returns null because no `merge:complete` event exists yet - but the plan branch already has committed changes (via `forgeCommit()`), so diffs are available via `git diff baseBranch..planBranch`.

The `RunRecord` in the monitor DB carries both `cwd` and `planSet` fields. The `orchestration.yaml` file (written during compile, before build starts) contains `base_branch` and per-plan `branch` fields. These two pieces give us everything needed to construct branch-based diffs.

## Implementation

### Overview

Add a `resolvePlanBranch` helper that reads orchestration.yaml from the filesystem to find `baseBranch` and the plan's `branch`. Modify `serveDiff` to fall back to branch-based diffing (`git diff baseBranch..planBranch`) when `resolveCommitSha` returns null.

### Key Decisions

1. **Read orchestration.yaml from disk rather than event data** - The `plan:complete` event carries per-plan `branch` but not `baseBranch`. The `OrchestrationConfig` in `orchestration.yaml` has both `base_branch` and per-plan branches. Since the file exists on disk from compile time (before build starts), reading it is reliable and avoids adding a new event type. The monitor server already imports `readFile` from `node:fs/promises`.

2. **Use `RunRecord.planSet` to locate orchestration.yaml** - The monitor DB's `RunRecord` has a `planSet` field alongside `cwd`. Combined, these give the path `{cwd}/plans/{planSet}/orchestration.yaml` without needing to scan directories or parse event data.

3. **Import `yaml` package for parsing** - The `yaml` package is already a project dependency (v2.8.2). A single `parse()` call extracts `base_branch` and the plans array. No need to regex-parse YAML.

4. **Return `{ diff, branch }` without `commitSha`** - The branch-based response omits `commitSha` since no merge commit exists yet. The frontend already handles optional fields in the diff response. After merge completes, the existing commit-based path takes over (it runs first in the resolution chain).

5. **Use `git diff baseBranch..planBranch` (two-dot) not three-dot** - Two-dot diff shows the changes between the tips of baseBranch and planBranch, which is what the user wants to see: all committed work on the plan branch relative to the base. Three-dot would show changes since the merge base, which could include base branch drift.

## Scope

### In Scope
- `resolvePlanBranch(sessionId, planId)` helper function in `src/monitor/server.ts`
- Fallback path in `serveDiff` for branch-based single-file and bulk diffs
- Import of `yaml` package in `src/monitor/server.ts`

### Out of Scope
- Changes to `resolveCommitSha` (existing commit-based path unchanged)
- Frontend/UI changes to the monitor dashboard
- Changes to event emission, `forgeCommit()`, or orchestration
- New event types

## Files

### Modify
- `src/monitor/server.ts` — Add `import { parse as parseYaml } from 'yaml'` at top. Add `resolvePlanBranch(sessionId, planId)` helper after `resolveCommitSha` (around line 446). Modify `serveDiff` to call `resolvePlanBranch` when `commitSha` is null, then execute branch-based git diffs for both single-file and bulk modes.

### Implementation Details

**`resolvePlanBranch` helper** (add after `resolveCommitSha`, around line 446):

```typescript
async function resolvePlanBranch(
  sessionId: string,
  planId: string,
): Promise<{ branch: string; baseBranch: string } | null> {
  // Get cwd and planSet from the session's run records
  const sessionRuns = db.getSessionRuns(sessionId);
  const run = [...sessionRuns].reverse().find((r) => r.cwd && r.planSet);
  if (!run) return null;

  // Read orchestration.yaml
  try {
    const orchPath = resolve(run.cwd, 'plans', run.planSet, 'orchestration.yaml');
    const content = await readFile(orchPath, 'utf-8');
    const orch = parseYaml(content);
    if (!orch?.base_branch || !Array.isArray(orch.plans)) return null;

    const plan = orch.plans.find((p: { id: string }) => p.id === planId);
    if (!plan?.branch) return null;

    return { branch: plan.branch, baseBranch: orch.base_branch };
  } catch {
    return null;
  }
}
```

**`serveDiff` modification** - replace the early 404 return when `commitSha` is null (lines 468-472) with:

```typescript
const commitSha = await resolveCommitSha(sessionId, planId, cwd);

if (!commitSha) {
  // Fallback: branch-based diffing for pre-merge builds
  const branchInfo = await resolvePlanBranch(sessionId, planId);
  if (!branchInfo) {
    res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: 'Commit not found' }));
    return;
  }

  const diffRef = `${branchInfo.baseBranch}..${branchInfo.branch}`;

  if (file) {
    // Single-file branch diff
    try {
      const { stdout } = await execAsync('git', ['diff', diffRef, '--', file], { cwd, maxBuffer: MAX_DIFF_SIZE + 1024 });

      if (stdout.includes('Binary file') && stdout.includes('differ')) {
        sendJson(res, { diff: null, binary: true, branch: branchInfo.branch });
        return;
      }

      if (Buffer.byteLength(stdout, 'utf-8') > MAX_DIFF_SIZE) {
        sendJson(res, { diff: null, tooLarge: true, branch: branchInfo.branch });
        return;
      }

      sendJson(res, { diff: stdout, branch: branchInfo.branch });
    } catch (err) {
      if (err instanceof Error && err.message.includes('maxBuffer')) {
        sendJson(res, { diff: null, tooLarge: true, branch: branchInfo.branch });
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Commit not found' }));
      }
    }
    return;
  }

  // Bulk branch diff
  try {
    const { stdout: nameOutput } = await execAsync('git', ['diff', diffRef, '--name-only'], { cwd });
    const filePaths = nameOutput.trim().split('\n').filter(Boolean);

    const files: Array<{ path: string; diff: string | null; tooLarge?: boolean; binary?: boolean }> = [];

    for (const fp of filePaths) {
      try {
        const { stdout: diffOutput } = await execAsync('git', ['diff', diffRef, '--', fp], { cwd, maxBuffer: MAX_DIFF_SIZE + 1024 });

        if (diffOutput.includes('Binary file') && diffOutput.includes('differ')) {
          files.push({ path: fp, diff: null, binary: true });
          continue;
        }

        if (Buffer.byteLength(diffOutput, 'utf-8') > MAX_DIFF_SIZE) {
          files.push({ path: fp, diff: null, tooLarge: true });
          continue;
        }

        files.push({ path: fp, diff: diffOutput });
      } catch (err) {
        if (err instanceof Error && err.message.includes('maxBuffer')) {
          files.push({ path: fp, diff: null, tooLarge: true });
        } else {
          files.push({ path: fp, diff: null });
        }
      }
    }

    sendJson(res, { files, branch: branchInfo.branch });
  } catch {
    res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: 'Commit not found' }));
  }
  return;
}
```

The existing commit-based path (lines 474-539) remains unchanged after this block.

## Verification

- [ ] `pnpm build` completes with exit code 0
- [ ] `pnpm type-check` completes with exit code 0
- [ ] `resolvePlanBranch` returns `{ branch, baseBranch }` when orchestration.yaml exists with a matching plan entry
- [ ] `resolvePlanBranch` returns null when orchestration.yaml does not exist or the planId is not found
- [ ] When `resolveCommitSha` returns null and `resolvePlanBranch` returns a result, single-file diffs use `git diff baseBranch..planBranch -- file`
- [ ] When `resolveCommitSha` returns null and `resolvePlanBranch` returns a result, bulk diffs use `git diff baseBranch..planBranch --name-only` then diff each file individually
- [ ] When both `resolveCommitSha` and `resolvePlanBranch` return null, a 404 JSON response is returned
- [ ] Branch-based responses include `{ branch }` and omit `commitSha`
- [ ] Post-merge diffs still use the existing `commitSha`-based path (no regression)
- [ ] Binary file detection and size limits apply to branch-based diffs the same as commit-based diffs
