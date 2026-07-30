# Requesting Code Review (skill · community)

**Why it's here:** a reviewer that inherited your context will agree with you. This skill's whole point is the opposite: build the reviewer's context deliberately, hand it a `BASE_SHA..HEAD_SHA` range, and let it evaluate the diff cold.

> **Referenced, not vendored.** The files live in [`obra/superpowers`](https://github.com/obra/superpowers), pinned to the release tag `v6.2.0`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click). Install it yourself below.

## Install it standalone (no Marblo required)

The skill is `SKILL.md` plus `code-reviewer.md`, the fill-in-the-blanks reviewer prompt (`{DESCRIPTION}`, `{PLAN_OR_REQUIREMENTS}`, `{BASE_SHA}`, `{HEAD_SHA}`).

```bash
# Claude Code
mkdir -p ~/.claude/skills && curl -sL "https://codeload.github.com/obra/superpowers/tar.gz/refs/tags/v6.2.0" \
  | tar -xz -C ~/.claude/skills --strip-components=2 "superpowers-6.2.0/skills/requesting-code-review"
```

```bash
# Codex
mkdir -p ~/.codex/skills && curl -sL "https://codeload.github.com/obra/superpowers/tar.gz/refs/tags/v6.2.0" \
  | tar -xz -C ~/.codex/skills --strip-components=2 "superpowers-6.2.0/skills/requesting-code-review"
```

## Details

- **Upstream:** [obra/superpowers · `skills/requesting-code-review`](https://github.com/obra/superpowers/tree/main/skills/requesting-code-review) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** tag `v6.2.0`
- **Permissions:** `repository:read`, `shell:exec` — it resolves a base and head SHA with `git rev-parse` and reads the diff. It does not write — acting on the review is a separate step.
- **It dispatches `general-purpose`**, not a named reviewer agent — so it works on a fresh install with nothing else configured.
- **It expects push-back:** the instruction is to fix critical findings immediately, important ones before proceeding, note minor ones, and argue with the reviewer when it is wrong.
- **License:** MIT.
- **Measured at pin (2026-07-30):** 263,359 stars · tag `v6.2.0` commit 2026-07-24 · repo last push 2026-07-28 · not archived.

The other half of the loop is [`superpowers-receiving-code-review`](../superpowers-receiving-code-review/).
