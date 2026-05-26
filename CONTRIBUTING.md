# Contributing to Runtype Skills

Thanks for your interest in contributing! This repo contains the official agent skills for the [Runtype](https://runtype.com) platform.

## How to contribute

### Suggesting a skill

Open an [issue](https://github.com/runtypelabs/skills/issues) describing:

- What the skill does and when an agent should use it
- Example trigger phrases (e.g. "deploy my product", "check eval results")
- Whether it needs MCP tools, scripts, or is pure instructions

### Submitting a skill

1. Fork the repo and create a branch
2. Add your skill directory under `skills/` following the structure in the [README](README.md#authoring-a-new-skill)
3. Run `node scripts/lint-skills.mjs` to validate
4. Open a pull request with a clear description of what the skill does

### Improving an existing skill

Bug fixes, better trigger phrases, clearer instructions, and new examples are all welcome. Open a PR with a short explanation of the change.

## Skill guidelines

- **No secrets** — never include API keys, tokens, internal URLs, or credentials
- **Keep it focused** — one skill, one job. Use the `runtype` umbrella skill for routing
- **Size limit** — SKILL.md should stay under 500 lines / 5,000 tokens. Move reference material to `references/`
- **Test your triggers** — make sure the `description` field includes the phrases that should activate the skill
- **Run the linter** — `node scripts/lint-skills.mjs` catches common issues before review

## Sync from the Runtype monorepo

Some skill content is authored in the private Runtype monorepo and synced here. If a skill's instructions reference platform internals that change frequently, the Runtype team maintains those sections upstream. See [Keeping Skills in Sync](docs/keeping-skills-in-sync.md) for details.

External contributions to synced sections are welcome — the team will port accepted changes upstream.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
