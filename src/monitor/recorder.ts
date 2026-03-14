import type { EforgeEvent } from '../engine/events.js';
import type { MonitorDB } from './db.js';

/**
 * Middleware generator that records every EforgeEvent to SQLite,
 * then re-yields it unchanged. Also pushes events to live SSE
 * subscribers via the onEvent callback.
 */
export async function* withRecording(
  events: AsyncGenerator<EforgeEvent>,
  db: MonitorDB,
  cwd: string,
  onEvent?: (event: EforgeEvent, eventId: number) => void,
): AsyncGenerator<EforgeEvent> {
  let runId: string | undefined;

  for await (const event of events) {
    if (event.type === 'eforge:start') {
      runId = event.runId;
      db.insertRun({
        id: event.runId,
        planSet: event.planSet,
        command: event.command,
        status: 'running',
        startedAt: event.timestamp,
        cwd,
      });
    }

    if (runId) {
      const eventId = db.insertEvent({
        runId,
        type: event.type,
        planId: extractPlanId(event),
        agent: extractAgent(event),
        data: JSON.stringify(event),
        timestamp: 'timestamp' in event ? (event as { timestamp: string }).timestamp : new Date().toISOString(),
      });
      onEvent?.(event, eventId);
    }

    if (event.type === 'eforge:end' && runId) {
      db.updateRunStatus(runId, event.result.status, event.timestamp);
    }

    yield event;
  }
}

function extractPlanId(event: EforgeEvent): string | undefined {
  if ('planId' in event && typeof event.planId === 'string') return event.planId;
  if ('moduleId' in event && typeof event.moduleId === 'string') return event.moduleId;
  return undefined;
}

function extractAgent(event: EforgeEvent): string | undefined {
  if ('agent' in event && typeof event.agent === 'string') return event.agent;
  return undefined;
}
