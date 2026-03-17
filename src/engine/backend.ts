import type { EforgeEvent, AgentRole } from './events.js';

export type ToolPreset = 'coding' | 'none';

export interface AgentRunOptions {
  prompt: string;
  cwd: string;
  maxTurns: number;
  tools: ToolPreset;
  model?: string;
  abortSignal?: AbortSignal;
}

/**
 * Backend abstraction for running AI agents.
 * Agent runners consume this interface — they never import the AI SDK directly.
 */
export interface AgentBackend {
  /** Run an agent with the given prompt and yield EforgeEvents. */
  run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent>;
}
