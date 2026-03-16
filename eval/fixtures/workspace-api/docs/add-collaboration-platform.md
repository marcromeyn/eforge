# Collaboration Platform

## Overview

Transform the workspace API into a collaboration platform with API key authentication, role-based access control, an in-memory event bus, audit logging, and full-text message search. These five capabilities are cross-cutting - auth and permissions touch every existing route, the event bus emits from every mutation, and audit/search both consume events.

## Requirements

### 1. API Key Authentication

Add API key-based authentication to protect all endpoints.

1. Add an `ApiKey` interface to `src/types.ts`: `id` (string), `keyHash` (string, SHA-256 hex digest), `userId` (string), `label` (string), `createdAt` (string), `lastUsedAt` (string | null).
2. Add store functions in `src/store.ts`: `createApiKey(userId, label, keyHash)`, `getApiKeyByHash(keyHash)`, `getApiKeysByUser(userId)`, `deleteApiKey(id)`.
3. Create `src/middleware/auth.ts` exporting an `authenticate` middleware that:
   - Reads the `Authorization` header, expecting `Bearer <raw-api-key>`
   - Computes the SHA-256 hex digest of the raw key using Node's `crypto` module
   - Looks up the key by hash in the store
   - Returns 401 `{ "error": "Unauthorized" }` if the key is missing or not found
   - Sets `req.userId` (string) on the request object for downstream handlers
   - Updates `lastUsedAt` on the matched API key
4. Add a `GET /health` route on the app that returns `{ "status": "ok", "timestamp": "<ISO 8601>" }` with no authentication required.
5. Apply the `authenticate` middleware to all routes except `GET /health`.
6. Create `src/routes/api-keys.ts` with:
   - `POST /api-keys` - accepts `{ userId, label }`, generates a random key (32 bytes hex via `crypto.randomBytes`), stores the SHA-256 hash, returns `{ id, key, label, createdAt }` (raw key shown only once)
   - `GET /api-keys` - returns the authenticated user's keys with `keyHash` omitted (list only `id`, `label`, `createdAt`, `lastUsedAt`)
   - `DELETE /api-keys/:id` - deletes the key if it belongs to the authenticated user, returns 404 otherwise
7. Extend the Express `Request` type with a `userId` property via declaration merging or a typed wrapper.
8. Tests:
   - Requests without an `Authorization` header return 401
   - Requests with an invalid key return 401
   - Requests with a valid key succeed and `req.userId` is set
   - `POST /api-keys` returns the raw key and subsequent requests with that key authenticate
   - Users can only list and delete their own keys

### 2. Role-Based Permissions

Add workspace-scoped roles controlling what members can do.

1. Change the `MemberRole` type in `src/types.ts` from `'owner' | 'member'` to `'owner' | 'admin' | 'member'`.
2. Create `src/middleware/permissions.ts` exporting a `requireRole(...roles: MemberRole[])` middleware factory that:
   - Requires `req.userId` to be set (depends on auth middleware running first)
   - Looks up the user's membership in the target workspace (workspace ID from `req.params.id` or `req.params.workspaceId`)
   - Returns 404 `{ "error": "Not found" }` if the user is not a member (do not reveal workspace existence)
   - Returns 403 `{ "error": "Forbidden" }` if the user's role is not in the allowed list
   - The `owner` role implicitly satisfies any role check (owners can do everything)
3. Apply permission rules to existing routes:
   - **Workspaces**: any member can read; `admin` or `owner` can update; only `owner` can delete
   - **Channels**: any member can list and read; `admin` or `owner` can create, update, and delete
   - **Messages**: any member can create and list; message authors can edit and delete their own; `admin` or `owner` can delete any message
   - **Members**: any member can list; `admin` or `owner` can add and remove members; only `owner` can change roles
4. Add `PATCH /workspaces/:id/members/:userId` endpoint to change a member's role. Only the workspace owner can call this. Cannot change the owner's own role.
5. Tests:
   - A `member` cannot delete a workspace (returns 403)
   - An `admin` can create a channel
   - A non-member gets 404 when accessing a workspace
   - Role changes via PATCH work for owners
   - A `member` cannot add other members (returns 403)

### 3. Event Bus

Add an in-memory event bus for domain event broadcasting.

1. Add a `DomainEvent` interface to `src/types.ts`: `id` (string, auto-generated), `type` (string), `timestamp` (string), `actorId` (string), `workspaceId` (string), `payload` (record with string keys and unknown values).
2. Create `src/events/event-bus.ts` exporting a singleton `EventBus` class with:
   - `emit(event: Omit<DomainEvent, 'id' | 'timestamp'>): DomainEvent` - assigns id + timestamp, stores event, notifies subscribers
   - `subscribe(pattern: string, handler: (event: DomainEvent) => void): () => void` - pattern uses glob matching on event type (e.g., `"workspace.*"` matches `"workspace.created"`), returns unsubscribe function
   - `getEvents(workspaceId: string): DomainEvent[]` - returns stored events for a workspace
   - `clear(): void` - for tests
