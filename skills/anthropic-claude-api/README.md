# Claude API Reference (skill · community)

**Why it's here:** the single most expensive failure mode when an agent writes LLM code is answering from memory — a model id that was retired two releases ago, a price that moved, a caching header that changed shape. This skill's whole design is a trigger rule that fires _before_ the file is opened, so the reference is read instead of recalled.

> **Referenced, not vendored.** The files live in [`anthropics/skills`](https://github.com/anthropics/skills) and stay there. This folder is a manifest and a pointer, pinned to commit `b29e7cf`.
>
> **Tier `community` = listed, not installable.** Marblo will show it in the Store and link it; it will not one-click-install it until the app ships a permission gate — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click). The snippet below is how you install it yourself, today.

## Install it standalone (no Marblo required)

The largest skill in this registry: **66 files, ~846 KB** at the pin — `SKILL.md` plus per-language directories (`python/`, `typescript/`, `go/`, `java/`, `csharp/`, `php/`, `ruby/`, `curl/`) and a `shared/` set covering agent design, the Managed Agents API, and error codes. Progressive disclosure means the harness only reads the language it needs, so the on-disk size is not context cost.

```bash
# Claude Code
SHA=b29e7cf65e5cb78a5ac33d582270551bc74a14eb
mkdir -p ~/.claude/skills && curl -sL "https://codeload.github.com/anthropics/skills/tar.gz/$SHA" \
  | tar -xz -C ~/.claude/skills --strip-components=2 "skills-$SHA/skills/claude-api"
```

```bash
# Codex — same payload, different directory
SHA=b29e7cf65e5cb78a5ac33d582270551bc74a14eb
mkdir -p ~/.codex/skills && curl -sL "https://codeload.github.com/anthropics/skills/tar.gz/$SHA" \
  | tar -xz -C ~/.codex/skills --strip-components=2 "skills-$SHA/skills/claude-api"
```

Scope it to one project instead by extracting into `./.claude/skills/` inside that repo.

## Details

- **Upstream:** [anthropics/skills · `skills/claude-api`](https://github.com/anthropics/skills/tree/main/skills/claude-api) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** `b29e7cf65e5cb78a5ac33d582270551bc74a14eb` (no release tags exist upstream, so the pin is a SHA)
- **Permissions:** `filesystem:read`, `filesystem:write`, `shell:exec` — it reads its own reference files, writes the API code you asked for, and its skip rule runs a `grep` over the project to detect a different provider. It does **not** declare `network:outbound`: the skill is documentation about calling the API, not a client that calls it.
- **The caveat that matters for a pinned reference:** pricing and model ids age. A pin buys reproducibility, not freshness — when a number here disagrees with [docs.anthropic.com](https://docs.anthropic.com), the docs win, and this manifest's `source.ref` should be bumped.
- **License:** **Apache-2.0.** The repository root ships no `LICENSE` file, so the GitHub API reports the repo as unlicensed — the license is per-skill, and `skills/claude-api/LICENSE.txt` is Apache-2.0. Not every skill in that repo is: `docx`, `pdf`, `pptx`, and `xlsx` carry Anthropic's proprietary terms instead, which is why they are absent from this registry.
- **Measured at pin (2026-07-29):** 164,954 stars · last commit 2026-07-24 · not archived.

Pairs with [`anthropic-mcp-builder`](../anthropic-mcp-builder/): that one is how to expose tools to a model, this one is how to call the model that uses them.
