---
title: Fix Auto-Build to Be a Persistent Preference
created: 2026-03-25
status: pending
---

# Fix Auto-Build to Be a Persistent Preference

## Problem / Motivation

The previous eforge build (`6de8646`) changed auto-build from `--watch` mode to one-shot `runQueue()` to avoid SIGTERM killing mid-build. However, it also added `daemonState.autoBuild = false` on spawn (`src/monitor/server-main.ts`, line 255), making auto-build permanently one-shot — the user must re-enable it for every queue cycle. This causes two symptoms:

1. **Auto-build doesn't persist** — the flag resets on spawn, so the delayed respawn (lines 302-307) never fires because `autoBuild` is always false by exit time.
2. **UI toggle does nothing** — `POST /api/auto-build { enabled: true }` sets the flag to true, then calls `spawnWatcher()` which immediately resets it to false. The response returns `{ enabled: false }`, so the switch snaps back to OFF.

## Goal

Make auto-build a persistent preference: once enabled, the daemon keeps processing PRDs as they arrive until explicitly toggled off or a build fails.

## Approach

Remove the line `daemonState.autoBuild = false;` at line 255 of `src/monitor/server-main.ts`. This is the only code change required.

After the fix, the system behaves as follows:

**Auto-build ON → continuous processing:**
1. `autoBuild = true` → `spawnWatcher()` launches `eforge run --queue --auto --no-monitor`
2. Watcher processes all queued PRDs, exits (code 0)
3. Exit handler: wait `respawnDelayMs` (5s) → `autoBuild` still true → `spawnWatcher()` again
4. If queue is empty → watcher exits quickly → wait 5s → respawn (poll-via-respawn)
5. New PRD arrives → next cycle picks it up

**Toggle OFF → graceful stop:**
1. User toggles OFF → `autoBuild = false` (no kill, watcher keeps running)
2. Current watcher finishes its `runQueue()` cycle, exits (code 0)
3. Exit handler: wait 5s → `autoBuild` is false → no respawn

**Build failure → auto-pause:**
1. Watcher exits with non-zero code
2. Exit handler sets `autoBuild = false` + writes paused event (existing behavior, lines 295-300)

**Daemon startup:**
1. Loads config → `autoBuild = config.prdQueue.autoBuild` (default `true`)
2. If true → spawns watcher → poll-via-respawn begins

## Scope

**In scope:**
- Removing `daemonState.autoBuild = false;` from `spawnWatcher()` in `src/monitor/server-main.ts` (line 255)

**Out of scope:**
- Changes to the respawn logic, exit handler, or API endpoint behavior (these already work correctly once the flag is no longer reset)
- Changes to any other files

## Acceptance Criteria

1. `pnpm build` succeeds.
2. After daemon restart (via `/eforge-daemon-restart`), `GET /api/auto-build` returns `{ enabled: true }` (from config default).
3. Enqueuing a PRD causes the watcher to process it automatically.
4. Enqueuing another PRD after the first completes causes the watcher to respawn and process it without the user re-toggling auto-build.
5. Toggling auto-build OFF allows the current build to finish, then no respawn occurs.
6. Toggling auto-build ON spawns the watcher and resumes the poll-via-respawn cycle.
7. A build failure (non-zero exit code) sets `autoBuild = false` and writes a paused event (existing behavior preserved).
