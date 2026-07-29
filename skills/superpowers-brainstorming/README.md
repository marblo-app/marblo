# Brainstorming (skill · community)

**Why it's here:** the expensive agent failure is not a bug, it is a day of correct work against the wrong spec. This skill puts a hard gate in front of implementation — questions one at a time, two or three approaches with trade-offs, a design doc written to disk and approved — and explicitly refuses the "this one is too simple to need a design" exit.

> **Referenced, not vendored.** The files live in [`obra/superpowers`](https://github.com/obra/superpowers), pinned to the release tag `v6.2.0`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click). Install it yourself below.

## Install it standalone (no Marblo required)

`SKILL.md` plus `visual-companion.md`, a reviewer prompt, and a `scripts/` directory — pull the folder.

```bash
# Claude Code
mkdir -p ~/.claude/skills && curl -sL "https://codeload.github.com/obra/superpowers/tar.gz/refs/tags/v6.2.0" \
  | tar -xz -C ~/.claude/skills --strip-components=2 "superpowers-6.2.0/skills/brainstorming"
```

```bash
# Codex
mkdir -p ~/.codex/skills && curl -sL "https://codeload.github.com/obra/superpowers/tar.gz/refs/tags/v6.2.0" \
  | tar -xz -C ~/.codex/skills --strip-components=2 "superpowers-6.2.0/skills/brainstorming"
```

The skill text names no sibling skills, so it stands alone — but it is the natural front end to [`superpowers-writing-plans`](../superpowers-writing-plans/), which starts from the spec this one produces.

## Details

- **Upstream:** [obra/superpowers · `skills/brainstorming`](https://github.com/obra/superpowers/tree/main/skills/brainstorming) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** tag `v6.2.0`
- **Permissions:** `repository:read`, `filesystem:write`, `shell:exec` — it reads project context and recent commits, writes the design to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`, and commits it.
- **The part to know before you install it:** the optional _visual companion_ is a **local web server**. `scripts/start-server.sh` binds `127.0.0.1` on a random high port (`0.0.0.0` if you pass `--host`), serves an HTML frame for questions better shown than described, and idles out after 4 hours. It is offered just-in-time and only opens a browser after you approve — but it is a process on your machine, not prose, which is why this skill declares `shell:exec` while the other two superpowers skills here do not.
- **Also worth knowing:** it writes and _commits_ the design doc. On a repo where you care about commit hygiene, run it in a worktree — see [`superpowers-using-git-worktrees`](../superpowers-using-git-worktrees/).
- **License:** MIT.
- **Measured at pin (2026-07-29):** 262,993 stars · tag `v6.2.0` commit 2026-07-24 · repo last commit 2026-07-28 · not archived.
