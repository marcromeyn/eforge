---
id: plan-01-port-registry
name: Global Monitor Port Registry
depends_on: []
branch: fix-monitor-port-collisions-across-simultaneous-projects/port-registry
---

# Global Monitor Port Registry

## Architecture Context

The monitor server currently uses a hardcoded default port (4567) with per-project lockfiles at `{cwd}/.eforge/daemon.lock`. When two projects run simultaneously, the second project can hijack port 4567 because it only checks its own lockfile - it has no visibility into what other projects have claimed. The fix is a global port registry at `$XDG_CONFIG_HOME/eforge/monitors.json` that tracks which project owns which port, combined with deterministic port hashing so each project gets a stable preferred port.

## Implementation

### Overview

Create a new `src/monitor/registry.ts` module that manages a global port registry file at `$XDG_CONFIG_HOME/eforge/monitors.json`. Integrate it into the monitor startup flow (`ensureMonitor` and `server-main.ts`) so that:
1. Each project gets a deterministic preferred port derived from hashing its `cwd`
2. The registry prevents two projects from claiming the same port
3. Stale entries (dead PIDs) are pruned on every read
4. The actual bound port + PID are written back after successful bind
5. Entries are removed on monitor shutdown

Also update the CLI to print the monitor URL more prominently (bold + green instead of dim) when the port differs from 4567.

### Key Decisions

1. **Hash-based port allocation (range 4567-4667)**: Use a simple hash of the absolute `cwd` path to pick a preferred port in a 101-port range. This gives stability across runs without needing to persist anything - the same project directory always prefers the same port. The range is small enough to be memorable but large enough for typical concurrent usage.

2. **Global registry at `$XDG_CONFIG_HOME/eforge/monitors.json`**: Uses the same XDG convention as `getUserConfigPath()` in `src/engine/config.ts` — `$XDG_CONFIG_HOME/eforge/` when set, `~/.config/eforge/` otherwise. The file stores `{ [cwd]: { port, pid } }` entries. Stale entries (dead PIDs) are pruned on read. The file is atomically written (temp + rename) to prevent corruption from concurrent access.

3. **Registry is advisory, not a lock**: The registry prevents eforge-vs-eforge collisions. Non-eforge processes may still occupy a port, which the existing EADDRINUSE retry logic handles. When a preferred port is taken by another eforge project, the allocator skips to the next available port in range.

4. **Per-project lockfile unchanged**: The `{cwd}/.eforge/daemon.lock` lockfile continues to be the authoritative source for a project's own monitor port. The global registry is only consulted during allocation to avoid cross-project collisions.

5. **`--port` override registers in the global registry**: When a user explicitly sets `--port`, that port is registered in the global registry to prevent other projects from auto-claiming it.

## Scope

### In Scope
- New `src/monitor/registry.ts` module with: `allocatePort(cwd, preferredPort?)`, `registerPort(cwd, port, pid)`, `deregisterPort(cwd)`, `hashPort(cwd)` functions
- Modify `src/monitor/index.ts` `ensureMonitor()` to call `allocatePort()` instead of using `DEFAULT_PORT` directly
- Modify `src/monitor/server-main.ts` to call `registerPort()` after bind and `deregisterPort()` on shutdown
- Modify CLI to print monitor URL in bold green when port is non-default, keeping dim for default port

### Out of Scope
- Changes to the daemon or build execution
- Changes to the per-project lockfile format or behavior
- Changes to the monitor UI

## Files

### Create
- `src/monitor/registry.ts` - Global port registry: read/write/prune `$XDG_CONFIG_HOME/eforge/monitors.json`, hash-based port allocation, atomic file writes

### Modify
- `src/monitor/index.ts` - Replace `DEFAULT_PORT` with `allocatePort(cwd)` in `ensureMonitor()`. Pass allocated port to `spawnDetachedServer()`. Import and use registry functions.
- `src/monitor/server-main.ts` - Call `registerPort(cwd, server.port, process.pid)` after successful server bind (after `writeLockfile`). Call `deregisterPort(cwd)` in `shutdown()` (before `removeLockfile`).
- `src/cli/index.ts` - Update `withMonitor()` to print the monitor URL in bold green (`chalk.green.bold`) when port differs from 4567, keeping `chalk.dim` for default port. Update the daemon enqueue flow's URL print similarly.

