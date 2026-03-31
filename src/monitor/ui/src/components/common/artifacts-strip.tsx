import { usePlanPreview } from '@/components/preview';
import { useApi } from '@/hooks/use-api';
import type { PlanData } from '@/lib/types';

interface ArtifactsStripProps {
  sessionId: string | null;
  prdSource: { label: string; content: string } | null;
}

const linkClass = "text-blue cursor-pointer hover:underline bg-transparent border-none p-0 font-inherit text-inherit";

export function ArtifactsStrip({ sessionId, prdSource }: ArtifactsStripProps) {
  const { openPreview, openContentPreview } = usePlanPreview();
  const { data: plans } = useApi<PlanData[]>(
    sessionId ? `/api/plans/${sessionId}` : null,
  );

  const architectureDocs = plans?.filter((p) => p.type === 'architecture') ?? [];
  const planFiles = plans?.filter((p) => p.type === 'plan' || p.type === 'module') ?? [];

  const hasArtifacts = prdSource !== null || architectureDocs.length > 0 || planFiles.length > 0;

  if (!hasArtifacts) return null;

  return (
    <div className="flex items-center gap-3 text-xs text-text-dim flex-wrap">
      {prdSource && (
        <button
          className={linkClass}
          onClick={() => openContentPreview(prdSource.label, prdSource.content)}
        >
          Build PRD
        </button>
      )}
      {architectureDocs.map((doc) => (
        <button
          key={doc.id}
          className={linkClass}
          onClick={() => openPreview(doc.id)}
        >
          Architecture
        </button>
      ))}
      {planFiles.map((plan) => (
        <button
          key={plan.id}
          className={linkClass}
          onClick={() => openPreview(plan.id)}
        >
          {plan.name || plan.id}
        </button>
      ))}
    </div>
  );
}