3. Emit domain events from all mutating route handlers. Event types:
   - `workspace.created`, `workspace.updated`, `workspace.deleted`
   - `channel.created`, `channel.updated`, `channel.deleted`
   - `message.created`, `message.updated`, `message.deleted`
   - `member.added`, `member.removed`, `member.role_changed`
4. Add `GET /workspaces/:id/events` endpoint:
   - Returns the stored events for the workspace as a JSON array
   - Requires workspace membership
   - Supports `?type=` query filter (e.g., `?type=message.created`)
5. Tests:
   - Creating a workspace emits a `workspace.created` event
   - `subscribe("message.*", handler)` receives `message.created` events but not `workspace.created`
   - `getEvents(workspaceId)` returns only events for that workspace
   - The events endpoint returns events and respects the type filter

### 4. Audit Log

Add an audit log that records all mutations for compliance.

1. Add an `AuditEntry` interface to `src/types.ts`: `id` (string), `timestamp` (string), `actorId` (string), `action` (string, the event type), `resourceType` (string, e.g., `"workspace"`, `"channel"`, `"message"`), `resourceId` (string), `workspaceId` (string), `detail` (record with string keys and unknown values, snapshot of the change).
2. Create `src/audit/audit-log.ts` exporting a singleton `AuditLog` class that:
   - Subscribes to all domain events (`"*"`) via the event bus on initialization
   - Converts each `DomainEvent` to an `AuditEntry` and stores it in an in-memory array
   - `getEntries(workspaceId: string, options?: { action?: string; limit?: number; offset?: number }): AuditEntry[]` - returns filtered, paginated entries
   - `clear(): void` - for tests
3. Create `src/routes/audit.ts` with:
   - `GET /workspaces/:id/audit` - returns audit entries for the workspace
   - Requires `admin` or `owner` role (use the permissions middleware)
   - Supports query params: `?action=` (filter by action), `?limit=` (default 50), `?offset=` (default 0)
4. Tests:
   - Creating a workspace produces an audit entry with `action: "workspace.created"`
   - The audit endpoint returns entries for the workspace
   - Filtering by `?action=message.created` returns only message creation entries
   - A `member` role gets 403 on the audit endpoint

### 5. Message Search

Add full-text search across messages within a workspace.

1. Add a `SearchResult` interface to `src/types.ts`: `messageId` (string), `channelId` (string), `snippet` (string, first 100 characters of the message content), `score` (number).
2. Create `src/search/search-index.ts` exporting a singleton `SearchIndex` class that:
   - Subscribes to `message.created`, `message.updated`, `message.deleted` events via the event bus
   - Maintains an in-memory inverted index mapping lowercase terms to sets of message IDs
   - Tokenization: lowercase the content, split on non-alphanumeric characters (`/[^a-z0-9]+/`), filter out tokens shorter than 2 characters
   - `search(workspaceId: string, query: string): SearchResult[]` - tokenizes the query, finds messages containing all query terms (AND semantics), scores by number of matching terms, returns results sorted by score descending
   - Must filter results to only include messages in channels belonging to the given workspace
   - `clear(): void` - for tests
3. Create `src/routes/search.ts` with:
   - `GET /workspaces/:id/search?q=<query>` - searches messages in the workspace
   - Requires workspace membership
   - Returns `{ results: SearchResult[] }` with `?limit=` (default 20) and `?offset=` (default 0) pagination
   - Returns 400 if `q` parameter is missing or empty
4. Tests:
   - Indexing a message and searching for a word in it returns the message
   - Searching for a word not in any message returns empty results
   - Deleting a message removes it from the search index
   - Search respects workspace boundaries (messages in other workspaces are not returned)
   - Multi-term queries use AND semantics (all terms must match)

## Non-goals

- No WebSocket or SSE streaming (the events endpoint returns stored events as JSON)
- No external database (all in-memory storage)
- No user registration or login flow (API keys are self-provisioned with a declared userId)
- No file uploads or rich media
- No rate limiting
- No message threading or reactions

## Technical Constraints

- All new code must be TypeScript with strict mode enabled
- Follow existing project conventions: routes in `src/routes/`, middleware in `src/middleware/`
- All existing tests must continue to pass after changes
- New features must have test coverage
- Use Node's built-in `crypto` module for hashing (no new npm dependencies required)
