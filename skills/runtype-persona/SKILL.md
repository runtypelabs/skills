---
name: runtype-persona
description: >-
  Use when embedding, configuring, styling, or debugging Runtype Persona chat widgets,
  fullscreen AI assistant layouts, chat surfaces, client tokens, theme tokens, artifacts,
  tool/reasoning visibility, programmatic widget access, or browser-side local tools with
  the Runtype SDK. Prefer generate_persona_embed_code and get_persona_theme_reference over
  hand-written snippets.
user-invocable: true
argument-hint: "[Persona widget or chat UI task]"
---

# Runtype Persona

Persona is the embeddable chat UI for Runtype `chat` surfaces. Use this skill for website
widgets, assistant layouts, theming, artifacts, and local browser tools.

## Required First Calls

When MCP is available:

- Use `get_platform_documentation(topic="persona-embed")` for current embed docs.
- Use `get_platform_documentation(topic="persona-fullscreen-assistant")` for fullscreen
  split-pane assistant layouts.
- Use `get_persona_theme_reference` before custom themes.
- Use `generate_persona_embed_code` for final snippets whenever possible.
- Read `runtype://types/surface-configs` directly when surface behavior config details
  matter.

Do not hand-write embed code unless the MCP tools are unavailable.

## Critical Constants

- Package: `@runtypelabs/persona`.
- Global script: `https://cdn.jsdelivr.net/npm/@runtypelabs/persona@latest/dist/install.global.js`.
- ESM entry: `https://cdn.jsdelivr.net/npm/@runtypelabs/persona@latest/dist/index.js`.
- CSS for ESM/npm usage: `@runtypelabs/persona/widget.css`.
- Init function: `initAgentWidget()`.
- Ready event: `persona:ready`.

Common wrong answers: `@runtype/persona`, `Persona.mount()`, `window.Persona`,
`index.umd.js`, missing `widget.css`, or `widget:ready`.

## Build Pattern

1. Create or identify the product, agent/flow capability, and `chat` surface.
2. Create a scoped client token with `create_client_token`.
3. Generate embed code with `generate_persona_embed_code`.
4. For consumer-facing widgets, hide tool calls and reasoning by default.
5. For internal/debug widgets, expose useful traces intentionally.
6. For custom themes, set explicit high-contrast component tokens and verify header,
   launcher, user message, primary button, tool call, and reasoning bubble contrast.

## Fullscreen Assistant Layouts

For ChatGPT/Claude-style layouts, read the fullscreen assistant resource first. The
default launcher embed is not enough. Fullscreen layouts usually need full-height mode,
panel chrome changes, a persistent shell, an artifact pane, composer customization, and
layout-specific token choices.

## Local Tools

Use browser-side local tools when the assistant needs to read page state or trigger UI
actions that are only available in the front end. Pair local tools with hidden parameters
when authenticated context should not enter model context.

Good local tool examples:

- Read current page HTML or selected DOM regions.
- Navigate to a record detail page.
- Open a modal or fill a safe form.
- Read browser-only state that has no server API.

If the umbrella `runtype` skill is installed alongside this focused skill, its durable
references provide fallback snippets and working-mode tradeoffs. This skill must still
work when installed by itself; prefer live MCP docs over local sibling files.
