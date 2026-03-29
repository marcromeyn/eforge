---
title: Update README license section for Pi backend
created: 2026-03-29
status: pending
---



# Update README license section for Pi backend

## Problem / Motivation

eforge now has two backend options: the Claude Agent SDK (proprietary) and the Pi backend (MIT licensed). The README license section currently only mentions the Claude Agent SDK, so users are unaware they have a fully open-source backend option.

## Goal

Add a bullet to the README license section describing the Pi backend packages and their MIT license, so users understand both backend options and their licensing.

## Approach

In `README.md` (lines 110-116), add a new bullet point after the Claude Agent SDK bullet (after line 114) describing the Pi backend packages. The bullet will list the three MIT-licensed packages by Mario Zechner from the [pi-mono](https://github.com/badlogic/pi-mono) monorepo:

- `@mariozechner/pi-ai`
- `@mariozechner/pi-agent-core`
- `@mariozechner/pi-coding-agent`

The new bullet will note that these are MIT licensed and support 20+ LLM providers, making them a fully open-source backend alternative.

## Scope

**In scope:**
- Adding a new bullet point to the license section of `README.md`

**Out of scope:**
- Any code changes
- Changes to other documentation files
- Changes to actual licensing or package configuration

## Acceptance Criteria

- The README license section lists both the Claude Agent SDK and the Pi backend as separate bullets.
- The Pi backend bullet names all three packages (`@mariozechner/pi-ai`, `@mariozechner/pi-agent-core`, `@mariozechner/pi-coding-agent`).
- The Pi backend bullet states that the packages are MIT licensed.
- The Pi backend bullet mentions support for 20+ LLM providers and that it is a fully open-source backend alternative.
- The license section reads clearly with both backends listed.
