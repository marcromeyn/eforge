import { useEffect, useMemo } from 'react';
import type { RunInfo } from '@/lib/types';
import { useApi } from '@/hooks/use-api';
import { RunItem } from './run-item';

interface SidebarProps {
  currentRunId: string | null;
  onSelectRun: (runId: string) => void;
  refreshTrigger: number;
}

interface PlanSetGroup {
  planSet: string;
  runs: RunInfo[];
}

function groupByPlanSet(runs: RunInfo[]): PlanSetGroup[] {
  const groups = new Map<string, RunInfo[]>();
  for (const run of runs) {
    const key = run.planSet || 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(run);
  }
  // Sort runs within each group: plan before build, then chronological (newest first)
  const commandOrder: Record<string, number> = { plan: 0, run: 1, build: 2 };
  for (const groupRuns of groups.values()) {
    groupRuns.sort((a, b) => {
      const ta = new Date(a.startedAt).getTime();
      const tb = new Date(b.startedAt).getTime();
      // Same timestamp bucket (within 1s) — sort plan before build
      if (Math.abs(ta - tb) < 1000) {
        return (commandOrder[a.command] ?? 9) - (commandOrder[b.command] ?? 9);
      }
      return tb - ta; // newest first
    });
  }
  // Sort groups by most recent run (newest group first)
  const sorted = [...groups.entries()].sort((a, b) => {
    const latestA = new Date(a[1][0].startedAt).getTime();
    const latestB = new Date(b[1][0].startedAt).getTime();
    return latestB - latestA;
  });
  return sorted.map(([planSet, runs]) => ({ planSet, runs }));
}

export function Sidebar({ currentRunId, onSelectRun, refreshTrigger }: SidebarProps) {
  const { data: runs, refetch } = useApi<RunInfo[]>('/api/runs');

  // Refetch when trigger changes
  useEffect(() => {
    if (refreshTrigger > 0) {
      refetch();
    }
  }, [refreshTrigger, refetch]);

  const groups = useMemo(() => groupByPlanSet(runs ?? []), [runs]);

  return (
    <aside className="bg-card border-r border-border overflow-y-auto p-2">
      <h2 className="text-[11px] uppercase tracking-wide text-text-dim px-2 py-2 pb-1">
        Runs
      </h2>
      {groups.map((group) => (
        <div key={group.planSet} className="mb-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-dim/70 px-2.5 py-1 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan/50" />
            {group.planSet}
          </div>
          {group.runs.map((run) => (
            <RunItem
              key={run.id}
              run={run}
              isActive={run.id === currentRunId}
              onSelect={onSelectRun}
            />
          ))}
        </div>
      ))}
    </aside>
  );
}
