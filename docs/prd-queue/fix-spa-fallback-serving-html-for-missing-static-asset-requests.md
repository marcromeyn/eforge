---
title: Fix SPA fallback serving HTML for missing static asset requests
created: 2026-03-25
status: pending
---

# Fix SPA fallback serving HTML for missing static asset requests

## Problem / Motivation

The monitor web server's `serveStaticFile()` function uses an SPA fallback pattern: any request for a file that doesn't exist on disk gets `index.html` served instead. This is correct for client-side route paths (e.g., `/runs/abc123`), but wrong for hashed asset files under `/assets/`.

When a Vite-hashed asset is missing (e.g., after a rebuild wipes old hashes, or a stale browser tab), the server serves `index.html` with `Content-Type: text/html` instead of returning 404. Browsers reject this with: _"Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of text/html"_. This breaks shiki initialization and any other dynamically-imported code-split chunks.

## Goal

When a requested file is not found and the URL path starts with `/assets/`, return a **404** instead of falling back to `index.html`. The SPA fallback should only apply to paths that look like client-side routes.

## Approach

**File**: `src/monitor/server.ts` — `serveStaticFile()` function (lines 103–147)

Add a guard in the SPA fallback logic that checks whether the request path starts with `/assets/`. If it does, return a 404 with `Content-Type: text/plain` instead of serving `index.html`.

```ts
// In the catch block (file not found) and the !isFile() check:
// If the request is for a hashed asset, return 404 instead of SPA fallback
if (urlPath.startsWith('/assets/')) {
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
  return;
}
// Otherwise SPA fallback to index.html
filePath = join(UI_DIR, 'index.html');
```

Apply this in **both** places where the SPA fallback occurs:

1. **Line 118–121**: the `!fileStat.isFile()` check
2. **Line 122–125**: the file-not-found catch block

## Scope

**In scope:**
- Modifying `serveStaticFile()` in `src/monitor/server.ts` to return 404 for missing `/assets/` paths

**Out of scope:**
- N/A

## Acceptance Criteria

- [ ] `pnpm build` compiles cleanly
- [ ] `pnpm test` passes all existing tests
- [ ] Requests for missing files under `/assets/` return HTTP 404 with `Content-Type: text/plain` (not `index.html`)
- [ ] Requests for client-side route paths (e.g., `/runs/abc123`) continue to receive the SPA fallback (`index.html`)
- [ ] Manual verification: start monitor, open browser, verify assets load normally. Rebuild while page is open — stale asset requests should get 404 (visible in devtools Network tab) instead of HTML with wrong MIME type
