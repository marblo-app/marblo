# Test-Driven Development (skill · community)

**Why it's here:** agents write tests that pass against code that does not work, because they never watched the test fail — this skill refuses to let the implementation come first.

> **Referenced, not vendored.** Files live in [`obra/superpowers`](https://github.com/obra/superpowers), pinned to tag `v6.2.0`.
>
> **Tier `community` = listed, not installable** in the Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

Two files — `SKILL.md` and `writing-good-tests.md`:

```bash
# Claude Code
mkdir -p ~/.claude/skills && curl -sL "https://codeload.github.com/obra/superpowers/tar.gz/refs/tags/v6.2.0" \
  | tar -xz -C ~/.claude/skills --strip-components=2 "superpowers-6.2.0/skills/test-driven-development"
```

```bash
# Codex
mkdir -p ~/.codex/skills && curl -sL "https://codeload.github.com/obra/superpowers/tar.gz/refs/tags/v6.2.0" \
  | tar -xz -C ~/.codex/skills --strip-components=2 "superpowers-6.2.0/skills/test-driven-development"
```

Self-contained: it references no other skill and needs no plugin runtime.

## Details

- **Upstream:** [obra/superpowers · `skills/test-driven-development`](https://github.com/obra/superpowers/tree/main/skills/test-driven-development) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** tag `v6.2.0`
- **Permissions:** `repository:read`, `filesystem:write`, `shell:exec` — it writes tests and runs them.
- **License:** MIT.
- **Measured at pin (2026-07-29):** 262,846 stars · last commit 2026-07-28 · not archived.
