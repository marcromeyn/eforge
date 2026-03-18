---
id: plan-01-profile-card
name: Profile Visualization Card for Monitor UI
depends_on: []
branch: profile-visualization-component-for-monitor-ui/profile-card
---

# Profile Visualization Card for Monitor UI

## Architecture Context

The monitor dashboard renders real-time pipeline execution but has no visual representation of the declared workflow profile. Profile info only appears as plain text in the `plan:profile` event card in the timeline. This plan adds a dedicated `ProfileCard` component between `ActivityHeatstrip` and `ThreadPipeline` that makes the selected profile immediately legible - badge with tier color, compile/build stage flow diagrams with parallel stage support, and a compact review config summary.

## Implementation

### Overview

Five files change: UI-local types for profile data, reducer state + event handling, a new `ProfileCard` component, `app.tsx` integration, and mock server data updates for parallel build stages.

### Key Decisions

1. **UI-local types instead of engine imports** — The monitor UI can't import from `src/engine/config.ts` (Node.js deps). Define local `ProfileInfo`, `ProfileConfig`, `BuildStageSpec`, and `ReviewProfileConfig` types in `types.ts` that mirror the engine shapes the `plan:profile` event carries.
2. **Tier-based badge coloring** — errand=green (#3fb950), excursion=blue (#58a6ff), expedition=orange (#f0883e), custom/other=purple (#bc8cff). Derived from profile name string match, not config.
3. **Stage pill color families** — Planning stages yellow/20, review stages green/20, build stages blue/20, utility stages cyan/20, evaluation stages purple/20, expedition stages orange/20. Consistent with existing agent color conventions.
4. **Parallel stages as vertical stacks** — `BuildStageSpec` is `string | string[]`. Arrays render as a `flex-col` stack with a subtle left border accent. Single strings render as individual pills. Chevron arrows connect steps horizontally.
5. **Nullable rendering** — `ProfileCard` returns null when `profileInfo` is null. No profile card before the `plan:profile` event fires.
6. **Rationale on tooltip** — The profile badge has a tooltip showing the planner's rationale for selecting this profile. Uses existing `Tooltip`/`TooltipProvider` from `components/ui/tooltip.tsx`.

## Scope

### In Scope
- `ProfileInfo`, `ProfileConfig`, `BuildStageSpec`, `ReviewProfileConfig` types in `types.ts`
- `profileInfo` field on `RunState` with `plan:profile` event handling in `processEvent`
- `BATCH_LOAD` accumulator initialization for `profileInfo`
- `ADD_EVENT` state spread for `profileInfo`
- `RESET` initialization for `profileInfo`
- New `ProfileCard` component at `src/monitor/ui/src/components/common/profile-card.tsx`
- Integration in `app.tsx` between `ActivityHeatstrip` and `ThreadPipeline`
- Mock server data updates: change flat `build` arrays to include `[['implement', 'doc-update'], ...]` parallel groups

### Out of Scope
- Engine changes to profile resolution or event emission
- Changes to other monitor components (timeline, pipeline, etc.)
- Persisting profile info beyond current session state

## Files

### Create
- `src/monitor/ui/src/components/common/profile-card.tsx` — New React component: profile badge with tier coloring and rationale tooltip, compile/build stage flow diagrams with chevron connectors and parallel stage stacking, review config summary line

### Modify
- `src/monitor/ui/src/lib/types.ts` — Add `BuildStageSpec`, `ReviewProfileConfig`, `ProfileConfig`, `ProfileInfo` types
- `src/monitor/ui/src/lib/reducer.ts` — Add `profileInfo: ProfileInfo | null` to `RunState` and `initialRunState`. Handle `plan:profile` event in `processEvent` to populate it. Add to `BATCH_LOAD` accumulator, `ADD_EVENT` spread, and `RESET`.
- `src/monitor/ui/src/app.tsx` — Import `ProfileCard`, render `{runState.profileInfo && <ProfileCard profileInfo={runState.profileInfo} />}` between `ActivityHeatstrip` (line 210) and `ThreadPipeline` (line 211)
- `src/monitor/mock-server.ts` — Update all 6 mock `plan:profile` events: change `build: ['implement', 'review', 'review-fix', 'evaluate']` to `build: [['implement', 'doc-update'], 'review', 'review-fix', 'evaluate']` to exercise parallel stage rendering

## Verification

- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm build` exits with code 0
- [ ] `ProfileCard` component exists at `src/monitor/ui/src/components/common/profile-card.tsx`
- [ ] `RunState` interface in `reducer.ts` includes `profileInfo: ProfileInfo | null`
- [ ] `processEvent` handles `event.type === 'plan:profile'` and sets `state.profileInfo`
- [ ] `initialRunState` has `profileInfo: null`
- [ ] `BATCH_LOAD` accumulator initializes `profileInfo: null`
- [ ] `RESET` case includes `profileInfo: null`
- [ ] `app.tsx` renders `ProfileCard` between `ActivityHeatstrip` and `ThreadPipeline` conditionally on `runState.profileInfo`
- [ ] Profile badge uses tier colors: green for 'errand', blue for 'excursion', orange for 'expedition', purple for any other name
- [ ] Stage flow renders compile and build pipelines as horizontal rows with chevron/arrow connectors between stages
- [ ] Parallel stages (arrays in `BuildStageSpec[]`) render as vertical flex-col stacks with a left border accent
- [ ] Review summary line displays strategy, perspectives, maxRounds, and evaluatorStrictness separated by dots
- [ ] Badge has a tooltip showing the rationale string on hover
- [ ] Component returns null when `profileInfo` is null (no render before profile event)
- [ ] All mock `plan:profile` events in `mock-server.ts` have `build` arrays with `['implement', 'doc-update']` as a nested parallel group
