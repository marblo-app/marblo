# Using Git Worktrees (skill · community)

**Why it's here:** the failure this prevents is the one that costs the most and is noticed the latest — two agents editing the same checkout, one silently clobbering the other's uncommitted work. Its first rule is the non-obvious one: _detect existing isolation before creating any_, so an agent already running inside a harness-managed worktree does not nest another one underneath it.

> **Referenced, not vendored.** The file lives in [`obra/superpowers`](https://github.com/obra/superpowers), pinned to the release tag `v6.2.0`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click). Install it yourself below.

## Install it standalone (no Marblo required)

A single `SKILL.md`. The folder fetch keeps it consistent with the rest.

```bash
# Claude Code
mkdir -p ~/.claude/skills && curl -sL "https://codeload.github.com/obra/superpowers/tar.gz/refs/tags/v6.2.0" \
  | tar -xz -C ~/.claude/skills --strip-components=2 "superpowers-6.2.0/skills/using-git-worktrees"
```

```bash
# Codex
mkdir -p ~/.codex/skills && curl -sL "https://codeload.github.com/obra/superpowers/tar.gz/refs/tags/v6.2.0" \
  | tar -xz -C ~/.codex/skills --strip-components=2 "superpowers-6.2.0/skills/using-git-worktrees"
```

The skill text names no sibling skills, so it stands alone.

## Details

- **Upstream:** [obra/superpowers · `skills/using-git-worktrees`](https://github.com/obra/superpowers/tree/main/skills/using-git-worktrees) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** tag `v6.2.0`
- **Permissions:** `repository:read`, `repository:write`, `filesystem:write`, `shell:exec` — the only skill in this registry declaring `repository:write`, and it is not padding: creating a worktree creates a **branch** and writes to `.git/worktrees/`. That is a repository mutation, not just a file write, and disclosure that rounds it down to "filesystem" would be the wrong disclosure.
- **The detection detail worth reading before you trust it:** `git rev-parse --git-dir != --git-common-dir` is true inside a **submodule** as well as inside a worktree. The skill guards this explicitly with `git rev-parse --show-superproject-working-tree` — which is the check most hand-rolled worktree scripts get wrong.
- **License:** MIT.
- **Measured at pin (2026-07-29):** 262,993 stars · tag `v6.2.0` commit 2026-07-24 · repo last commit 2026-07-28 · not archived.

Named directly by [`superpowers-writing-plans`](../superpowers-writing-plans/), which expects the worktree to exist before execution starts.
