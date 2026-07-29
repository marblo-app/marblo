# Verification Before Completion (skill · community)

**Why it's here:** the most expensive failure in a fleet is not a broken build, it is an agent reporting DONE on one — this is 3.6 KB that makes "it passes" require output you can point at.

> **Referenced, not vendored.** The file lives in [`obra/superpowers`](https://github.com/obra/superpowers), pinned to tag `v6.2.0`.
>
> **Tier `community` = listed, not installable** in the Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

One file, no companions:

```bash
# Claude Code
mkdir -p ~/.claude/skills/verification-before-completion && curl -sL \
  https://raw.githubusercontent.com/obra/superpowers/v6.2.0/skills/verification-before-completion/SKILL.md \
  -o ~/.claude/skills/verification-before-completion/SKILL.md
```

```bash
# Codex — same file, different directory
mkdir -p ~/.codex/skills/verification-before-completion && cp \
  ~/.claude/skills/verification-before-completion/SKILL.md ~/.codex/skills/verification-before-completion/
```

## Details

- **Upstream:** [obra/superpowers · `skills/verification-before-completion`](https://github.com/obra/superpowers/tree/main/skills/verification-before-completion) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** tag `v6.2.0`
- **Permissions:** `shell:exec` — the whole skill is "run the verification command before you claim anything". Nothing else declared, because nothing else is needed.
- **License:** MIT.
- **Measured at pin (2026-07-29):** 262,846 stars · last commit 2026-07-28 · not archived.

The natural counterpart to Marblo's own ["code merged ≠ work done"](../../knowledge/fleet-operations/KNOWLEDGE.md) rule — same failure mode, one level down.
