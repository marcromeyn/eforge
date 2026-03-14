import { useMemo } from 'react';
import type { RunState, WaveInfo } from '@/lib/reducer';

export type RiskLevel = 'none' | 'single' | 'cross-wave' | 'same-wave';

export interface HeatmapFile {
  path: string;
  overlapCount: number;
  maxRisk: RiskLevel;
}

export interface HeatmapPlan {
  id: string;
  name: string;
  waveIndex: number;
}

export interface HeatmapData {
  files: HeatmapFile[];
  plans: HeatmapPlan[];
  matrix: Map<string, Map<string, RiskLevel>>;
  stats: {
    totalFiles: number;
    overlappingFiles: number;
    sameWaveOverlaps: number;
  };
}

/**
 * Compute heatmap data from fileChanges and waves.
 * Exported separately for testability.
 */
export function computeHeatmapData(
  fileChanges: Map<string, string[]>,
  waves: WaveInfo[],
): HeatmapData {
  // Build plan → wave index lookup
  const planWaveIndex = new Map<string, number>();
  for (const w of waves) {
    for (const pid of w.planIds) {
      planWaveIndex.set(pid, w.wave);
    }
  }

  // Collect all plan IDs from fileChanges (even if no wave info yet)
  const allPlanIds = new Set<string>(fileChanges.keys());

  // Build plans list ordered by wave index, then alphabetical
  const plans: HeatmapPlan[] = Array.from(allPlanIds)
    .map((id) => ({
      id,
      name: id,
      waveIndex: planWaveIndex.get(id) ?? 0,
    }))
    .sort((a, b) => a.waveIndex - b.waveIndex || a.id.localeCompare(b.id));

  // Invert: file → set of planIds that touched it
  const fileToPlanIds = new Map<string, Set<string>>();
  for (const [planId, files] of fileChanges) {
    for (const file of files) {
      let planSet = fileToPlanIds.get(file);
      if (!planSet) {
        planSet = new Set();
        fileToPlanIds.set(file, planSet);
      }
      planSet.add(planId);
    }
  }

  // Determine risk for each file-plan pair
  const matrix = new Map<string, Map<string, RiskLevel>>();
  let sameWaveOverlaps = 0;
  let overlappingFiles = 0;

  const files: HeatmapFile[] = [];

  for (const [filePath, touchingPlanIds] of fileToPlanIds) {
    const planRisks = new Map<string, RiskLevel>();
    let maxRisk: RiskLevel = 'none';
    const overlapCount = touchingPlanIds.size;
    const isOverlapping = overlapCount > 1;

    if (isOverlapping) {
      overlappingFiles++;
    }

    // Check if any pair of touching plans is in the same wave
    const touchingArray = Array.from(touchingPlanIds);
    let hasSameWave = false;

    if (isOverlapping) {
      for (let i = 0; i < touchingArray.length; i++) {
        for (let j = i + 1; j < touchingArray.length; j++) {
          const waveA = planWaveIndex.get(touchingArray[i]);
          const waveB = planWaveIndex.get(touchingArray[j]);
          if (waveA !== undefined && waveB !== undefined && waveA === waveB) {
            hasSameWave = true;
            break;
          }
        }
        if (hasSameWave) break;
      }
    }

    if (hasSameWave) {
      sameWaveOverlaps++;
    }

    // Assign risk levels per plan for this file
    for (const planId of allPlanIds) {
      if (!touchingPlanIds.has(planId)) {
        planRisks.set(planId, 'none');
      } else if (!isOverlapping) {
        planRisks.set(planId, 'single');
        if (riskOrder('single') > riskOrder(maxRisk)) maxRisk = 'single';
      } else if (hasSameWave) {
        planRisks.set(planId, 'same-wave');
        if (riskOrder('same-wave') > riskOrder(maxRisk)) maxRisk = 'same-wave';
      } else {
        planRisks.set(planId, 'cross-wave');
        if (riskOrder('cross-wave') > riskOrder(maxRisk)) maxRisk = 'cross-wave';
      }
    }

    matrix.set(filePath, planRisks);
    files.push({ path: filePath, overlapCount, maxRisk });
  }

  // Sort files by overlap count descending, then alphabetical
  files.sort((a, b) => b.overlapCount - a.overlapCount || a.path.localeCompare(b.path));

  return {
    files,
    plans,
    matrix,
    stats: {
      totalFiles: files.length,
      overlappingFiles,
      sameWaveOverlaps,
    },
  };
}

function riskOrder(level: RiskLevel): number {
  switch (level) {
    case 'none': return 0;
    case 'single': return 1;
    case 'cross-wave': return 2;
    case 'same-wave': return 3;
  }
}

export function useHeatmapData(runState: RunState): HeatmapData {
  return useMemo(
    () => computeHeatmapData(runState.fileChanges, runState.waves),
    [runState.fileChanges, runState.waves],
  );
}
