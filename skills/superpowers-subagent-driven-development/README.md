# Subagent-Driven Development (skill · community)

**Why it's here:** it is the closest published description of how a fleet is supposed to work: one fresh agent per task so context never pollutes, a review gate after each, a broad review at the end. Marblo's board does this with tickets; this skill does it inside a single session.

> **Referenced, not vendored.** The files live in [`obra/superpowers`](https://github.com/obra/superpowers), pinned to the release tag `v6.2.0`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click). Install it yourself below.

## Install it standalone (no Marblo required)

The skill is `SKILL.md` plus three dispatch prompts (`implementer-prompt.md`, `task-reviewer-prompt.md`, `re-review-prompt.md`) and three helper scripts (`scripts/task-brief`, `scripts/review-package`, `scripts/sdd-workspace`).

```bash
# Claude Code
mkdir -p ~/.claude/skills && curl -sL "https://codeload.github.com/obra/superpowers/tar.gz/refs/tags/v6.2.0" \
  | tar -xz -C ~/.claude/skills --strip-components=2 "superpowers-6.2.0/skills/subagent-driven-development"
```

```bash
# Codex
mkdir -p ~/.codex/skills && curl -sL "https://codeload.github.com/obra/superpowers/tar.gz/refs/tags/v6.2.0" \
  | tar -xz -C ~/.codex/skills --strip-components=2 "superpowers-6.2.0/skills/subagent-driven-development"
```

## Details

- **Upstream:** [obra/superpowers · `skills/subagent-driven-development`](https://github.com/obra/superpowers/tree/main/skills/subagent-driven-development) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** tag `v6.2.0`
- **Permissions:** `repository:read`, `repository:write`, `filesystem:write`, `shell:exec` — the dispatched implementers edit files, run tests, and commit each task, so the write and shell entries are the implementer's, not the coordinator's.
- **The fix ladder is the interesting part:** review findings get up to five rounds — rounds 1–3 resume the same implementer, round 4 starts a fresh one on a more capable model, and round 5 stops and reports BLOCKED rather than looping forever.
- **It tells the agent not to check in between tasks.** "Should I continue?" prompts are explicitly banned; if you want a human gate per task, this is the wrong skill and [`superpowers-executing-plans`](https://github.com/obra/superpowers/tree/main/skills/executing-plans) upstream is the right one.
- **License:** MIT.
- **Measured at pin (2026-07-30):** 263,359 stars · tag `v6.2.0` commit 2026-07-24 · repo last push 2026-07-28 · not archived.

Consumes the output of [`superpowers-writing-plans`](../superpowers-writing-plans/) and uses [`superpowers-requesting-code-review`](../superpowers-requesting-code-review/) for its review step.
