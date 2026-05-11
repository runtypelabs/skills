# Runtype Skills

[![skills.sh](https://skills.sh/b/runtypelabs/skills)](https://skills.sh/runtypelabs/skills)

Official agent skills for the [Runtype](https://runtype.com) platform — install them in Claude Code, Cursor, Copilot, and 35+ other AI coding agents.

## Install

**All skills:**

```bash
npx skills add runtypelabs/skills
```

**Pick specific skills:**

```bash
npx skills add runtypelabs/skills --list
```

## Skills

| Skill | Description |
|-------|-------------|
| [`runtype`](skills/runtype/) | Build, deploy, and operate hosted AI products on Runtype — agents, flows, surfaces (Slack/email/SMS/MCP/webhooks/chat widget/etc.), records, schedules, and evals. Covers the dashboard, REST, MCP (`api.runtype.com/v1/mcp/protocol`), and SDK working modes. |

## Authoring a New Skill

Create a directory under `skills/` with a `SKILL.md` file:

```
skills/
└── my-skill/
    ├── SKILL.md           # Required: frontmatter + instructions
    ├── scripts/           # Optional: executable helpers
    ├── references/        # Optional: API specs, schemas, docs
    └── examples/          # Optional: example inputs/outputs
```

### SKILL.md format

```yaml
---
name: my-skill
description: >-
  What it does and when to use it. Include trigger phrases.
  Max 1024 chars.
user-invocable: true
argument-hint: "[optional args hint]"
---

Instructions for the agent go here. Keep under 500 lines.
Move detailed reference material to references/ or scripts/.
```

### Best practices

- **Description**: Use imperative phrasing ("Use when..."), include specific trigger phrases
- **Size**: Keep SKILL.md under 500 lines / 5,000 tokens
- **Structure**: Move API specs, schemas, and long docs to `references/`
- **Scripts**: Bundle reusable helpers in `scripts/` instead of inlining
- **No secrets**: Never include API keys, internal URLs, or credentials

## License

[MIT](LICENSE)
