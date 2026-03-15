import type { RunInfo } from '@/lib/types';
import { formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';

interface RunItemProps {
  run: RunInfo;
  isActive: boolean;
  onSelect: (runId: string) => void;
}

export function RunItem({ run, isActive, onSelect }: RunItemProps) {
  return (
    <div
      className={cn(
        'px-2.5 py-1.5 rounded-md cursor-pointer mb-px ml-2 border-l-2 transition-colors',
        'hover:bg-bg-tertiary border-transparent',
        isActive && 'bg-bg-tertiary border-cyan',
      )}
      onClick={() => onSelect(run.id)}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'inline-block w-1.5 h-1.5 rounded-full flex-shrink-0',
              run.status === 'running' && 'bg-blue animate-[pulse-opacity_1.5s_ease-in-out_infinite]',
              run.status === 'completed' && 'bg-green',
              run.status === 'failed' && 'bg-red',
            )}
          />
          <span className="text-xs font-medium text-text-bright">{run.command}</span>
        </div>
        <span className="text-[10px] text-text-dim">{formatTime(run.startedAt)}</span>
      </div>
    </div>
  );
}
