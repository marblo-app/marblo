# Skill Creator (skill · community)

**Why it's here:** most skills fail by never triggering, not by giving bad advice — this one treats the `description:` line as something you measure with an eval set rather than something you guess at.

> **Referenced, not vendored.** Files live in [`anthropics/skills`](https://github.com/anthropics/skills), pinned to commit `b29e7cf`.
>
> **Tier `community` = listed, not installable** in the Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

`SKILL.md` plus `references/`, `scripts/`, and an `eval-viewer/`, so pull the folder.

```bash
# Claude Code
SHA=b29e7cf65e5cb78a5ac33d582270551bc74a14eb
mkdir -p ~/.claude/skills && curl -sL "https://codeload.github.com/anthropics/skills/tar.gz/$SHA" \
  | tar -xz -C ~/.claude/skills --strip-components=2 "skills-$SHA/skills/skill-creator"
```

```bash
# Codex
SHA=b29e7cf65e5cb78a5ac33d582270551bc74a14eb
mkdir -p ~/.codex/skills && curl -sL "https://codeload.github.com/anthropics/skills/tar.gz/$SHA" \
  | tar -xz -C ~/.codex/skills --strip-components=2 "skills-$SHA/skills/skill-creator"
```

## Details

- **Upstream:** [anthropics/skills · `skills/skill-creator`](https://github.com/anthropics/skills/tree/main/skills/skill-creator) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** `b29e7cf65e5cb78a5ac33d582270551bc74a14eb`
- **Permissions:** `filesystem:read`, `filesystem:write`, `shell:exec` — it writes skill files and runs eval scripts locally. No network declared: the eval runs go through the harness you are already talking to.
- **License:** **Apache-2.0**, from `skills/skill-creator/LICENSE.txt`. (Repo root has no `LICENSE`; the license is per-skill.)
- **Measured at pin (2026-07-29):** 164,888 stars · last commit 2026-07-24 · not archived.

The reference implementation of the format every skill in this repo uses — including [`code-review`](../code-review/).
