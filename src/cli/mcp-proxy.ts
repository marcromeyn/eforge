/**
 * MCP stdio proxy server.
 *
 * Bridges MCP tool calls from Claude Code to the eforge daemon's HTTP API.
 * Auto-starts the daemon if not running. Called via `eforge mcp-proxy`.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ensureDaemon, daemonRequest } from './daemon-client.js';

const ALLOWED_FLAGS = new Set([
  '--queue',
  '--watch',
  '--auto',
  '--verbose',
  '--dry-run',
  '--no-monitor',
  '--no-plugins',
  '--no-generate-profile',
  '--poll-interval',
  '--profiles',
]);

function sanitizeFlags(flags?: string[]): string[] | undefined {
  if (!flags) return undefined;
  const result: string[] = [];
  let skipNext = false;
  for (const flag of flags) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (ALLOWED_FLAGS.has(flag)) {
      result.push(flag);
    } else if (!flag.startsWith('-')) {
      result.push(flag);
    } else {
      skipNext = true;
    }
  }
  return result;
}

// Re-export for any consumers that imported from here
export { ensureDaemon, daemonRequest };

export async function runMcpProxy(cwd: string): Promise<void> {
  const server = new McpServer({
    name: 'eforge',
    version: '0.4.0',
  });

  // Tool: eforge_run
  server.tool(
    'eforge_run',
    'Launch an eforge run (enqueue + compile + build + validate) from a PRD source, or process the queue with --queue flag. Returns a sessionId to track progress.',
    {
      source: z
        .string()
        .optional()
        .describe('PRD file path or inline description. Omit when using --queue flag.'),
      flags: z
        .array(z.string())
        .optional()
        .describe('Optional CLI flags (e.g. ["--queue", "--watch"])'),
    },
    async ({ source, flags }) => {
      const sanitized = sanitizeFlags(flags);
      const isQueueMode = sanitized?.includes('--queue');
      if (isQueueMode) {
        const queueFlags = sanitized!.filter((f) => f !== '--queue');
        const result = await daemonRequest(cwd, 'POST', '/api/queue/run', {
          flags: queueFlags.length > 0 ? queueFlags : undefined,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      if (!source) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'source is required unless --queue flag is provided' }, null, 2) }],
          isError: true,
        };
      }
      const result = await daemonRequest(cwd, 'POST', '/api/run', { source, flags: sanitized });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  // Tool: eforge_enqueue
  server.tool(
    'eforge_enqueue',
    'Normalize input and add it to the eforge PRD queue.',
    {
      source: z.string().describe('PRD file path, inline prompt, or rough notes to enqueue'),
      flags: z.array(z.string()).optional().describe('Optional CLI flags'),
    },
    async ({ source, flags }) => {
      const result = await daemonRequest(cwd, 'POST', '/api/enqueue', { source, flags: sanitizeFlags(flags) });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  // Tool: eforge_status
  server.tool(
    'eforge_status',
    'Get the current run status including plan progress, session state, and event summary.',
    {},
    async () => {
      const latestRun = await daemonRequest(cwd, 'GET', '/api/latest-run') as { sessionId?: string };
      if (!latestRun?.sessionId) {
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'idle', message: 'No active eforge sessions.' }) }] };
      }
      const summary = await daemonRequest(cwd, 'GET', `/api/run-summary/${encodeURIComponent(latestRun.sessionId)}`);
      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
    },
  );

  // Tool: eforge_queue_list
  server.tool(
    'eforge_queue_list',
    'List all PRDs currently in the eforge queue with their metadata.',
    {},
    async () => {
      const result = await daemonRequest(cwd, 'GET', '/api/queue');
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  // Tool: eforge_config
  server.tool(
    'eforge_config',
    'Show resolved eforge configuration or validate eforge.yaml.',
    {
      action: z.enum(['show', 'validate']).describe("'show' returns resolved config, 'validate' checks for errors"),
    },
    async ({ action }) => {
      const path = action === 'validate' ? '/api/config/validate' : '/api/config/show';
      const result = await daemonRequest(cwd, 'GET', path);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
