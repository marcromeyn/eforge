/**
 * OpenAI Codex SDK backend — implements AgentBackend using @openai/codex-sdk.
 * All Codex SDK imports are isolated to this file.
 */

import {
  Codex,
  type CodexOptions,
  type ThreadOptions,
  type ThreadEvent,
  type ThreadItem,
  type ModelReasoningEffort,
  type Usage,
} from '@openai/codex-sdk';
import type { EforgeEvent, AgentRole, AgentResultData } from '../events.js';
import type { AgentBackend, AgentRunOptions, ThinkingConfig, EffortLevel } from '../backend.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CodexBackendOptions {
  /** Override the path to the codex CLI binary. */
  codexPathOverride?: string;
  /** OpenAI API key. When omitted, the CLI reads from the environment. */
  apiKey?: string;
  /** OpenAI API base URL override. */
  baseUrl?: string;
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

/**
 * Map eforge ThinkingConfig to Codex ModelReasoningEffort.
 *
 * - disabled → 'low'
 * - adaptive → 'medium'
 * - enabled  → 'high'
 */
function mapThinkingConfig(thinking: ThinkingConfig): ModelReasoningEffort {
  switch (thinking.type) {
    case 'disabled': return 'low';
    case 'adaptive': return 'medium';
    case 'enabled': return 'high';
  }
}

/**
 * Map eforge EffortLevel to Codex ModelReasoningEffort.
 *
 * - low    → 'low'
 * - medium → 'medium'
 * - high   → 'high'
 * - max    → 'xhigh'
 */
function mapEffortLevel(effort: EffortLevel): ModelReasoningEffort {
  switch (effort) {
    case 'low': return 'low';
    case 'medium': return 'medium';
    case 'high': return 'high';
    case 'max': return 'xhigh';
  }
}

/**
 * Resolve Codex reasoning effort from eforge options.
 */
function resolveReasoningEffort(options: AgentRunOptions): ModelReasoningEffort | undefined {
  if (options.thinking) return mapThinkingConfig(options.thinking);
  if (options.effort) return mapEffortLevel(options.effort);
  return undefined;
}

/**
 * Translate a Codex ThreadEvent into EforgeEvent(s) and return them.
 */
function translateItemToToolEvents(
  item: ThreadItem,
  agentId: string,
  agent: AgentRole,
  planId: string | undefined,
): EforgeEvent[] {
  const ts = new Date().toISOString();
  const events: EforgeEvent[] = [];

  switch (item.type) {
    case 'command_execution': {
      events.push({
        timestamp: ts,
        type: 'agent:tool_use',
        planId,
        agentId,
        agent,
        tool: 'Bash',
        toolUseId: item.id,
        input: { command: item.command },
      });
      if (item.status !== 'in_progress') {
        events.push({
          timestamp: ts,
          type: 'agent:tool_result',
          planId,
          agentId,
          agent,
          tool: 'Bash',
          toolUseId: item.id,
          output: truncateOutput(item.aggregated_output, 4096),
        });
      }
      break;
    }

    case 'file_change': {
      const description = item.changes
        .map(c => `${c.kind}: ${c.path}`)
        .join(', ');
      events.push({
        timestamp: ts,
        type: 'agent:tool_use',
        planId,
        agentId,
        agent,
        tool: 'Edit',
        toolUseId: item.id,
        input: { changes: item.changes },
      });
      events.push({
        timestamp: ts,
        type: 'agent:tool_result',
        planId,
        agentId,
        agent,
        tool: 'Edit',
        toolUseId: item.id,
        output: `${item.status}: ${description}`,
      });
      break;
    }

    case 'mcp_tool_call': {
      events.push({
        timestamp: ts,
        type: 'agent:tool_use',
        planId,
        agentId,
        agent,
        tool: `mcp__${item.server}__${item.tool}`,
        toolUseId: item.id,
        input: item.arguments,
      });
      if (item.status !== 'in_progress') {
        const output = item.error
          ? `Error: ${item.error.message}`
          : JSON.stringify(item.result ?? '');
        events.push({
          timestamp: ts,
          type: 'agent:tool_result',
          planId,
          agentId,
          agent,
          tool: `mcp__${item.server}__${item.tool}`,
          toolUseId: item.id,
          output: truncateOutput(output, 4096),
        });
      }
      break;
    }

    case 'agent_message': {
      events.push({
        timestamp: ts,
        type: 'agent:message',
        planId,
        agentId,
        agent,
        content: item.text,
      });
      break;
    }

    case 'reasoning': {
      // Reasoning summaries are informational — emit as agent messages
      events.push({
        timestamp: ts,
        type: 'agent:message',
        planId,
        agentId,
        agent,
        content: item.text,
      });
      break;
    }

    // web_search, todo_list, error — not mapped to tool events
    default:
      break;
  }

  return events;
}

/**
 * Truncate tool output to prevent bloated traces.
 */
