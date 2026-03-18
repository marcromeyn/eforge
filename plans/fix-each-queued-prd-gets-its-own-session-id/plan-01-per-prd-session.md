---
id: plan-01-per-prd-session
name: Per-PRD Session Lifecycle in Queue Mode
depends_on: []
branch: fix-each-queued-prd-gets-its-own-session-id/per-prd-session
---

# Per-PRD Session Lifecycle in Queue Mode

## Architecture Context

The monitor groups events by `sessionId` to show timelines, token counts, and costs per session. When `eforge run --queue` processes multiple PRDs, the CLI currently creates a single `sessionId` and wraps the entire queue's event stream with it via `withSessionId()`. This merges all PRDs into one monitor session.

Session lifecycle must move into the engine's `runQueue()` so each PRD gets its own `sessionId`, and the CLI stops imposing a queue-wide session wrapper.

## Implementation

### Overview

Two changes: (1) engine emits `session:start`/`session:end` around each PRD's compile+build in `runQueue()`, stamping every yielded event with that PRD's session ID; (2) CLI stops creating a single session ID for queue mode at both call sites.

### Key Decisions

1. Queue-level events (`queue:start`, `queue:complete`, `queue:prd:start`, `queue:prd:skip`) remain outside session boundaries and carry no `sessionId` - they're queue metadata, not part of any PRD's session.
2. `session:start` is emitted after `updatePrdStatus('running')` and before `this.compile()`. `session:end` is emitted after build completes (or compile fails), before `queue:prd:complete`. This mirrors the existing session lifecycle for single-PRD `run` commands.
3. The CLI passes `emitSessionStart: false, emitSessionEnd: false` (with no `sessionId`) to `wrapEvents` so `withSessionId` becomes a no-op passthrough for queue mode - it won't create its own session or stamp events, since the engine already handles that.

## Scope

### In Scope
- `src/engine/eforge.ts` - per-PRD session events in `runQueue()`
- `src/cli/index.ts` - two call sites stop creating queue-level sessions

### Out of Scope
- Changes to `src/engine/session.ts`
- Monitor recording or rendering logic
- Non-queue run modes (single PRD `run` already has correct session handling)
- `watchQueue()` - delegates to `runQueue()` and passes events through, so it inherits the fix

## Files

### Modify
- `src/engine/eforge.ts` — In `runQueue()`, after `updatePrdStatus('running')` (line 609), create a `prdSessionId` via `randomUUID()` and yield `session:start`. Wrap the `compile()` and `build()` event loops to stamp each yielded event with `sessionId: prdSessionId`. After the build loop (or after compile failure), yield `session:end` with the final status before `queue:prd:complete`. `randomUUID` is already imported from `node:crypto`.
- `src/cli/index.ts` — At both queue call sites (lines ~224/240 for `run --queue` and lines ~494/510 for `queue run`): remove the `const sessionId = randomUUID()` line and change the `wrapEvents` call to pass `{ emitSessionStart: false, emitSessionEnd: false }` instead of `{ sessionId, emitSessionStart: true, emitSessionEnd: true }`.

## Verification

- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` exits with code 0
- [ ] In `runQueue()`, `session:start` is yielded before `this.compile()` for each PRD
- [ ] In `runQueue()`, `session:end` is yielded after build completes or compile fails, before `queue:prd:complete`
- [ ] Each PRD's compile and build events are stamped with that PRD's unique `sessionId`
- [ ] Queue-level events (`queue:start`, `queue:complete`, `queue:prd:start`, `queue:prd:skip`) have no `sessionId`
- [ ] CLI no longer creates a `sessionId` for queue mode at either call site
- [ ] `wrapEvents` is called with `emitSessionStart: false, emitSessionEnd: false` for queue mode at both call sites
