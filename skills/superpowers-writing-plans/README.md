# Writing Plans (skill · community)

**Why it's here:** a plan written for yourself is not a plan — it is a reminder. This one is written for a stranger: assume zero codebase context, name the files each task touches, say how to test it, keep the tasks bite-sized. That is exactly the artifact a dispatched agent needs, which is why it matters more in a fleet than it does solo.

> **Referenced, not vendored.** The files live in [`obra/superpowers`](https://github.com/obra/superpowers), pinned to the release tag `v6.2.0`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click). Install it yourself below.

## Install it standalone (no Marblo required)

`SKILL.md` plus a reviewer prompt — small, but still a folder.

```bash
# Claude Code
mkdir -p ~/.claude/skills && curl -sL "https://codeload.github.com/obra/superpowers/tar.gz/refs/tags/v6.2.0" \
  | tar -xz -C ~/.claude/skills --strip-components=2 "superpowers-6.2.0/skills/writing-plans"
```

```bash
# Codex
mkdir -p ~/.codex/skills && curl -sL "https://codeload.github.com/obra/superpowers/tar.gz/refs/tags/v6.2.0" \
  | tar -xz -C ~/.codex/skills --strip-components=2 "superpowers-6.2.0/skills/writing-plans"
```

**One caveat, stated plainly:** its text hands off to three sibling skills by name — `superpowers:using-git-worktrees`, `superpowers:executing-plans`, and `superpowers:subagent-driven-development`. Only the first is listed in this registry ([here](../superpowers-using-git-worktrees/)); the other two live in the same upstream repo and install the same way. Install this skill alone and it still works — the handoff lines simply refer to something you do not have.

## Details

- **Upstream:** [obra/superpowers · `skills/writing-plans`](https://github.com/obra/superpowers/tree/main/skills/writing-plans) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** tag `v6.2.0`
- **Permissions:** `repository:read`, `filesystem:write` — it reads the codebase to decide the file structure and writes the plan to `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`. No shell, no network: it plans the work, it does not run it.
- **License:** MIT.
- **Measured at pin (2026-07-29):** 262,993 stars · tag `v6.2.0` commit 2026-07-24 · repo last commit 2026-07-28 · not archived.

Sits between [`superpowers-brainstorming`](../superpowers-brainstorming/) (which produces the spec) and [`superpowers-test-driven-development`](../superpowers-test-driven-development/) (which executes a task from it).
