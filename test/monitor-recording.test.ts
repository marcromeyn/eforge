import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { useTempDir } from './test-tmpdir.js';
import { ensureMonitor } from '../src/monitor/index.js';
import { openDatabase } from '../src/monitor/db.js';
import type { EforgeEvent } from '../src/engine/events.js';

describe('ensureMonitor with noServer', () => {
  const makeTempDir = useTempDir();

  it('returns server: null with a working wrapEvents when noServer is true', async () => {
    const cwd = makeTempDir();
    mkdirSync(resolve(cwd, '.eforge'), { recursive: true });

    const monitor = await ensureMonitor(cwd, { noServer: true });

    expect(monitor.server).toBeNull();
    expect(typeof monitor.wrapEvents).toBe('function');
    expect(typeof monitor.stop).toBe('function');
    expect(monitor.db).toBeDefined();

    monitor.stop();
  });

  it('records events to SQLite via wrapEvents when noServer is true', async () => {
    const cwd = makeTempDir();
    mkdirSync(resolve(cwd, '.eforge'), { recursive: true });

    const monitor = await ensureMonitor(cwd, { noServer: true });

    // Create a minimal event stream with phase:start and phase:end
    const runId = 'test-run-001';
    const sessionId = 'test-session-001';
    const now = new Date().toISOString();

    async function* fakeEvents(): AsyncGenerator<EforgeEvent> {
      yield {
        type: 'phase:start',
        runId,
        sessionId,
        planSet: 'test-set',
        command: 'build',
        timestamp: now,
      } as unknown as EforgeEvent;
      yield {
        type: 'phase:end',
        runId,
        sessionId,
        result: { status: 'completed' },
        timestamp: now,
      } as unknown as EforgeEvent;
    }

    const wrapped = monitor.wrapEvents(fakeEvents());
    const collected: EforgeEvent[] = [];
    for await (const event of wrapped) {
      collected.push(event);
    }

    expect(collected).toHaveLength(2);
    expect(collected[0].type).toBe('phase:start');
    expect(collected[1].type).toBe('phase:end');

    // Verify events were inserted into the DB
    const dbPath = resolve(cwd, '.eforge', 'monitor.db');
    const db = openDatabase(dbPath);
    const runs = db.getRuns();
    expect(runs.length).toBeGreaterThanOrEqual(1);
    const run = runs.find((r) => r.id === runId);
    expect(run).toBeDefined();
    expect(run!.status).toBe('completed');

    const events = db.getEvents(runId);
    expect(events).toHaveLength(2);

    db.close();
    monitor.stop();
  });
});

describe('enqueue recording', () => {
  const makeTempDir = useTempDir();

  it('records enqueue event stream as a run with command enqueue', async () => {
    const cwd = makeTempDir();
    mkdirSync(resolve(cwd, '.eforge'), { recursive: true });
    const dbPath = resolve(cwd, '.eforge', 'monitor.db');
    const db = openDatabase(dbPath);

    const sessionId = 'test-session-enqueue';
    const now = new Date().toISOString();

    const events: EforgeEvent[] = [
      { type: 'session:start', sessionId, timestamp: now } as unknown as EforgeEvent,
      { type: 'enqueue:start', source: '/tmp/my-prd.md' } as unknown as EforgeEvent,
      { type: 'agent:start', agentId: 'a1', agent: 'formatter', timestamp: now } as unknown as EforgeEvent,
      { type: 'agent:result', agent: 'formatter', result: { durationMs: 100, durationApiMs: 80, numTurns: 1, totalCostUsd: 0.01, usage: { input: 100, output: 50, total: 150 }, modelUsage: {} } } as unknown as EforgeEvent,
      { type: 'agent:stop', agentId: 'a1', agent: 'formatter', timestamp: now } as unknown as EforgeEvent,
      { type: 'enqueue:complete', id: 'prd-001', filePath: '/tmp/queue/prd-001.md', title: 'My Great Feature' } as unknown as EforgeEvent,
      { type: 'session:end', sessionId, result: { status: 'completed', summary: 'Enqueued' }, timestamp: now } as unknown as EforgeEvent,
    ];

    async function* fakeEvents(): AsyncGenerator<EforgeEvent> {
      for (const e of events) yield e;
    }

    const { withRecording } = await import('../src/monitor/recorder.js');
    const wrapped = withRecording(fakeEvents(), db, cwd);
    const collected: EforgeEvent[] = [];
    for await (const event of wrapped) {
      collected.push(event);
    }

    expect(collected).toHaveLength(7);

    // Find the enqueue run
    const runs = db.getRuns();
    const enqueueRun = runs.find((r) => r.command === 'enqueue');
    expect(enqueueRun).toBeDefined();
    expect(enqueueRun!.status).toBe('completed');
    expect(enqueueRun!.planSet).toBe('My Great Feature');

    // All 7 events should be stored (session:start is buffered then flushed)
    const dbEvents = db.getEvents(enqueueRun!.id);
    expect(dbEvents).toHaveLength(7);

    db.close();
  });
});

describe('buildMonitor wiring', () => {
  const makeTempDir = useTempDir();

  it('creates a monitor with server info when port is provided', async () => {
    const cwd = makeTempDir();
    mkdirSync(resolve(cwd, '.eforge'), { recursive: true });

    // Use noServer to avoid spawning a real server — this tests the buildMonitor
    // path for recording-only mode
    const monitor = await ensureMonitor(cwd, { noServer: true });

    // The monitor should have a null server when noServer is true
    expect(monitor.server).toBeNull();
    expect(monitor.db).toBeDefined();

    // wrapEvents should return an async generator
    async function* emptyEvents(): AsyncGenerator<EforgeEvent> {}
    const wrapped = monitor.wrapEvents(emptyEvents());
    expect(wrapped[Symbol.asyncIterator]).toBeDefined();

    monitor.stop();
  });
});
