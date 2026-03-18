import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolve } from 'node:path';
import { useTempDir } from './test-tmpdir.js';

// We need to mock lockfile, isServerAlive, and openDatabase
// to test signalMonitorShutdown without real servers

vi.mock('../src/monitor/lockfile.js', () => ({
  readLockfile: vi.fn(),
  isServerAlive: vi.fn(),
}));

vi.mock('../src/monitor/db.js', () => ({
  openDatabase: vi.fn(),
}));

import { signalMonitorShutdown } from '../src/monitor/index.js';
import { readLockfile, isServerAlive } from '../src/monitor/lockfile.js';
import { openDatabase } from '../src/monitor/db.js';

const mockReadLockfile = vi.mocked(readLockfile);
const mockIsServerAlive = vi.mocked(isServerAlive);
const mockOpenDatabase = vi.mocked(openDatabase);

describe('signalMonitorShutdown', () => {
  const makeTempDir = useTempDir();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing when lockfile is not found', async () => {
    const cwd = makeTempDir();
    mockReadLockfile.mockReturnValue(null);

    await signalMonitorShutdown(cwd);

    expect(mockReadLockfile).toHaveBeenCalledWith(cwd);
    expect(mockIsServerAlive).not.toHaveBeenCalled();
  });

  it('does nothing when server is not alive', async () => {
    const cwd = makeTempDir();
    mockReadLockfile.mockReturnValue({ pid: 99999, port: 4567, startedAt: new Date().toISOString() });
    mockIsServerAlive.mockResolvedValue(false);

    await signalMonitorShutdown(cwd);

    expect(mockIsServerAlive).toHaveBeenCalled();
    expect(mockOpenDatabase).not.toHaveBeenCalled();
  });

  it('does not send SIGTERM when runs are still active', async () => {
    const cwd = makeTempDir();
    const fakePid = process.pid; // Use own PID so it's definitely alive
    mockReadLockfile.mockReturnValue({ pid: fakePid, port: 4567, startedAt: new Date().toISOString() });
    mockIsServerAlive.mockResolvedValue(true);

    const fakeDb = {
      getRunningRuns: () => [{ id: 'run-1', status: 'running' }],
      close: vi.fn(),
    };
    mockOpenDatabase.mockReturnValue(fakeDb as unknown as ReturnType<typeof openDatabase>);

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    await signalMonitorShutdown(cwd);

    expect(fakeDb.close).toHaveBeenCalled();
    expect(killSpy).not.toHaveBeenCalled();

    killSpy.mockRestore();
  });

  it('sends SIGTERM when server is alive with no running runs', async () => {
    const cwd = makeTempDir();
    const fakePid = 12345;
    mockReadLockfile.mockReturnValue({ pid: fakePid, port: 4567, startedAt: new Date().toISOString() });
    mockIsServerAlive.mockResolvedValue(true);

    const fakeDb = {
      getRunningRuns: () => [],
      close: vi.fn(),
    };
    mockOpenDatabase.mockReturnValue(fakeDb as unknown as ReturnType<typeof openDatabase>);

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    await signalMonitorShutdown(cwd);

    expect(fakeDb.close).toHaveBeenCalled();
    expect(killSpy).toHaveBeenCalledWith(fakePid, 'SIGTERM');

    killSpy.mockRestore();
  });
});
