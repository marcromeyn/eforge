---
id: plan-01-stale-lock-detection
name: Add stale lock detection to claimPrd
depends_on: []
branch: add-stale-lock-detection-to-claimprd/stale-lock-detection
---

# Add stale lock detection to claimPrd

## Architecture Context

`claimPrd()` uses `O_CREAT | O_EXCL` to atomically create a `.lock` file containing the owning PID. If a process crashes without calling `releasePrd()`, the lock file persists and the PRD is stuck forever. This plan adds PID liveness checking to recover from stale locks.

The PID liveness pattern (`process.kill(pid, 0)` in a try/catch) already exists in `src/monitor/lockfile.ts` as `isPidAlive()`. Since the engine should not import from the monitor package, the same trivial pattern is inlined directly in the `claimPrd()` catch block.

## Implementation

### Overview

When `claimPrd()` catches `EEXIST`, it reads the lock file contents, parses the PID, checks if that PID is alive via `process.kill(pid, 0)`, and if dead, removes the stale lock file and retries the exclusive open exactly once.

### Key Decisions

1. **Inline the PID check rather than importing from monitor** - The engine package should not depend on the monitor package. The pattern is 5 lines; extracting a shared utility is not worth the coupling.
2. **Retry exactly once after removing a stale lock** - Prevents infinite loops. If the retry also gets `EEXIST`, another process claimed it between our remove and retry, which is correct behavior (return `false`).
3. **Use `readFile` on the lock path to get the PID** - The lock file contains just the PID string (written on line 339 of current code). Parse with `parseInt()` and validate it's a positive integer before checking liveness.
4. **Gracefully handle corrupt/empty lock files** - If the lock file can't be read or doesn't contain a valid PID, return `false` (treat as actively held) rather than crashing.

## Scope

### In Scope
- Modify `claimPrd()` in `src/engine/prd-queue.ts` to detect and recover from stale locks
- Add tests for stale lock detection in `test/prd-queue.test.ts`

### Out of Scope
- Changes to `releasePrd()` or any other function
- Extracting a shared PID utility
- Changes to the monitor lockfile module

## Files

### Modify
- `src/engine/prd-queue.ts` - Add stale lock detection logic in the `EEXIST` catch block of `claimPrd()`: read lock file, parse PID, check liveness, remove stale lock and retry once if dead
- `test/prd-queue.test.ts` - Add tests: (1) claimPrd returns true and re-acquires when lock file contains a dead PID, (2) claimPrd returns false when lock file contains a live PID (current process PID), (3) claimPrd returns false when lock file contains invalid/corrupt content

## Verification

- [ ] `claimPrd()` returns `true` when called on a PRD whose `.lock` file contains a PID that does not exist (simulated by writing a lock file with PID 999999 or similar non-existent PID)
- [ ] `claimPrd()` returns `false` when called on a PRD whose `.lock` file contains `process.pid` (the current, alive process)
- [ ] `claimPrd()` returns `false` when the lock file contains non-numeric content (corrupt lock)
- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` exits with code 0
