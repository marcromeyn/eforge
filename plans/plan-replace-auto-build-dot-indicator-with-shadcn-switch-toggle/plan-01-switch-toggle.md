---
id: plan-01-switch-toggle
name: Replace Auto-build Dot with Switch Toggle
depends_on: []
branch: plan-replace-auto-build-dot-indicator-with-shadcn-switch-toggle/switch-toggle
---

# Replace Auto-build Dot with Switch Toggle

## Architecture Context

The monitor UI uses shadcn/ui components wrapping Radix UI primitives. Existing examples include `checkbox.tsx` (wraps `@radix-ui/react-checkbox`), `collapsible.tsx`, `scroll-area.tsx`, etc. The auto-build toggle in `header.tsx` currently renders as a `<button>` with a colored dot — visually identical to the read-only connection status indicator, making it unclear that it's interactive.

## Implementation

### Overview

Add `@radix-ui/react-switch` as a dependency, create a standard shadcn Switch component following the existing checkbox pattern, and replace the dot+button in the header with a labeled Switch.

### Key Decisions

1. **Follow the existing checkbox.tsx pattern** — `forwardRef`, Radix primitive, `cn()` for className merging. This keeps all shadcn components consistent.
2. **Use a `<label>` wrapper instead of a `<button>`** — The Switch is self-contained with its own click handling; wrapping in a label with "Auto-build" text provides accessible association and cursor behavior.
3. **Tailwind v4 classes** — The monitor UI uses Tailwind v4 with CSS-based config. The Switch component uses Tailwind classes compatible with the project's theme tokens (`bg-primary`, `border-border`, etc.) and the dark-themed monitor palette.

## Scope

### In Scope
- Adding `@radix-ui/react-switch` dependency to `src/monitor/ui/package.json`
- Creating `src/monitor/ui/src/components/ui/switch.tsx` as a standard shadcn Switch component
- Replacing the auto-build `<button>` + dot pattern in `header.tsx` with a `<label>` + `<Switch>`

### Out of Scope
- Changing the connection status dot indicator (that remains read-only)
- Modifying auto-build toggle logic or API calls

## Files

### Create
- `src/monitor/ui/src/components/ui/switch.tsx` — shadcn Switch component wrapping `@radix-ui/react-switch`, following the same `forwardRef` + `cn()` pattern as `checkbox.tsx`

### Modify
- `src/monitor/ui/package.json` — add `@radix-ui/react-switch` to `dependencies`
- `src/monitor/ui/src/components/layout/header.tsx` — replace the `<button>` with dot indicator with a `<label>` wrapping the text "Auto-build" and a `<Switch>` component, passing `checked={autoBuildState.enabled}`, `onCheckedChange={onToggleAutoBuild}`, and `disabled={autoBuildToggling}`

## Verification

- [ ] `cd src/monitor/ui && pnpm install && pnpm build` exits with code 0
- [ ] `src/monitor/ui/src/components/ui/switch.tsx` exists and exports a `Switch` component wrapping `@radix-ui/react-switch`
- [ ] `header.tsx` imports and renders `Switch` with `checked`, `onCheckedChange`, and `disabled` props
- [ ] `header.tsx` no longer contains a `<div>` with class `w-2 h-2 rounded-full` inside the auto-build toggle area
- [ ] `package.json` lists `@radix-ui/react-switch` in `dependencies`
