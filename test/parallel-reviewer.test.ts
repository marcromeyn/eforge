import { describe, it, expect } from 'vitest';
import type { ReviewIssue } from '../src/engine/events.js';
import { deduplicateIssues } from '../src/engine/agents/parallel-reviewer.js';

describe('deduplicateIssues', () => {
  it('removes exact duplicates keeping highest severity', () => {
    const issues: ReviewIssue[] = [
      { severity: 'warning', category: 'types', file: 'a.ts', line: 10, description: 'Unsafe cast' },
      { severity: 'critical', category: 'security', file: 'a.ts', line: 10, description: 'Unsafe cast' },
    ];

    const result = deduplicateIssues(issues);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('critical');
  });

  it('keeps distinct issues from different files', () => {
    const issues: ReviewIssue[] = [
      { severity: 'warning', category: 'bugs', file: 'a.ts', line: 10, description: 'Bug found' },
      { severity: 'warning', category: 'bugs', file: 'b.ts', line: 10, description: 'Bug found' },
    ];

    const result = deduplicateIssues(issues);
    expect(result).toHaveLength(2);
  });

  it('keeps issues with different lines in the same file', () => {
    const issues: ReviewIssue[] = [
      { severity: 'warning', category: 'bugs', file: 'a.ts', line: 10, description: 'Same desc' },
      { severity: 'warning', category: 'bugs', file: 'a.ts', line: 20, description: 'Same desc' },
    ];

    const result = deduplicateIssues(issues);
    expect(result).toHaveLength(2);
  });

  it('keeps issues with different descriptions at the same location', () => {
    const issues: ReviewIssue[] = [
      { severity: 'warning', category: 'bugs', file: 'a.ts', line: 10, description: 'Issue one' },
      { severity: 'warning', category: 'security', file: 'a.ts', line: 10, description: 'Issue two' },
    ];

    const result = deduplicateIssues(issues);
    expect(result).toHaveLength(2);
  });

  it('handles empty input', () => {
    expect(deduplicateIssues([])).toEqual([]);
  });

  it('handles issues without line numbers', () => {
    const issues: ReviewIssue[] = [
      { severity: 'suggestion', category: 'dry', file: 'a.ts', description: 'Extract method' },
      { severity: 'warning', category: 'dry', file: 'a.ts', description: 'Extract method' },
    ];

    const result = deduplicateIssues(issues);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('warning');
  });
});

