# AGENTS.md

This repo contains official agent skills for the [Runtype](https://runtype.com) platform, published via [skills.sh](https://skills.sh) and the Codex plugin marketplace.

## Repo Structure

```
.Codex-plugin/plugin.json    # Codex plugin manifest
skills/<name>/SKILL.md         # One directory per skill
skills/<name>/references/      # Optional: API specs, schemas, long docs
skills/<name>/scripts/         # Optional: executable helpers
skills/<name>/examples/        # Optional: example inputs/outputs
```

## Adding a New Skill

1. Create `skills/<name>/SKILL.md` where `<name>` is lowercase with hyphens only
2. Add YAML frontmatter and markdown body:

```yaml
---
name: <name>
description: >-
  What it does and when to use it. Use imperative phrasing ("Use when...").
  Include specific trigger phrases. Max 1024 chars.
user-invocable: true
argument-hint: "[optional args hint]"
---

Agent instructions go here.
```

3. Update the skills table in `README.md`
4. Commit and push

## Skill Authoring Rules

- **`name` must match the directory name** — `skills/foo-bar/SKILL.md` needs `name: foo-bar`
- **Keep SKILL.md under 500 lines / 5,000 tokens** — this is the activation budget. Move API specs, schemas, and detailed docs to `references/`
- **Description is the trigger** — it's loaded at session start for all installed skills. Write it so the agent knows *when* to activate. "Use when the user mentions X, Y, or Z" is the pattern
- **No secrets or internal URLs** — this repo is intended to go public. No API keys, no `*.runtype-staging.com` URLs, no internal service names
- **Runtype-specific is fine** — these skills target Runtype users. Reference Runtype CLI commands, SDK methods, API endpoints, and platform concepts freely
- **Scripts go in `scripts/`** — if the skill needs a helper the agent would otherwise reinvent each time, bundle it as an executable script and reference it via `${CLAUDE_SKILL_DIR}/scripts/helper.sh`
- **Favor procedures over declarations** — teach *how to approach* a class of problems, not *what to produce* for a specific instance
- **Provide defaults, not menus** — pick a recommended approach and mention alternatives briefly

## Available Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Lowercase, hyphens only. Must match directory name. |
| `description` | Yes | When to use this skill. Max 1024 chars. |
| `user-invocable` | No | `true` (default) = appears in `/` menu. `false` = background knowledge only. |
| `disable-model-invocation` | No | `true` = only user can invoke via `/name`, agent won't auto-activate. |
| `argument-hint` | No | Shown during autocomplete, e.g. `[--flag] [target]`. |
| `arguments` | No | Named positional args for `$name` substitution. Space-separated or YAML list. |
| `model` | No | Override session model when skill is active. |
| `effort` | No | Override effort: `low`, `medium`, `high`, `xhigh`, `max`. |
| `context` | No | `fork` to run in isolated subagent context. |
| `agent` | No | Subagent type when `context: fork` (e.g. `Explore`, `Plan`). |
| `allowed-tools` | No | Space-separated pre-approved tools (experimental). |
| `paths` | No | Glob patterns limiting auto-activation to matching files. |

## Dynamic Context

Use `` !`command` `` to inject shell output at activation time (preprocessing — agent sees only the result):

```markdown
Current CLI version:
!`runtype --version 2>/dev/null || echo "not installed"`
```

Use `${CLAUDE_SKILL_DIR}` to reference files relative to the skill directory.

## Testing a Skill Locally

Symlink or copy the skill into a project's `.Codex/skills/` to test before pushing:

```bash
ln -s $(pwd)/skills/my-skill /path/to/project/.Codex/skills/my-skill
```

Then open Codex in that project and invoke `/my-skill`.
