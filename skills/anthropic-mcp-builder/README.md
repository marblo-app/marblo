# MCP Builder (skill · community)

**Why it's here:** writing an MCP server is easy; writing one an agent can actually drive is not — this is Anthropic's own guidance on the second problem, with a scoring harness so you can tell the difference.

> **Referenced, not vendored.** The files live in [`anthropics/skills`](https://github.com/anthropics/skills) and stay there. This folder is a manifest and a pointer, pinned to commit `b29e7cf`.
>
> **Tier `community` = listed, not installable.** Marblo will show it in the Store and link it; it will not one-click-install it until the app ships a permission gate — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click). The snippet below is how you install it yourself, today.

## Install it standalone (no Marblo required)

The skill is a `SKILL.md` plus `reference/` docs and `scripts/` — so pull the whole folder, not one file.

```bash
# Claude Code
SHA=b29e7cf65e5cb78a5ac33d582270551bc74a14eb
mkdir -p ~/.claude/skills && curl -sL "https://codeload.github.com/anthropics/skills/tar.gz/$SHA" \
  | tar -xz -C ~/.claude/skills --strip-components=2 "skills-$SHA/skills/mcp-builder"
```

```bash
# Codex — same payload, different directory
SHA=b29e7cf65e5cb78a5ac33d582270551bc74a14eb
mkdir -p ~/.codex/skills && curl -sL "https://codeload.github.com/anthropics/skills/tar.gz/$SHA" \
  | tar -xz -C ~/.codex/skills --strip-components=2 "skills-$SHA/skills/mcp-builder"
```

Scope it to one project instead by extracting into `./.claude/skills/` inside that repo.

## Details

- **Upstream:** [anthropics/skills · `skills/mcp-builder`](https://github.com/anthropics/skills/tree/main/skills/mcp-builder) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** `b29e7cf65e5cb78a5ac33d582270551bc74a14eb` (no release tags exist upstream, so the pin is a SHA)
- **Permissions:** `filesystem:read`, `filesystem:write`, `shell:exec`, `network:outbound` — it writes server code and runs its `scripts/evaluation.py` against a live endpoint.
- **License:** **Apache-2.0.** Worth knowing: the repository root ships no `LICENSE` file, so the GitHub API reports the repo as unlicensed. The license is per-skill — `skills/mcp-builder/LICENSE.txt` is Apache-2.0, and it comes along with the install above.
- **Measured at pin (2026-07-29):** 164,888 stars · last commit 2026-07-24 · not archived.

Pairs with [`anthropic-skill-creator`](../anthropic-skill-creator/) when you are authoring the skill that will drive the server.
