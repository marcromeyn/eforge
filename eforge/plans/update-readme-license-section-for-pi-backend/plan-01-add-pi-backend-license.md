---
id: plan-01-add-pi-backend-license
name: Add Pi backend license bullet to README
depends_on: []
branch: update-readme-license-section-for-pi-backend/add-pi-backend-license
---

# Add Pi backend license bullet to README

## Architecture Context

The README license section already has a "Third-party backend licenses" subsection with a bullet for the Claude Agent SDK. The Pi backend is a second backend option that needs its own bullet in this section.

## Implementation

### Overview

Add a new bullet point after the Claude Agent SDK bullet (after line 114) describing the three MIT-licensed Pi backend packages from the pi-mono monorepo.

### Key Decisions

1. Place the Pi backend bullet after the Claude Agent SDK note (line 114) and before the closing Apache 2.0 clarification (line 116), maintaining the existing structure.
2. List all three packages (`@mariozechner/pi-ai`, `@mariozechner/pi-agent-core`, `@mariozechner/pi-coding-agent`) inline with their MIT license and 20+ provider support.

## Scope

### In Scope
- Adding a new bullet point to the license section of `README.md`

### Out of Scope
- Any code changes
- Changes to other documentation files
- Changes to actual licensing or package configuration

## Files

### Modify
- `README.md` - Add Pi backend bullet point after line 114 in the license section

## Verification

- [ ] The README license section contains two backend bullets: one for Claude Agent SDK and one for the Pi backend
- [ ] The Pi backend bullet names all three packages: `@mariozechner/pi-ai`, `@mariozechner/pi-agent-core`, `@mariozechner/pi-coding-agent`
- [ ] The Pi backend bullet states the packages are MIT licensed
- [ ] The Pi backend bullet mentions 20+ LLM provider support and that it is a fully open-source backend alternative
- [ ] The license section reads clearly with both backends listed