## Implementation Details

### `src/monitor/registry.ts`

```typescript
// Registry file location: $XDG_CONFIG_HOME/eforge/monitors.json (or ~/.config/eforge/monitors.json)
// Format: { "/abs/path/to/project": { "port": 4567, "pid": 1234 } }

interface RegistryEntry {
  port: number;
  pid: number;
}

type Registry = Record<string, RegistryEntry>;

const PORT_RANGE_START = 4567;
const PORT_RANGE_SIZE = 101; // 4567-4667

// hashPort(cwd): deterministic port from cwd string
// - Use simple string hash (sum of char codes * prime) mod PORT_RANGE_SIZE + PORT_RANGE_START
// - Must be pure function, no I/O

// readRegistry(): read + prune stale entries (dead PIDs via isPidAlive)
// - Returns pruned registry, writes back if any entries were pruned
// - Creates file if missing, returns {} on parse error

// writeRegistry(registry): atomic write (temp + rename)

// allocatePort(cwd, explicitPort?):
// 1. If explicitPort provided, return it (will be registered after bind)
// 2. Read + prune registry
// 3. If cwd already has a live entry, return that port
// 4. Compute preferred = hashPort(cwd)
// 5. Collect all ports claimed by OTHER projects
// 6. If preferred not claimed, return it
// 7. Otherwise, scan PORT_RANGE_START..PORT_RANGE_START+PORT_RANGE_SIZE-1
//    starting from preferred, wrapping around, skip claimed ports
// 8. Return first unclaimed port

// registerPort(cwd, port, pid): write entry to registry
// deregisterPort(cwd): remove entry from registry
```

### `src/monitor/index.ts` changes

In `ensureMonitor()`:
```typescript
// Before: const preferredPort = options?.port ?? DEFAULT_PORT;
// After:
import { allocatePort } from './registry.js';
const preferredPort = allocatePort(cwd, options?.port);
```

Pass `preferredPort` to `spawnDetachedServer()` as before - no change to spawn args.

### `src/monitor/server-main.ts` changes

After `writeLockfile()` (line 348-352):
```typescript
import { registerPort, deregisterPort } from './registry.js';
// After writeLockfile:
registerPort(cwd, server.port, process.pid);
```

In `shutdown()` function (before `removeLockfile`):
```typescript
deregisterPort(cwd);
```

### `src/cli/index.ts` changes

In `withMonitor()`:
```typescript
// Before: console.error(chalk.dim(`  Monitor: ${monitor.server.url}`));
// After:
if (monitor.server.port !== 4567) {
  console.error(chalk.green.bold(`  Monitor: ${monitor.server.url}`));
} else {
  console.error(chalk.dim(`  Monitor: ${monitor.server.url}`));
}
```

Similar change for the daemon enqueue flow (line 268).

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes with zero failures
- [ ] `hashPort()` returns a number in range 4567-4667 for any input string
- [ ] `hashPort()` returns the same value for the same input across calls (deterministic)
- [ ] `allocatePort()` returns the hash-derived port when no other project claims it
- [ ] `allocatePort()` skips ports claimed by other live projects in the registry
- [ ] `allocatePort()` reuses an existing live entry for the same `cwd`
- [ ] `registerPort()` writes to `$XDG_CONFIG_HOME/eforge/monitors.json` atomically (temp + rename)
- [ ] `deregisterPort()` removes the entry for the given `cwd`
- [ ] Stale registry entries (dead PIDs) are pruned during `allocatePort()`
- [ ] `--port` explicit override is passed through to `allocatePort()` and registered after bind
- [ ] Monitor URL is printed in bold green when port differs from 4567
- [ ] Monitor URL is printed in dim when port is 4567
- [ ] `ensureMonitor()` calls `allocatePort()` instead of using hardcoded 4567
- [ ] `server-main.ts` calls `registerPort()` after successful bind
- [ ] `server-main.ts` calls `deregisterPort()` during shutdown before lockfile removal
