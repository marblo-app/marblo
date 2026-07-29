# Frontend Design (skill · community)

**Why it's here:** every agent-built UI converges on the same centered card, the same slate-and-indigo palette, the same system font stack. This skill exists to break that convergence — it asks for one aesthetic risk you can justify, grounded in the subject rather than in defaults.

> **Referenced, not vendored.** The file lives in [`anthropics/skills`](https://github.com/anthropics/skills) and stays there. This folder is a manifest and a pointer, pinned to commit `b29e7cf`.
>
> **Tier `community` = listed, not installable.** Marblo will show it in the Store and link it; it will not one-click-install it until the app ships a permission gate — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click). The snippet below is how you install it yourself, today.

## Install it standalone (no Marblo required)

One `SKILL.md` and its license — a single file's worth of payload, so a directory fetch is enough.

```bash
# Claude Code
SHA=b29e7cf65e5cb78a5ac33d582270551bc74a14eb
mkdir -p ~/.claude/skills && curl -sL "https://codeload.github.com/anthropics/skills/tar.gz/$SHA" \
  | tar -xz -C ~/.claude/skills --strip-components=2 "skills-$SHA/skills/frontend-design"
```

```bash
# Codex — same payload, different directory
SHA=b29e7cf65e5cb78a5ac33d582270551bc74a14eb
mkdir -p ~/.codex/skills && curl -sL "https://codeload.github.com/anthropics/skills/tar.gz/$SHA" \
  | tar -xz -C ~/.codex/skills --strip-components=2 "skills-$SHA/skills/frontend-design"
```

Scope it to one project instead by extracting into `./.claude/skills/` inside that repo.

## Details

- **Upstream:** [anthropics/skills · `skills/frontend-design`](https://github.com/anthropics/skills/tree/main/skills/frontend-design) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** `b29e7cf65e5cb78a5ac33d582270551bc74a14eb` (no release tags exist upstream, so the pin is a SHA)
- **Permissions:** `filesystem:read`, `filesystem:write` — it is prose, not tooling: it reads the UI you have and shapes the UI you write. No scripts, no shell, no network.
- **License:** **Apache-2.0.** Worth knowing: the repository root ships no `LICENSE` file, so the GitHub API reports the repo as unlicensed. The license is per-skill — `skills/frontend-design/LICENSE.txt` is Apache-2.0, and it comes along with the install above. Not every skill in that repo is: `docx`, `pdf`, `pptx`, and `xlsx` carry Anthropic's proprietary terms instead, which is why they are absent from this registry.
- **Measured at pin (2026-07-29):** 164,954 stars · last commit 2026-07-24 · not archived.

Pairs with [`anthropic-web-artifacts-builder`](../anthropic-web-artifacts-builder/) — that one scaffolds the app, this one decides what it should look like.
