# Writing Skills (skill · community)

**Why it's here:** most skills are written from memory of a problem someone once solved, which is why so many are ignored at runtime. Its core claim is falsifiable and worth adopting: if you did not watch an agent fail without the skill, you do not know the skill teaches the right thing.

> **Referenced, not vendored.** The files live in [`obra/superpowers`](https://github.com/obra/superpowers), pinned to the release tag `v6.2.0`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click). Install it yourself below.

## Install it standalone (no Marblo required)

The skill is `SKILL.md` plus `anthropic-best-practices.md`, `testing-skills-with-subagents.md`, `persuasion-principles.md`, `graphviz-conventions.dot`, `render-graphs.js`, and an example under `examples/`.

```bash
# Claude Code
mkdir -p ~/.claude/skills && curl -sL "https://codeload.github.com/obra/superpowers/tar.gz/refs/tags/v6.2.0" \
  | tar -xz -C ~/.claude/skills --strip-components=2 "superpowers-6.2.0/skills/writing-skills"
```

```bash
# Codex
mkdir -p ~/.codex/skills && curl -sL "https://codeload.github.com/obra/superpowers/tar.gz/refs/tags/v6.2.0" \
  | tar -xz -C ~/.codex/skills --strip-components=2 "superpowers-6.2.0/skills/writing-skills"
```

## Details

- **Upstream:** [obra/superpowers · `skills/writing-skills`](https://github.com/obra/superpowers/tree/main/skills/writing-skills) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** tag `v6.2.0`
- **Permissions:** `repository:read`, `filesystem:write`, `shell:exec` — it writes the skill folder and runs subagent test scenarios (and `render-graphs.js`) to check whether the writing actually changed behaviour.
- **It declares a prerequisite:** the text states you must understand `superpowers:test-driven-development` first, since the whole method is RED-GREEN-REFACTOR applied to prose. That skill is [in this registry](../superpowers-test-driven-development/).
- **It has an opinion about what a skill is not:** narratives about how you solved something once, one-off fixes, and anything a regex could enforce instead.
- **License:** MIT.
- **Measured at pin (2026-07-30):** 263,359 stars · tag `v6.2.0` commit 2026-07-24 · repo last push 2026-07-28 · not archived.

Anthropic's own take on the same job is [`anthropic-skill-creator`](../anthropic-skill-creator/); this one is the test-first version.
