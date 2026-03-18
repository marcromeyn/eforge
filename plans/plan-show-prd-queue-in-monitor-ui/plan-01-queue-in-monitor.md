---
id: plan-01-queue-in-monitor
name: Show PRD Queue in Monitor UI
depends_on: []
branch: plan-show-prd-queue-in-monitor-ui/queue-in-monitor
---

# Show PRD Queue in Monitor UI

## Architecture Context

The monitor is a detached HTTP server (`src/monitor/server.ts`) that serves a React SPA and JSON API endpoints. The server already receives `cwd` as a CLI argument in `server-main.ts` but does not pass it into `startServer()`. The PRD queue lives on disk as `.md` files with YAML frontmatter in `{cwd}/docs/prd-queue/`. The engine has a frontmatter parser in `src/engine/prd-queue.ts` (lines 58-96) but we deliberately duplicate it in the monitor to avoid pulling engine/zod dependencies into the monitor process.

## Implementation

### Overview

Thread `cwd` through from `server-main.ts` into `startServer()`, add a `/api/queue` endpoint that reads `.md` files from the queue directory and parses their frontmatter, then add a `QueueSection` React component to the sidebar that polls the endpoint every 5 seconds.

### Key Decisions

1. **Duplicate the frontmatter parser** rather than importing from the engine - the monitor process is intentionally lightweight with no zod or engine dependencies.
2. **Hardcode queue directory** to `docs/prd-queue/` matching `DEFAULT_CONFIG.prdQueue.dir` - custom `prdQueue.dir` from `eforge.yaml` is out of scope for v1.
3. **No git metadata** - unlike the engine's `loadQueue`, the endpoint skips git lookups to stay fast.
4. **Return `[]`** when `cwd` is unset or the queue directory doesn't exist - no error states.
5. **`useApi` + `setInterval` refetch** for 5-second polling - matches the existing data fetching pattern in the sidebar rather than adding SSE for queue data.

## Scope

### In Scope
- Threading `cwd` into `startServer()` via options object
- `/api/queue` endpoint with lightweight frontmatter parsing
- `QueueItem` TypeScript interface
- `fetchQueue()` API function
- `QueueSection` collapsible sidebar component with status dots, sorting, and polling
- Integration into the sidebar above the "Sessions" heading

### Out of Scope
- Custom `prdQueue.dir` from `eforge.yaml`
- Git metadata for queue items
- Shared frontmatter parsing code between engine and monitor
- Click-to-view queue item details
- Queue item actions (run, skip, remove)

## Files

### Create
- `src/monitor/ui/src/components/layout/queue-section.tsx` — Collapsible sidebar component displaying queue items with status dots, polling every 5 seconds via `useApi` + `setInterval` refetch. Uses Radix `Collapsible` (already in dependencies). Returns `null` when queue is empty. Items sorted: running first, then pending, then terminal states; within same status by priority ascending (nulls last).

### Modify
- `src/monitor/server-main.ts` — Pass `cwd` (already available as `process.argv[4]`) to `startServer()` as a third options parameter: `startServer(db, preferredPort, { cwd })`.
- `src/monitor/server.ts` — Accept `cwd` in the `options` parameter of `startServer()`. Add a `parseFrontmatter()` function (duplicated from engine's regex pattern at `src/engine/prd-queue.ts:58-96`). Add a `serveQueue()` handler that reads `.md` files from `{cwd}/docs/prd-queue/`, parses frontmatter, and returns `{ id, title, status, priority?, created?, dependsOn? }[]`. Add `/api/queue` route to the request handler. Return `[]` if `cwd` is unset or directory doesn't exist.
- `src/monitor/ui/src/lib/types.ts` — Add `QueueItem` interface: `{ id: string; title: string; status: string; priority?: number; created?: string; dependsOn?: string[] }`.
- `src/monitor/ui/src/lib/api.ts` — Add `fetchQueue()` function: `GET /api/queue → QueueItem[]`.
- `src/monitor/ui/src/components/layout/sidebar.tsx` — Import and render `<QueueSection />` above the "Sessions" `<h2>` heading. Pass `refreshTrigger` to enable re-polling on navigation.

## Verification

- [ ] `pnpm build` completes with exit code 0
- [ ] `pnpm test` passes with exit code 0
- [ ] `pnpm type-check` completes with exit code 0
- [ ] `/api/queue` returns a JSON array when the queue directory exists with `.md` files containing valid frontmatter
- [ ] `/api/queue` returns `[]` when `cwd` is unset (server started without cwd arg)
- [ ] `/api/queue` returns `[]` when `{cwd}/docs/prd-queue/` directory does not exist
- [ ] `/api/queue` response items contain fields: `id` (string), `title` (string), `status` (string), and optional `priority` (number), `created` (string), `dependsOn` (string array)
- [ ] `QueueSection` component renders above the "Sessions" heading in the sidebar
- [ ] `QueueSection` returns `null` (renders nothing) when the queue response is empty
- [ ] Queue items are sorted: status `running` first, then `pending`, then all other statuses; within the same status group, items with lower `priority` values appear first, items with no priority appear last
- [ ] Status dots use CSS colors: yellow for `pending`, blue with pulse animation for `running`, green for `completed`, red for `failed`, gray for `skipped`
- [ ] Text sizing uses `text-[11px]` and colors use `text-text-dim` / `text-foreground` matching existing sidebar conventions
- [ ] The section is collapsible via Radix `Collapsible` with a "Queue" header showing the pending item count as a badge