function truncateOutput(output: string, maxLength: number): string {
  if (output.length <= maxLength) return output;
  return output.slice(0, maxLength) + `... [truncated from ${output.length} chars]`;
}

// ---------------------------------------------------------------------------
// CodexBackend
// ---------------------------------------------------------------------------

export class CodexBackend implements AgentBackend {
  private readonly codexOptions: CodexOptions;

  constructor(options?: CodexBackendOptions) {
    this.codexOptions = {
      codexPathOverride: options?.codexPathOverride,
      apiKey: options?.apiKey,
      baseUrl: options?.baseUrl,
    };
  }

  async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
    const agentId = crypto.randomUUID();

    yield {
      type: 'agent:start',
      planId,
      agent,
      agentId,
      model: options.model?.id ?? 'codex',
      backend: 'codex',
      ...(options.fallbackFrom ? { fallbackFrom: options.fallbackFrom } : {}),
      timestamp: new Date().toISOString(),
    };

    let error: string | undefined;
    const startTime = Date.now();

    // Accumulate usage across turns
    let totalInput = 0;
    let totalCachedInput = 0;
    let totalOutput = 0;
    let numTurns = 0;
    let resultText = '';

    try {
      const codex = new Codex(this.codexOptions);

      const threadOptions: ThreadOptions = {
        workingDirectory: options.cwd,
        skipGitRepoCheck: true,
        sandboxMode: options.tools === 'coding' ? 'danger-full-access' : 'read-only',
        approvalPolicy: 'never',
        ...(options.model?.id ? { model: options.model.id } : {}),
      };

      const reasoningEffort = resolveReasoningEffort(options);
      if (reasoningEffort) {
        threadOptions.modelReasoningEffort = reasoningEffort;
      }

      const thread = codex.startThread(threadOptions);
      const { events } = await thread.runStreamed(options.prompt, {
        signal: options.abortSignal,
      });

      // Track turn count for maxTurns enforcement
      const abortController = options.abortSignal
        ? undefined // Caller owns the signal
        : new AbortController();

      for await (const event of events) {
        switch (event.type) {
          case 'thread.started':
            // Thread initialized — nothing to emit
            break;

          case 'turn.started':
            numTurns++;
            // Enforce maxTurns by aborting
            if (options.maxTurns && numTurns > options.maxTurns) {
              abortController?.abort();
              error = 'error_max_turns';
              break;
            }
            break;

          case 'turn.completed': {
            const usage: Usage = event.usage;
            totalInput += usage.input_tokens;
            totalCachedInput += usage.cached_input_tokens;
            totalOutput += usage.output_tokens;

            yield {
              timestamp: new Date().toISOString(),
              type: 'agent:usage',
              planId,
              agentId,
              agent,
              usage: {
                input: totalInput + totalCachedInput,
                output: totalOutput,
                total: totalInput + totalCachedInput + totalOutput,
                cacheRead: totalCachedInput,
                cacheCreation: 0,
              },
              costUsd: 0, // Codex SDK doesn't expose cost
              numTurns,
            };
            break;
          }

          case 'turn.failed': {
            error = event.error.message;
            break;
          }

          case 'item.started':
          case 'item.updated': {
            // Emit tool_use events for in-progress items
            const itemEvents = translateItemToToolEvents(event.item, agentId, agent, planId);
            for (const e of itemEvents) {
              yield e;
            }
            break;
          }

          case 'item.completed': {
            const item = event.item;

            // Emit tool events for completed items
            const itemEvents = translateItemToToolEvents(item, agentId, agent, planId);
            for (const e of itemEvents) {
              yield e;
            }

            // Capture final agent message as result text
            if (item.type === 'agent_message') {
              resultText = item.text;
            }
            break;
          }

          case 'error': {
            error = event.message;
            break;
          }
        }

        if (error) break;
      }

      // Emit agent:result
      const durationMs = Date.now() - startTime;
      const resultData: AgentResultData = {
        durationMs,
        durationApiMs: durationMs, // Codex doesn't separate API time
        numTurns,
        totalCostUsd: 0, // Codex SDK doesn't expose cost
        usage: {
          input: totalInput + totalCachedInput,
          output: totalOutput,
          total: totalInput + totalCachedInput + totalOutput,
          cacheRead: totalCachedInput,
          cacheCreation: 0,
        },
        modelUsage: {
          [options.model?.id ?? 'codex']: {
            inputTokens: totalInput + totalCachedInput,
            outputTokens: totalOutput,
            cacheReadInputTokens: totalCachedInput,
            cacheCreationInputTokens: 0,
            costUSD: 0,
          },
        },
        resultText: resultText || undefined,
      };

      yield { timestamp: new Date().toISOString(), type: 'agent:result', planId, agent, result: resultData };

      if (error) {
        throw new Error(error);
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      yield { type: 'agent:stop', planId, agent, agentId, error, timestamp: new Date().toISOString() };
    }
  }
}
