---
title: Fix: Preserve `extends` in `resolveGeneratedProfile()`
created: 2026-03-19
status: pending
---

## Problem / Motivation

Commit `e243220` added `extends` to the resolved profile schema and preserved it through `resolveProfileExtensions()` (for user-defined profiles in `eforge.yaml`), including monitor UI display. However, it missed the `resolveGeneratedProfile()` code path - the path used when the **planner dynamically generates** a custom profile during compile (the common path during evals and real runs). The `extends` value from the generated block is consumed for base profile lookup but never included in the returned `ResolvedProfileConfig`, so the monitor shows a custom profile name without its base relationship.

## Goal

Preserve the `extends` field in `resolveGeneratedProfile()` so that dynamically generated profiles carry their base profile relationship through to the monitor dashboard and anywhere else `ResolvedProfileConfig` is consumed.

## Approach

**File**: `src/engine/config.ts` — `resolveGeneratedProfile()` (lines 708-714)

Add `extends: baseName` to the returned object in the extends-mode branch:

```typescript
return {
  description: overrides.description ?? base.description,
  extends: baseName,  // <-- add this line
  compile: overrides.compile ?? base.compile,
  build: overrides.build ?? base.build,
  agents: { ...base.agents, ...(overrides.agents as Partial<Record<AgentRole, AgentProfileConfig>> ?? {}) },
  review: { ...base.review, ...(overrides.review ?? {}) } as ReviewProfileConfig,
};
```

One-line change. The field already exists on `ResolvedProfileConfig` (added in `e243220`), so no schema changes are needed.

## Scope

**In scope:**
- Adding `extends: baseName` to the return value in `resolveGeneratedProfile()`'s extends-mode branch

**Out of scope:**
- Schema changes (already done in `e243220`)
- Monitor UI changes (already done in `e243220`)
- `resolveProfileExtensions()` changes (already done in `e243220`)

## Acceptance Criteria

1. `pnpm type-check` passes - the field is valid on `ResolvedProfileConfig`
2. `pnpm test` passes - existing profile resolution tests still pass
3. When running an eval scenario with a planner-generated custom profile, the monitor dashboard shows "extends errand" (or whichever base) next to the custom profile name
