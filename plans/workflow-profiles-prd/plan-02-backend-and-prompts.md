---
id: plan-02-backend-and-prompts
name: Backend model override support, prompt path resolution for custom prompts,
  and planner prompt update for profile selection
depends_on:
  - plan-01-config-and-types
branch: workflow-profiles-prd/backend-and-prompts
---

# Backend and Prompts

## Architecture Reference

This module implements [Engine → Agents integration contract] from the architecture: agent call sites read `profile.agents[role]` for maxTurns, prompt, tools, and model overrides. It also implements the custom prompt path support described in the architecture's `loadPrompt()` specification, and the `plan:profile` event emission from the planner agent.

Key constraints from architecture:
- `AgentRunOptions` gains an optional `model` field; `ClaudeSDKBackend` passes it to the SDK
- `loadPrompt()` supports path-based prompt resolution when the value contains `/`
- Profile selection is a pre-pipeline step using the planner agent with fixed default config
- `plan:profile` is the new canonical event; `plan:scope` continues to be emitted during transition
- SDK imports restricted to `src/engine/backends/` - agent runners use the `AgentBackend` interface

## Scope

### In Scope
- `ClaudeSDKBackend.run()` passes `options.model` to the SDK's `query()` call
- Planner prompt (`src/engine/prompts/planner.md`) updated with a profile selection section - the planner receives available profile descriptions and outputs a `<profile>` XML block instead of (in addition to) the `<scope>` block
- `runPlanner()` updated to parse `<profile>` blocks from agent output and emit `plan:profile` events alongside `plan:scope`
- `runAssessor()` updated to parse `<profile>` blocks and emit `plan:profile` events (for adopt flow)

### Out of Scope
- Profile type definitions and config parsing (config-and-types module - already complete)
- Pipeline stage registry and execution engine
- CLI `--profiles` flag wiring
- Monitor UI updates for `plan:profile`
- CLI display rendering of profile selection
- Build-phase review cycle parameterization

## Implementation Approach

### Overview

Three independent changes that build on the config-and-types foundation: (1) backend model passthrough, (2) planner/assessor profile selection. Each is independently testable. The planner prompt change is the most involved - it adds a new `{{profiles}}` template variable containing formatted profile descriptions, and a new output section for `<profile>` blocks. Note: `loadPrompt()` path-based prompt resolution is already implemented by the config-and-types module — this module consumes that capability when building agent options with custom prompt paths.

### Key Decisions

1. **Model passthrough is a one-line SDK option** - The SDK's `query()` options already accept `model?: string` (confirmed in `sdk.d.ts` line 1003). `ClaudeSDKBackend` just spreads it into the options object. No validation needed - the SDK handles invalid model strings.

2. **Planner emits both `plan:profile` and `plan:scope` during transition** - When the planner outputs a `<profile>` block, the engine emits `plan:profile`. It also derives and emits `plan:scope` when the profile name matches a built-in (`errand`, `excursion`, `expedition`, `complete`). For custom profile names, `plan:scope` is omitted (consumers handle its absence gracefully since `plan:scope` is already optional in event streams - the assessor defaults to `errand` when missing).

3. **Profile descriptions are injected via template variable** - The planner prompt receives a `{{profiles}}` variable containing a formatted markdown list of available profiles with their descriptions. The engine builds this string from `config.profiles` before calling `loadPrompt()`. This keeps the prompt file clean and the profile list dynamic.

4. **`parseProfileBlock` is already defined in config-and-types** - The XML parser for `<profile>` blocks was placed in `src/engine/agents/common.ts` by the config-and-types module. This module just calls it from `runPlanner()` and `runAssessor()`.

5. **Scope assessment XML stays in the prompt** - The `<scope>` block section stays in the planner prompt for backwards compatibility. The `<profile>` block is added as the preferred output. The planner is instructed to emit both when the profile matches a built-in name.

## Files

### Modify

- `src/engine/backends/claude-sdk.ts` - Add `model` passthrough in the `run()` method. In the `sdkQuery()` options object, add `model: options.model` (only when defined). This is a ~2-line change.

- `src/engine/prompts/planner.md` - Add a "Profile Selection" section between Phase 2 (Codebase Exploration) and Phase 3 (Scope Assessment). The section includes the `{{profiles}}` template variable (rendered as a markdown table of profile names and descriptions) and instructions for the planner to output a `<profile name="...">rationale</profile>` XML block. The existing `<scope>` block section remains but is updated to note that the planner must emit both when the profile name matches a scope level.

