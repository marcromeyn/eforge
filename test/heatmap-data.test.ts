import { describe, it, expect } from 'vitest';
import { computeHeatmapData, type RiskLevel } from '../src/monitor/ui/src/components/heatmap/use-heatmap-data';

describe('computeHeatmapData', () => {
  it('returns empty data for empty inputs', () => {
    const result = computeHeatmapData(new Map(), []);
    expect(result.files).toEqual([]);
    expect(result.plans).toEqual([]);
    expect(result.matrix.size).toBe(0);
    expect(result.stats).toEqual({ totalFiles: 0, overlappingFiles: 0, sameWaveOverlaps: 0 });
  });

  it('single plan, no overlaps — all files single risk', () => {
    const fileChanges = new Map([
      ['plan-01', ['src/a.ts', 'src/b.ts']],
    ]);
    const waves = [{ wave: 1, planIds: ['plan-01'] }];

    const result = computeHeatmapData(fileChanges, waves);

    expect(result.files).toHaveLength(2);
    expect(result.plans).toHaveLength(1);
    expect(result.stats.totalFiles).toBe(2);
    expect(result.stats.overlappingFiles).toBe(0);
    expect(result.stats.sameWaveOverlaps).toBe(0);

    // All files should be 'single' risk
    for (const file of result.files) {
      expect(file.maxRisk).toBe('single');
      expect(file.overlapCount).toBe(1);
    }

    // Matrix check
    expect(result.matrix.get('src/a.ts')?.get('plan-01')).toBe('single');
    expect(result.matrix.get('src/b.ts')?.get('plan-01')).toBe('single');
  });

  it('two plans in the same wave sharing files — same-wave risk', () => {
    const fileChanges = new Map([
      ['plan-01', ['src/shared.ts', 'src/a.ts']],
      ['plan-02', ['src/shared.ts', 'src/b.ts']],
    ]);
    const waves = [{ wave: 1, planIds: ['plan-01', 'plan-02'] }];

    const result = computeHeatmapData(fileChanges, waves);

    expect(result.stats.totalFiles).toBe(3);
    expect(result.stats.overlappingFiles).toBe(1);
    expect(result.stats.sameWaveOverlaps).toBe(1);

    // The shared file should be same-wave risk
    const sharedFile = result.files.find((f) => f.path === 'src/shared.ts');
    expect(sharedFile).toBeDefined();
    expect(sharedFile!.maxRisk).toBe('same-wave');
    expect(sharedFile!.overlapCount).toBe(2);

    // Non-shared files should be single risk
    const fileA = result.files.find((f) => f.path === 'src/a.ts');
    expect(fileA!.maxRisk).toBe('single');
  });

  it('two plans in different waves sharing files — cross-wave risk', () => {
    const fileChanges = new Map([
      ['plan-01', ['src/shared.ts', 'src/a.ts']],
      ['plan-02', ['src/shared.ts', 'src/b.ts']],
    ]);
    const waves = [
      { wave: 1, planIds: ['plan-01'] },
      { wave: 2, planIds: ['plan-02'] },
    ];

    const result = computeHeatmapData(fileChanges, waves);

    expect(result.stats.overlappingFiles).toBe(1);
    expect(result.stats.sameWaveOverlaps).toBe(0);

    const sharedFile = result.files.find((f) => f.path === 'src/shared.ts');
    expect(sharedFile!.maxRisk).toBe('cross-wave');
    expect(sharedFile!.overlapCount).toBe(2);

    // Matrix: both plans show cross-wave for the shared file
    expect(result.matrix.get('src/shared.ts')?.get('plan-01')).toBe('cross-wave');
    expect(result.matrix.get('src/shared.ts')?.get('plan-02')).toBe('cross-wave');
  });

  it('mixed scenario with same-wave and cross-wave overlaps', () => {
    const fileChanges = new Map([
      ['plan-01', ['src/shared-same.ts', 'src/shared-cross.ts', 'src/only-01.ts']],
      ['plan-02', ['src/shared-same.ts', 'src/only-02.ts']],
      ['plan-03', ['src/shared-cross.ts', 'src/only-03.ts']],
    ]);
    const waves = [
      { wave: 1, planIds: ['plan-01', 'plan-02'] },
      { wave: 2, planIds: ['plan-03'] },
    ];

    const result = computeHeatmapData(fileChanges, waves);

    expect(result.stats.totalFiles).toBe(5);
    expect(result.stats.overlappingFiles).toBe(2);
    expect(result.stats.sameWaveOverlaps).toBe(1);

    // shared-same.ts: plan-01 and plan-02 in same wave
    const sameFile = result.files.find((f) => f.path === 'src/shared-same.ts');
    expect(sameFile!.maxRisk).toBe('same-wave');

    // shared-cross.ts: plan-01 (wave 1) and plan-03 (wave 2)
    const crossFile = result.files.find((f) => f.path === 'src/shared-cross.ts');
    expect(crossFile!.maxRisk).toBe('cross-wave');
  });

  it('sorts files by overlap count descending', () => {
    const fileChanges = new Map([
      ['plan-01', ['src/a.ts', 'src/b.ts', 'src/c.ts']],
      ['plan-02', ['src/b.ts', 'src/c.ts']],
      ['plan-03', ['src/c.ts']],
    ]);
    const waves = [
      { wave: 1, planIds: ['plan-01'] },
      { wave: 2, planIds: ['plan-02'] },
      { wave: 3, planIds: ['plan-03'] },
    ];

    const result = computeHeatmapData(fileChanges, waves);

    expect(result.files[0].path).toBe('src/c.ts');
    expect(result.files[0].overlapCount).toBe(3);
    expect(result.files[1].path).toBe('src/b.ts');
    expect(result.files[1].overlapCount).toBe(2);
    expect(result.files[2].path).toBe('src/a.ts');
    expect(result.files[2].overlapCount).toBe(1);
  });

  it('orders plans by wave index then alphabetical', () => {
    const fileChanges = new Map([
      ['plan-c', ['src/a.ts']],
      ['plan-a', ['src/a.ts']],
      ['plan-b', ['src/a.ts']],
    ]);
    const waves = [
      { wave: 2, planIds: ['plan-c'] },
      { wave: 1, planIds: ['plan-a', 'plan-b'] },
    ];

    const result = computeHeatmapData(fileChanges, waves);

    expect(result.plans.map((p) => p.id)).toEqual(['plan-a', 'plan-b', 'plan-c']);
  });

  it('handles plans without wave assignment (defaults to wave 0)', () => {
    const fileChanges = new Map([
      ['plan-01', ['src/a.ts']],
    ]);
    // No waves defined yet
    const waves: { wave: number; planIds: string[] }[] = [];

    const result = computeHeatmapData(fileChanges, waves);

    expect(result.plans).toHaveLength(1);
    expect(result.plans[0].waveIndex).toBe(0);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].maxRisk).toBe('single');
  });
});
