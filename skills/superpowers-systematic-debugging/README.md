# Systematic Debugging (skill · community)

**Why it's here:** an agent asked to fix a failing test will patch the symptom in seconds — this skill makes it prove the cause first, which is the single highest-leverage constraint you can put on an autonomous coding agent.

> **Referenced, not vendored.** The files live in [`obra/superpowers`](https://github.com/obra/superpowers), pinned to the release tag `v6.2.0`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click). Install it yourself below.

## Install it standalone (no Marblo required)

`SKILL.md` plus companion notes (`root-cause-tracing.md`, `condition-based-waiting.md`, `defense-in-depth.md`) and a `find-polluter.sh`, so pull the folder.

```bash
# Claude Code
mkdir -p ~/.claude/skills && curl -sL "https://codeload.github.com/obra/superpowers/tar.gz/refs/tags/v6.2.0" \
  | tar -xz -C ~/.claude/skills --strip-components=2 "superpowers-6.2.0/skills/systematic-debugging"
```

```bash
# Codex
mkdir -p ~/.codex/skills && curl -sL "https://codeload.github.com/obra/superpowers/tar.gz/refs/tags/v6.2.0" \
  | tar -xz -C ~/.codex/skills --strip-components=2 "superpowers-6.2.0/skills/systematic-debugging"
```

The upstream project ships as a plugin, but this skill is portable markdown — no installer, no hooks, no runtime. **One caveat, stated plainly:** its text hands off to two sibling skills by name, `superpowers:test-driven-development` and `superpowers:verification-before-completion`. Both are listed here — [TDD](../superpowers-test-driven-development/) and [verification](../superpowers-verification-before-completion/) — and installing all three makes the handoffs resolve. Install it alone and it still works; the handoff lines simply refer to something you do not have.

## Details

- **Upstream:** [obra/superpowers · `skills/systematic-debugging`](https://github.com/obra/superpowers/tree/main/skills/systematic-debugging) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** tag `v6.2.0`
- **Permissions:** `repository:read`, `filesystem:read`, `shell:exec` — it reads code and runs your tests to reproduce. It prescribes fixes; the writing happens under whatever skill you fix with.
- **License:** MIT.
- **Measured at pin (2026-07-29):** 262,846 stars · last commit 2026-07-28 · not archived.