- `src/engine/agents/planner.ts` - Update `runPlanner()`: (1) import `parseProfileBlock` from `common.js`, (2) accept profile descriptions from options (add `profiles` field to `PlannerOptions`), (3) build the `{{profiles}}` template variable from the profiles record, (4) parse `<profile>` blocks from agent output alongside `<scope>` blocks, (5) emit `plan:profile` events when a profile block is found. The `plan:scope` event continues to be emitted from `<scope>` blocks as today. When a `<profile>` block is found but no `<scope>` block, derive scope from profile name if it matches a built-in.

- `src/engine/agents/assessor.ts` - Update `runAssessor()`: (1) import `parseProfileBlock` from `common.js`, (2) add optional `profiles` field to `AssessorOptions`, (3) parse `<profile>` blocks from accumulated text, (4) emit `plan:profile` event when found (alongside the existing `plan:scope` emission).

- `src/engine/prompts/assessor.md` - Add profile selection instructions matching the planner prompt's profile section (if assessor also needs to select profiles for adopt flow). The assessor prompt needs the same `{{profiles}}` variable.

## Detailed Changes

### Backend Model Passthrough (`src/engine/backends/claude-sdk.ts`)

In the `run()` method, add `model` to the `sdkQuery()` options:

```typescript
const q = sdkQuery({
  prompt: options.prompt,
  options: {
    // ... existing options ...
    model: options.model,  // undefined is fine - SDK ignores it
  },
});
```

No conditional needed - `undefined` values are ignored by the SDK.

### Planner Options and Profile Formatting (`src/engine/agents/planner.ts`)

Add to `PlannerOptions`:

```typescript
import type { ResolvedProfileConfig } from '../config.js';

export interface PlannerOptions extends CompileOptions {
  backend: AgentBackend;
  onClarification?: (questions: ClarificationQuestion[]) => Promise<Record<string, string>>;
  /** Available workflow profiles for profile selection. When provided, the planner selects a profile. */
  profiles?: Record<string, ResolvedProfileConfig>;
}
```

Add a helper to format profiles for the prompt:

```typescript
function formatProfileDescriptions(profiles: Record<string, ResolvedProfileConfig>): string {
  if (Object.keys(profiles).length === 0) return '';

  const rows = Object.entries(profiles)
    .map(([name, profile]) => `| \`${name}\` | ${profile.description} |`)
    .join('\n');

  return `| Profile | Description |
|---------|-------------|
${rows}`;
}
```

Update `buildPrompt()` to include profiles:

```typescript
function buildPrompt(): Promise<string> {
  return loadPrompt('planner', {
    source: sourceContent,
    planSetName,
    cwd,
    priorClarifications: formatPriorClarifications(allClarifications),
    profiles: options.profiles ? formatProfileDescriptions(options.profiles) : '',
  });
}
```

Update the event loop to parse profile blocks:

```typescript
import { parseClarificationBlocks, parseScopeBlock, parseProfileBlock } from './common.js';
import { SCOPE_ASSESSMENTS } from '../events.js';

// Inside the for-await loop, after scope parsing:
if (!profileEmitted) {
  const profile = parseProfileBlock(event.content);
  if (profile) {
    profileEmitted = true;
    yield { type: 'plan:profile', profileName: profile.profileName, rationale: profile.rationale };

    // Derive plan:scope if profile name matches a built-in scope
    if (!scopeEmitted && (SCOPE_ASSESSMENTS as readonly string[]).includes(profile.profileName)) {
      scopeEmitted = true;
      yield {
        type: 'plan:scope',
        assessment: profile.profileName as ScopeAssessment,
        justification: profile.rationale,
      };
    }
  }
}
```

### Assessor Updates (`src/engine/agents/assessor.ts`)

Add profile parsing and optional profiles to `AssessorOptions`:

```typescript
import type { ResolvedProfileConfig } from '../config.js';

export interface AssessorOptions {
  backend: AgentBackend;
  sourceContent: string;
  cwd: string;
  verbose?: boolean;
  abortController?: AbortController;
  /** Available workflow profiles for profile selection. */
  profiles?: Record<string, ResolvedProfileConfig>;
}
```

After the agent run loop, parse profile blocks from `fullText`:

```typescript
import { parseScopeBlock, parseProfileBlock } from './common.js';

