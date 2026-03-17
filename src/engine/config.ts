import { readFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { availableParallelism, homedir } from 'node:os';
import { parse as parseYaml } from 'yaml';

import type { AgentRole } from './events.js';

export type ToolPresetConfig = 'coding' | 'none';

export interface AgentProfileConfig {
  maxTurns?: number;
  prompt?: string;
  tools?: ToolPresetConfig;
  model?: string;
}

export interface ReviewProfileConfig {
  strategy: 'auto' | 'single' | 'parallel';
  perspectives: string[];
  maxRounds: number;
  autoAcceptBelow?: 'suggestion' | 'warning';
  evaluatorStrictness: 'strict' | 'standard' | 'lenient';
}

/** Pre-resolution profile (from YAML parsing). */
export interface PartialProfileConfig {
  description?: string;
  extends?: string;
  compile?: string[];
  build?: string[];
  agents?: Partial<Record<AgentRole, AgentProfileConfig>>;
  review?: Partial<ReviewProfileConfig>;
}

/** After extension resolution - all required fields present. */
export interface ResolvedProfileConfig {
  description: string;
  compile: string[];
  build: string[];
  agents: Partial<Record<AgentRole, AgentProfileConfig>>;
  review: ReviewProfileConfig;
}

/** Alias kept for barrel re-export convenience. */
export type ProfileConfig = ResolvedProfileConfig;

export interface HookConfig {
  event: string;   // glob pattern on EforgeEvent.type (e.g. "build:*", "*")
  command: string; // shell command or script path
  timeout: number; // ms, default 5000
}

export interface PluginConfig {
  enabled: boolean;
  /** Plugin identifiers to include (e.g. "git@schaake-cc-marketplace"). If set, only these load. */
  include?: string[];
  /** Plugin identifiers to exclude from auto-discovery. */
  exclude?: string[];
  /** Additional local plugin directory paths (always appended). */
  paths?: string[];
}

export interface EforgeConfig {
  langfuse: { enabled: boolean; publicKey?: string; secretKey?: string; host: string };
  agents: { maxTurns: number; permissionMode: 'bypass' | 'default'; settingSources?: string[] };
  build: { parallelism: number; worktreeDir?: string; postMergeCommands?: string[]; maxValidationRetries: number; cleanupPlanFiles: boolean };
  plan: { outputDir: string };
  plugins: PluginConfig;
  hooks: readonly HookConfig[];
  profiles: Record<string, ResolvedProfileConfig>;
}

/** Deep-partial version of EforgeConfig used for parsing and merging. */
export type PartialEforgeConfig = {
  [K in keyof EforgeConfig]?: K extends 'hooks'
    ? HookConfig[]
    : K extends 'profiles'
      ? Record<string, PartialProfileConfig>
      : EforgeConfig[K] extends object
        ? Partial<EforgeConfig[K]>
        : EforgeConfig[K];
};

const DEFAULT_REVIEW: ReviewProfileConfig = Object.freeze({
  strategy: 'auto' as const,
  perspectives: Object.freeze(['code']) as unknown as string[],
  maxRounds: 1,
  evaluatorStrictness: 'standard' as const,
});

const DEFAULT_BUILD_STAGES = Object.freeze([
  'implement', 'review', 'review-fix', 'evaluate',
]) as unknown as string[];

export const BUILTIN_PROFILES: Record<string, ResolvedProfileConfig> = Object.freeze({
  errand: Object.freeze({
    description: 'Small, self-contained changes. Single file or a few lines. Low risk, no architectural impact.',
    compile: Object.freeze(['planner', 'plan-review-cycle']) as unknown as string[],
    build: DEFAULT_BUILD_STAGES,
    agents: Object.freeze({}),
    review: DEFAULT_REVIEW,
  }),
  excursion: Object.freeze({
    description: 'Multi-file feature work or refactors that need planning and review but fit in a single plan. Use for medium-complexity tasks with cross-file changes.',
    compile: Object.freeze(['planner', 'plan-review-cycle']) as unknown as string[],
    build: DEFAULT_BUILD_STAGES,
    agents: Object.freeze({}),
    review: DEFAULT_REVIEW,
  }),
  expedition: Object.freeze({
    description: 'Large cross-cutting work spanning multiple modules. Needs architecture planning, module decomposition, and parallel execution.',
    compile: Object.freeze(['planner', 'module-planning', 'cohesion-review-cycle', 'compile-expedition']) as unknown as string[],
    build: DEFAULT_BUILD_STAGES,
    agents: Object.freeze({}),
    review: DEFAULT_REVIEW,
  }),
});

export const DEFAULT_CONFIG: EforgeConfig = Object.freeze({
  langfuse: Object.freeze({ enabled: false, host: 'https://cloud.langfuse.com' }),
  agents: Object.freeze({ maxTurns: 30, permissionMode: 'bypass' as const, settingSources: ['project'] as string[] }),
  build: Object.freeze({ parallelism: availableParallelism(), worktreeDir: undefined, postMergeCommands: undefined, maxValidationRetries: 2, cleanupPlanFiles: true }),
  plan: Object.freeze({ outputDir: 'plans' }),
  plugins: Object.freeze({ enabled: true }),
  hooks: Object.freeze([]),
  profiles: BUILTIN_PROFILES,
});

/**
 * Walk up the directory tree looking for eforge.yaml.
 * Returns the absolute path if found, null otherwise.
 */
export async function findConfigFile(startDir: string): Promise<string | null> {
  let dir = resolve(startDir);

  while (true) {
    const candidate = resolve(dir, 'eforge.yaml');
    try {
      await access(candidate);
      return candidate;
    } catch {
      // not found, move up
    }

    const parent = dirname(dir);
    if (parent === dir) {
      return null; // reached filesystem root
    }
    dir = parent;
  }
}

/**
 * Merge file-based config with env vars. Env vars take precedence.
 * Sets langfuse.enabled = true only when both keys are present.
 */
export function resolveConfig(
  fileConfig: PartialEforgeConfig,
  env: Record<string, string | undefined> = process.env,
): EforgeConfig {
  const langfusePublicKey = env.LANGFUSE_PUBLIC_KEY ?? fileConfig.langfuse?.publicKey;
  const langfuseSecretKey = env.LANGFUSE_SECRET_KEY ?? fileConfig.langfuse?.secretKey;
  const langfuseHost = env.LANGFUSE_BASE_URL ?? fileConfig.langfuse?.host ?? DEFAULT_CONFIG.langfuse.host;
  const langfuseEnabled = !!(langfusePublicKey && langfuseSecretKey);

  return Object.freeze({
    langfuse: Object.freeze({
      enabled: langfuseEnabled,
      publicKey: langfusePublicKey,
      secretKey: langfuseSecretKey,
      host: langfuseHost,
    }),
    agents: Object.freeze({
      maxTurns: fileConfig.agents?.maxTurns ?? DEFAULT_CONFIG.agents.maxTurns,
      permissionMode: fileConfig.agents?.permissionMode ?? DEFAULT_CONFIG.agents.permissionMode,
      settingSources: fileConfig.agents?.settingSources ?? DEFAULT_CONFIG.agents.settingSources,
    }),
    build: Object.freeze({
      parallelism: fileConfig.build?.parallelism ?? DEFAULT_CONFIG.build.parallelism,
      worktreeDir: fileConfig.build?.worktreeDir ?? DEFAULT_CONFIG.build.worktreeDir,
      postMergeCommands: fileConfig.build?.postMergeCommands ?? DEFAULT_CONFIG.build.postMergeCommands,
      maxValidationRetries: fileConfig.build?.maxValidationRetries ?? DEFAULT_CONFIG.build.maxValidationRetries,
      cleanupPlanFiles: fileConfig.build?.cleanupPlanFiles ?? DEFAULT_CONFIG.build.cleanupPlanFiles,
    }),
    plan: Object.freeze({
      outputDir: fileConfig.plan?.outputDir ?? DEFAULT_CONFIG.plan.outputDir,
    }),
    plugins: Object.freeze({
      enabled: fileConfig.plugins?.enabled ?? DEFAULT_CONFIG.plugins.enabled,
      include: fileConfig.plugins?.include,
      exclude: fileConfig.plugins?.exclude,
      paths: fileConfig.plugins?.paths,
    }),
    hooks: Object.freeze(fileConfig.hooks ?? DEFAULT_CONFIG.hooks) as HookConfig[],
    profiles: Object.freeze(
      resolveProfileExtensions(fileConfig.profiles ?? {}, BUILTIN_PROFILES),
    ),
  });
}

/**
 * Parse and validate a raw YAML object into a partial EforgeConfig.
 * Returns only the fields that are present and valid — no premature defaults.
 */
function parseRawConfig(data: Record<string, unknown>): PartialEforgeConfig {
  const result: PartialEforgeConfig = {};

  if (data.langfuse && typeof data.langfuse === 'object') {
    const lf = data.langfuse as Record<string, unknown>;
    result.langfuse = {
      ...(typeof lf.publicKey === 'string' ? { publicKey: lf.publicKey } : {}),
      ...(typeof lf.secretKey === 'string' ? { secretKey: lf.secretKey } : {}),
      ...(typeof lf.host === 'string' ? { host: lf.host } : {}),
    };
  }

  if (data.agents && typeof data.agents === 'object') {
    const ag = data.agents as Record<string, unknown>;
    const VALID_SETTING_SOURCES = ['user', 'project', 'local'];
    const settingSources =
      Array.isArray(ag.settingSources)
        ? ag.settingSources.filter((s: unknown) => typeof s === 'string' && VALID_SETTING_SOURCES.includes(s)) as string[]
        : undefined;
    // Empty array after filtering means all entries were invalid — treat as absent so defaults apply
    const hasSettingSources = settingSources && settingSources.length > 0;
    result.agents = {
      ...(typeof ag.maxTurns === 'number' && ag.maxTurns > 0 ? { maxTurns: ag.maxTurns } : {}),
      ...(ag.permissionMode === 'bypass' || ag.permissionMode === 'default'
        ? { permissionMode: ag.permissionMode }
        : {}),
      ...(hasSettingSources ? { settingSources } : {}),
    };
  }

  if (data.build && typeof data.build === 'object') {
    const bd = data.build as Record<string, unknown>;
    const postMergeCommands =
      Array.isArray(bd.postMergeCommands) && bd.postMergeCommands.every((c: unknown) => typeof c === 'string')
        ? (bd.postMergeCommands as string[])
        : undefined;
    result.build = {
      ...(typeof bd.parallelism === 'number' && bd.parallelism > 0
        ? { parallelism: bd.parallelism }
        : {}),
      ...(typeof bd.worktreeDir === 'string' ? { worktreeDir: bd.worktreeDir } : {}),
      ...(postMergeCommands ? { postMergeCommands } : {}),
      ...(typeof bd.maxValidationRetries === 'number' && bd.maxValidationRetries >= 0
        ? { maxValidationRetries: bd.maxValidationRetries }
        : {}),
      ...(typeof bd.cleanupPlanFiles === 'boolean' ? { cleanupPlanFiles: bd.cleanupPlanFiles } : {}),
    };
  }

  if (data.plan && typeof data.plan === 'object') {
    const pl = data.plan as Record<string, unknown>;
    result.plan = {
      ...(typeof pl.outputDir === 'string' ? { outputDir: pl.outputDir } : {}),
    };
  }

  if (data.plugins && typeof data.plugins === 'object' && !Array.isArray(data.plugins)) {
    const pg = data.plugins as Record<string, unknown>;
    const include =
      Array.isArray(pg.include) && pg.include.every((s: unknown) => typeof s === 'string')
        ? (pg.include as string[])
        : undefined;
    const exclude =
      Array.isArray(pg.exclude) && pg.exclude.every((s: unknown) => typeof s === 'string')
        ? (pg.exclude as string[])
        : undefined;
    const paths =
      Array.isArray(pg.paths) && pg.paths.every((s: unknown) => typeof s === 'string')
        ? (pg.paths as string[])
        : undefined;
    result.plugins = {
      ...(typeof pg.enabled === 'boolean' ? { enabled: pg.enabled } : {}),
      ...(include ? { include } : {}),
      ...(exclude ? { exclude } : {}),
      ...(paths ? { paths } : {}),
    };
  }

  if (Array.isArray(data.hooks)) {
    const validHooks: HookConfig[] = [];
    for (const entry of data.hooks) {
      if (
        entry &&
        typeof entry === 'object' &&
        typeof (entry as Record<string, unknown>).event === 'string' &&
        typeof (entry as Record<string, unknown>).command === 'string'
      ) {
        const e = entry as Record<string, unknown>;
        const timeout = typeof e.timeout === 'number' && e.timeout > 0 ? e.timeout : 5000;
        validHooks.push({ event: e.event as string, command: e.command as string, timeout });
      }
    }
    result.hooks = validHooks;
  }

  if (data.profiles && typeof data.profiles === 'object' && !Array.isArray(data.profiles)) {
    const profiles: Record<string, PartialProfileConfig> = {};
    const VALID_STRATEGIES = ['auto', 'single', 'parallel'];
    const VALID_TOOLS: string[] = ['coding', 'none'];
    const VALID_STRICTNESS = ['strict', 'standard', 'lenient'];
    const VALID_AUTO_ACCEPT = ['suggestion', 'warning'];
    const VALID_AGENT_ROLES = new Set([
      'planner', 'builder', 'reviewer', 'evaluator', 'module-planner',
      'plan-reviewer', 'plan-evaluator', 'cohesion-reviewer', 'cohesion-evaluator',
      'validation-fixer', 'assessor', 'review-fixer',
    ]);

    for (const [name, value] of Object.entries(data.profiles as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const raw = value as Record<string, unknown>;
      const partial: PartialProfileConfig = {};

      if (typeof raw.description === 'string') partial.description = raw.description;
      if (typeof raw.extends === 'string') partial.extends = raw.extends;
      if (Array.isArray(raw.compile) && raw.compile.every((s: unknown) => typeof s === 'string')) {
        partial.compile = raw.compile as string[];
      }
      if (Array.isArray(raw.build) && raw.build.every((s: unknown) => typeof s === 'string')) {
        partial.build = raw.build as string[];
      }

      // Parse agents
      if (raw.agents && typeof raw.agents === 'object' && !Array.isArray(raw.agents)) {
        const agents: Partial<Record<AgentRole, AgentProfileConfig>> = {};
        for (const [role, agentRaw] of Object.entries(raw.agents as Record<string, unknown>)) {
          if (!VALID_AGENT_ROLES.has(role)) continue;
          if (!agentRaw || typeof agentRaw !== 'object') continue;
          const ar = agentRaw as Record<string, unknown>;
          const agentConfig: AgentProfileConfig = {};
          if (typeof ar.maxTurns === 'number' && ar.maxTurns > 0) agentConfig.maxTurns = ar.maxTurns;
          if (typeof ar.prompt === 'string') agentConfig.prompt = ar.prompt;
          if (typeof ar.tools === 'string' && VALID_TOOLS.includes(ar.tools)) agentConfig.tools = ar.tools as ToolPresetConfig;
          if (typeof ar.model === 'string') agentConfig.model = ar.model;
          if (Object.keys(agentConfig).length > 0) {
            agents[role as AgentRole] = agentConfig;
          }
        }
        if (Object.keys(agents).length > 0) partial.agents = agents;
      }

      // Parse review
      if (raw.review && typeof raw.review === 'object' && !Array.isArray(raw.review)) {
        const rv = raw.review as Record<string, unknown>;
        const review: Partial<ReviewProfileConfig> = {};
        if (typeof rv.strategy === 'string' && VALID_STRATEGIES.includes(rv.strategy)) {
          review.strategy = rv.strategy as ReviewProfileConfig['strategy'];
        }
        if (Array.isArray(rv.perspectives) && rv.perspectives.every((s: unknown) => typeof s === 'string')) {
          review.perspectives = rv.perspectives as string[];
        }
        if (typeof rv.maxRounds === 'number' && rv.maxRounds > 0) review.maxRounds = rv.maxRounds;
        if (typeof rv.autoAcceptBelow === 'string' && VALID_AUTO_ACCEPT.includes(rv.autoAcceptBelow)) {
          review.autoAcceptBelow = rv.autoAcceptBelow as ReviewProfileConfig['autoAcceptBelow'];
        }
        if (typeof rv.evaluatorStrictness === 'string' && VALID_STRICTNESS.includes(rv.evaluatorStrictness)) {
          review.evaluatorStrictness = rv.evaluatorStrictness as ReviewProfileConfig['evaluatorStrictness'];
        }
        if (Object.keys(review).length > 0) partial.review = review;
      }

      profiles[name] = partial;
    }
    result.profiles = profiles;
  }

  return result;
}

/**
 * Return the path to the user-level (global) config file.
 * Respects $XDG_CONFIG_HOME when set, else falls back to ~/.config.
 */
export function getUserConfigPath(
  env: Record<string, string | undefined> = process.env,
): string {
  const base = env.XDG_CONFIG_HOME || resolve(homedir(), '.config');
  return resolve(base, 'eforge', 'config.yaml');
}

/**
 * Merge two partial configs (global + project) into one.
 * - Scalar fields: project wins over global
 * - Object sections: shallow merge per-field, project overrides global
 * - `hooks`: concatenate (global first, then project)
 * - Other arrays (postMergeCommands, plugins.include/exclude/paths, settingSources): project replaces
 */
export function mergePartialConfigs(
  global: PartialEforgeConfig,
  project: PartialEforgeConfig,
): PartialEforgeConfig {
  const result: PartialEforgeConfig = {};

  // Object sections: shallow merge
  if (global.langfuse || project.langfuse) {
    result.langfuse = { ...global.langfuse, ...project.langfuse };
  }
  if (global.agents || project.agents) {
    result.agents = { ...global.agents, ...project.agents };
  }
  if (global.build || project.build) {
    result.build = { ...global.build, ...project.build };
  }
  if (global.plan || project.plan) {
    result.plan = { ...global.plan, ...project.plan };
  }
  if (global.plugins || project.plugins) {
    result.plugins = { ...global.plugins, ...project.plugins };
  }

  // hooks: concatenate (global first, then project)
  if (global.hooks || project.hooks) {
    result.hooks = [...(global.hooks ?? []), ...(project.hooks ?? [])];
  }

  // profiles: merge by name
  if (global.profiles || project.profiles) {
    const merged: Record<string, PartialProfileConfig> = {};
    const allNames = new Set([
      ...Object.keys(global.profiles ?? {}),
      ...Object.keys(project.profiles ?? {}),
    ]);
    for (const name of allNames) {
      const g = global.profiles?.[name];
      const p = project.profiles?.[name];
      if (g && p) {
        // Shallow merge per profile, with agents merged per-agent
        const mergedAgents: Partial<Record<AgentRole, AgentProfileConfig>> = {
          ...g.agents,
        };
        if (p.agents) {
          for (const [role, config] of Object.entries(p.agents)) {
            const base = mergedAgents[role as AgentRole];
            mergedAgents[role as AgentRole] = base ? { ...base, ...config } : config;
          }
        }
        merged[name] = {
          ...g,
          ...p,
          agents: Object.keys(mergedAgents).length > 0 ? mergedAgents : undefined,
          review: g.review || p.review ? { ...g.review, ...p.review } : undefined,
        };
      } else {
        merged[name] = (p ?? g)!;
      }
    }
    result.profiles = merged;
  }

  return result;
}

/**
 * Load the user-level (global) config file.
 * Returns an empty partial on any failure (missing file, bad YAML, etc.).
 */
async function loadUserConfig(
  env: Record<string, string | undefined> = process.env,
): Promise<PartialEforgeConfig> {
  const configPath = getUserConfigPath(env);
  try {
    const raw = await readFile(configPath, 'utf-8');
    const data = parseYaml(raw);
    if (!data || typeof data !== 'object') {
      return {};
    }
    return parseRawConfig(data as Record<string, unknown>);
  } catch {
    return {};
  }
}

/**
 * Load eforge.yaml config from the given directory (searching upward),
 * merged with user-level global config (~/.config/eforge/config.yaml).
 * Returns DEFAULT_CONFIG when no config files exist.
 */
export async function loadConfig(cwd?: string): Promise<EforgeConfig> {
  const globalConfig = await loadUserConfig();

  const startDir = cwd ?? process.cwd();
  const configPath = await findConfigFile(startDir);

  let projectConfig: PartialEforgeConfig = {};
  if (configPath) {
    try {
      const raw = await readFile(configPath, 'utf-8');
      const data = parseYaml(raw);
      if (data && typeof data === 'object') {
        projectConfig = parseRawConfig(data as Record<string, unknown>);
      }
    } catch {
      // malformed YAML — treat as empty
    }
  }

  const merged = mergePartialConfigs(globalConfig, projectConfig);
  return resolveConfig(merged);
}

/**
 * Resolve profile extensions by walking `extends` chains, detecting cycles,
 * and shallow-merging inherited fields. Returns fully-resolved profiles
 * with all required fields present.
 */
export function resolveProfileExtensions(
  partials: Record<string, PartialProfileConfig>,
  builtins: Record<string, ResolvedProfileConfig> = BUILTIN_PROFILES,
): Record<string, ResolvedProfileConfig> {
  const resolved = new Map<string, ResolvedProfileConfig>();
  const resolving = new Set<string>(); // cycle detection

  function resolve(name: string): ResolvedProfileConfig {
    const cached = resolved.get(name);
    if (cached) return cached;

    // If it's a built-in with no user override, return as-is
    const partial = partials[name];
    if (!partial) {
      const builtin = builtins[name];
      if (builtin) return builtin;
      throw new Error(`Profile "${name}" not found`);
    }

    if (resolving.has(name)) {
      throw new Error(`Circular profile extension detected: ${name}`);
    }
    resolving.add(name);

    // Get base - either the extends target or the built-in of the same name or excursion fallback
    let base: ResolvedProfileConfig;
    if (partial.extends) {
      base = resolve(partial.extends);
    } else if (builtins[name]) {
      base = builtins[name];
    } else {
      base = builtins['excursion']; // fallback for custom profiles with no extends
    }

    // Shallow merge per-agent
    const mergedAgents: Partial<Record<AgentRole, AgentProfileConfig>> = { ...base.agents };
    if (partial.agents) {
      for (const [role, agentConfig] of Object.entries(partial.agents)) {
        const baseAgent = mergedAgents[role as AgentRole];
        mergedAgents[role as AgentRole] = baseAgent
          ? { ...baseAgent, ...agentConfig }
          : agentConfig;
      }
    }

    // Shallow merge review
    const mergedReview: ReviewProfileConfig = {
      ...base.review,
      ...(partial.review ?? {}),
    } as ReviewProfileConfig;

    const result: ResolvedProfileConfig = {
      description: partial.description ?? base.description,
      compile: partial.compile ?? base.compile,
      build: partial.build ?? base.build,
      agents: mergedAgents,
      review: mergedReview,
    };

    resolving.delete(name);
    resolved.set(name, result);
    return result;
  }

  // Resolve all profiles (builtins + user-defined)
  const allNames = new Set([...Object.keys(builtins), ...Object.keys(partials)]);
  const out: Record<string, ResolvedProfileConfig> = {};
  for (const name of allNames) {
    out[name] = resolve(name);
  }
  return out;
}

/**
 * Parse a standalone profiles YAML file into partial profile configs.
 * The file is expected to have a `profiles` top-level key matching the
 * same structure as in eforge.yaml.
 */
export async function parseProfilesFile(
  filePath: string,
): Promise<Record<string, PartialProfileConfig>> {
  const raw = await readFile(filePath, 'utf-8');
  const data = parseYaml(raw);
  if (!data || typeof data !== 'object') return {};
  const parsed = parseRawConfig(data as Record<string, unknown>);
  return parsed.profiles ?? {};
}
