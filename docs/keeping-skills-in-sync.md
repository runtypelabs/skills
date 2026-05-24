# Keeping Runtype Skills in Sync

This public repository should publish the skills that agents install. The private Runtype monorepo should remain the factual source of truth for generated or code-derived sections.

## Recommended ownership model

Keep canonical skill source, templates, and drift checks in the private `core` monorepo, then publish sanitized output to this public repository.

Why:

- Agents working on `core` can update product code and skills in the same change.
- Drift checks can read private source files without exposing them.
- The public repo stays installable, inspectable, and safe to open source.
- Generated public output can include the source commit SHA and hashes without copying private code.

The public repo can still accept issues and copy edits. Changes to generated sections should be imported back into the private source template before the next publish.

## Suggested private pipeline

1. In `core`, maintain a `skills` package or workspace with hand-authored templates and allowlisted extractors.
2. Extract public facts from code, not prose:
   - MCP documentation topics, resources, prompts, and tool names.
   - Surface types and trait metadata.
   - Flow step types and platform limits.
   - Persona package/CDN/API constants.
   - CLI command names and SDK mode names.
   - Runtime defaults such as `maxToolCalls` and telemetry behavior.
3. Render the public skill files into a temporary checkout of `runtypelabs/skills`.
4. Run a leak scan for secrets, internal hostnames, private URLs, and forbidden source snippets.
5. Run `node scripts/lint-skills.mjs` from this repository with `../core` present.
6. Open a ready-for-review PR to the public repo with a commit like `chore: sync skills from core <sha>`.

## Public repo checks

This repo should stay able to validate without private code. `scripts/lint-skills.mjs` therefore has two layers:

- Always-on checks: frontmatter, linked references, forbidden URLs/secrets, trigger smoke tests, and semantic guardrails for known fragile claims.
- Neighboring-core checks: extra drift checks when `../core` is present beside this repo.

Public CI can run the always-on checks. Private `core` CI should run both layers before publishing.

## Drift triggers

Run the private skill drift check when a `core` change touches:

- `packages/shared/src/product-generation/**`
- `packages/shared/src/flow-step-types.ts`
- `packages/mcp/**`
- `apps/code-mode-mcp/**`
- `packages/cli/src/lib/persona-snippets.ts`
- `packages/runtime/src/**/telemetry*`
- `persona/packages/widget/**`

If the check fails, either update the skill source in the same `core` PR or deliberately mark the changed behavior as private/unsupported so it is not published.