// After agent run loop:
const profile = parseProfileBlock(fullText);
if (profile) {
  yield { type: 'plan:profile', profileName: profile.profileName, rationale: profile.rationale };
}
```

### Planner Prompt Update (`src/engine/prompts/planner.md`)

Add between the existing Phase 2 and Phase 3 sections:

```markdown
### Profile Selection

{{profiles}}

If profiles are listed above, select the profile that best matches the work described in the source document. Consider:
- The type of work (migration, security, refactor, feature, etc.)
- The risk profile and review needs
- The scope indicators from your codebase exploration

Emit a `<profile>` block declaring your selection:

\`\`\`xml
<profile name="excursion">
  Multi-file feature work adding a new API endpoint with frontend integration.
  Cross-file changes across 8 files with no architectural impact.
</profile>
\`\`\`

Rules:
- The `name` attribute must exactly match one of the profile names listed above
- The body contains your rationale for selecting this profile
- If no profiles are listed above, skip this section and proceed to Scope Assessment
- After selecting a profile, still emit the `<scope>` block in Phase 3 (both are required)
```

## Testing Strategy

### Unit Tests

**`test/config-profiles.test.ts`** (add to existing file from config-and-types module, or create `test/backend-prompts.test.ts`):

**`ClaudeSDKBackend` model passthrough** - Not unit tested per CLAUDE.md conventions (backend implementation is integration-level). Verified via type checking.

**Profile formatting in planner** (`test/agent-wiring.test.ts` or new file):
- `formatProfileDescriptions({})` returns empty string
- `formatProfileDescriptions({ errand: { description: 'Small change', ... } })` returns a markdown table with one row
- `formatProfileDescriptions` with multiple profiles returns a markdown table with all profiles listed

**Planner profile emission** (add to `test/agent-wiring.test.ts`):
- When `StubBackend` yields `agent:message` containing a `<profile name="excursion">rationale</profile>` block, `runPlanner()` yields a `plan:profile` event with `profileName: 'excursion'` and `rationale: 'rationale'`
- When profile name matches a built-in scope (`errand`, `excursion`, `expedition`), both `plan:profile` and `plan:scope` events are emitted
- When profile name is a custom name (e.g., `migration`), only `plan:profile` is emitted (no `plan:scope`)
- When no `<profile>` block is present but `<scope>` is, only `plan:scope` is emitted (backwards compatible)

**Assessor profile emission** (add to `test/agent-wiring.test.ts`):
- When `StubBackend` yields text containing a `<profile>` block, `runAssessor()` yields a `plan:profile` event
- When no `<profile>` block is present, `runAssessor()` still yields `plan:scope` as before (backwards compatible)

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes - all existing tests remain green, all new tests pass
- [ ] `ClaudeSDKBackend.run()` passes `model` from `AgentRunOptions` into the SDK's `query()` options - verified by reading the code diff (no unit test for backend impl)
- [ ] Planner prompt contains a `{{profiles}}` template variable and instructions for emitting `<profile>` XML blocks
- [ ] `runPlanner()` with `profiles` option set builds the `{{profiles}}` template variable from profile descriptions
- [ ] `runPlanner()` emits `plan:profile` event when agent output contains `<profile name="excursion">rationale</profile>`
- [ ] `runPlanner()` emits both `plan:profile` and `plan:scope` when profile name matches a built-in scope
- [ ] `runPlanner()` emits only `plan:profile` (no `plan:scope`) when profile name is a custom name like `migration`
- [ ] `runPlanner()` without `profiles` option emits `plan:scope` only (backwards compatible with pre-profile behavior)
- [ ] `runAssessor()` emits `plan:profile` event when agent output contains a `<profile>` block
- [ ] `runAssessor()` without a `<profile>` block in output emits `plan:scope` as before (backwards compatible)
- [ ] `PlannerOptions.profiles` field is typed as `Record<string, ResolvedProfileConfig> | undefined`
- [ ] `AssessorOptions.profiles` field is typed as `Record<string, ResolvedProfileConfig> | undefined`
- [ ] `AgentRunOptions.model` field is typed as `string | undefined` (verified by config-and-types module, but this module adds the backend passthrough)
