# Dispatching Parallel Agents (skill · community)

**Why it's here:** parallel dispatch is the single biggest speedup available to a fleet and the easiest to get wrong. This skill spends most of its length on the *don't* half — related failures, shared state, agents that would interfere — which is the part usually left implicit.

> **Referenced, not vendored.** The files live in [`obra/superpowers`](https://github.com/obra/superpowers), pinned to the release tag `v6.2.0`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click). Install it yourself below.

## Install it standalone (no Marblo required)

The skill is a single `SKILL.md`.

```bash
# Claude Code
mkdir -p ~/.claude/skills && curl -sL "https://codeload.github.com/obra/superpowers/tar.gz/refs/tags/v6.2.0" \
  | tar -xz -C ~/.claude/skills --strip-components=2 "superpowers-6.2.0/skills/dispatching-parallel-agents"
```

```bash
# Codex
mkdir -p ~/.codex/skills && curl -sL "https://codeload.github.com/obra/superpowers/tar.gz/refs/tags/v6.2.0" \
  | tar -xz -C ~/.codex/skills --strip-components=2 "superpowers-6.2.0/skills/dispatching-parallel-agents"
```

## Details

- **Upstream:** [obra/superpowers · `skills/dispatching-parallel-agents`](https://github.com/obra/superpowers/tree/main/skills/dispatching-parallel-agents) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** tag `v6.2.0`
- **Permissions:** `repository:read`, `filesystem:write`, `shell:exec` — the skill itself only decides and dispatches, but the agents it dispatches investigate and fix, so the declaration covers what the pattern actually causes to happen.
- **One concrete mechanic worth knowing:** it instructs the agent to issue every dispatch *in the same response*, because that is what makes them run concurrently rather than one after another.
- **Its decision tree is a graphviz block** in the markdown — readable as text, and renderable if you want the diagram.
- **License:** MIT.
- **Measured at pin (2026-07-30):** 263,359 stars · tag `v6.2.0` commit 2026-07-24 · repo last push 2026-07-28 · not archived.

Where [`superpowers-subagent-driven-development`](../superpowers-subagent-driven-development/) runs one task at a time, this is the case for running several at once.
