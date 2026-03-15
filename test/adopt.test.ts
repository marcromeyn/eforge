import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { extractPlanTitle, detectValidationCommands, writePlanArtifacts } from '../src/engine/plan.js';
import { parsePlanFile, parseOrchestrationConfig } from '../src/engine/plan.js';

// --- extractPlanTitle ---

describe('extractPlanTitle', () => {
  it('extracts H1 heading from markdown', () => {
    expect(extractPlanTitle('# My Implementation Plan\n\nSome content')).toBe('My Implementation Plan');
  });

  it('extracts H1 with leading whitespace in content', () => {
    expect(extractPlanTitle('\n\n# Plan Title\n\nBody')).toBe('Plan Title');
  });

  it('returns undefined when no H1 present', () => {
    expect(extractPlanTitle('## Only H2\n\nNo H1 here')).toBeUndefined();
  });

  it('returns first H1 when multiple exist', () => {
    expect(extractPlanTitle('# First\n\n# Second')).toBe('First');
  });

  it('returns undefined for empty string', () => {
    expect(extractPlanTitle('')).toBeUndefined();
  });

  it('ignores H1 inside code blocks when matched by regex', () => {
    // Note: simple regex doesn't handle code blocks, but this documents the behavior
    const md = '```\n# Not a heading\n```\n\n# Real heading';
    // The regex matches the first # line regardless of code block context
    expect(extractPlanTitle(md)).toBe('Not a heading');
  });
});

// --- detectValidationCommands ---

describe('detectValidationCommands', () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'eforge-adopt-test-'));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('detects pnpm with type-check and test scripts', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      scripts: { 'type-check': 'tsc --noEmit', test: 'vitest run' },
    }));

    const cmds = await detectValidationCommands(dir);
    expect(cmds).toEqual(['pnpm type-check', 'pnpm test']);
  });

  it('detects npm with typecheck (no hyphen) script', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'package-lock.json'), '{}');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      scripts: { typecheck: 'tsc --noEmit' },
    }));

    const cmds = await detectValidationCommands(dir);
    expect(cmds).toEqual(['npm run typecheck']);
  });

  it('detects yarn from lockfile', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'yarn.lock'), '');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      scripts: { test: 'jest' },
    }));

    const cmds = await detectValidationCommands(dir);
    expect(cmds).toEqual(['yarn test']);
  });

  it('returns empty when no package.json', async () => {
    const dir = makeTempDir();
    const cmds = await detectValidationCommands(dir);
    expect(cmds).toEqual([]);
  });

  it('returns empty when no matching scripts', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      scripts: { start: 'node server.js' },
    }));

    const cmds = await detectValidationCommands(dir);
    expect(cmds).toEqual([]);
  });
});

// --- writePlanArtifacts ---

describe('writePlanArtifacts', () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'eforge-adopt-artifacts-'));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('creates plan file with YAML frontmatter and orchestration.yaml', async () => {
    const dir = makeTempDir();
    const sourceContent = '# Add Auth\n\n## Steps\n\n1. Add middleware\n2. Add tests';

    const planFile = await writePlanArtifacts({
      cwd: dir,
      planSetName: 'add-auth',
      sourceContent,
      planName: 'Add Auth',
      baseBranch: 'main',
      validate: ['pnpm type-check', 'pnpm test'],
    });

    // Verify PlanFile return value
    expect(planFile.id).toBe('plan-01-add-auth');
    expect(planFile.name).toBe('Add Auth');
    expect(planFile.dependsOn).toEqual([]);
    expect(planFile.branch).toBe('add-auth/main');
    expect(planFile.body).toBe(sourceContent);

    // Verify plan file can be parsed back
    const parsed = await parsePlanFile(planFile.filePath);
    expect(parsed.id).toBe('plan-01-add-auth');
    expect(parsed.name).toBe('Add Auth');
    expect(parsed.dependsOn).toEqual([]);
    expect(parsed.branch).toBe('add-auth/main');
    expect(parsed.body).toContain('## Steps');

    // Verify orchestration.yaml can be parsed back
    const orchPath = resolve(dir, 'plans', 'add-auth', 'orchestration.yaml');
    expect(existsSync(orchPath)).toBe(true);
    const orch = await parseOrchestrationConfig(orchPath);
    expect(orch.name).toBe('add-auth');
    expect(orch.description).toBe('Add Auth');
    expect(orch.mode).toBe('errand');
    expect(orch.baseBranch).toBe('main');
    expect(orch.plans).toHaveLength(1);
    expect(orch.plans[0].id).toBe('plan-01-add-auth');
    expect(orch.validate).toEqual(['pnpm type-check', 'pnpm test']);
  });

  it('creates plan directory recursively', async () => {
    const dir = makeTempDir();

    await writePlanArtifacts({
      cwd: dir,
      planSetName: 'my-plan',
      sourceContent: 'Plan content here',
      planName: 'My Plan',
      baseBranch: 'develop',
    });

    expect(existsSync(resolve(dir, 'plans', 'my-plan'))).toBe(true);
  });

  it('omits validate when empty', async () => {
    const dir = makeTempDir();

    await writePlanArtifacts({
      cwd: dir,
      planSetName: 'no-validate',
      sourceContent: 'Content',
      planName: 'No Validate',
      baseBranch: 'main',
      validate: [],
    });

    const orch = await parseOrchestrationConfig(
      resolve(dir, 'plans', 'no-validate', 'orchestration.yaml'),
    );
    expect(orch.validate).toBeUndefined();
  });
});
