# TDD Cycle (workflow · community)

**Why it's here:** it is a workflow that runs **outside** Marblo — a slash command plus the subagents it dispatches, with the two properties that make long agent runs survivable: every step persists its output to `.tdd-cycle/` instead of trusting the context window, and phase checkpoints stop for a human.

> **Referenced, not vendored.** Files live in [`wshobson/agents`](https://github.com/wshobson/agents), pinned to commit `c4b82b0`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

Unlike our own [`review-and-merge`](../review-and-merge/), this workflow **is** portable: it is a Claude Code slash command plus two subagents, and the command dispatches only agents bundled beside it. Install both halves or the dispatch will fail.

```bash
SHA=c4b82b0ad771190355eb8e204b1329732a18449a
TMP=$(mktemp -d)
curl -sL "https://codeload.github.com/wshobson/agents/tar.gz/$SHA" \
  | tar -xz -C "$TMP" "agents-$SHA/plugins/tdd-workflows"
SRC="$TMP/agents-$SHA/plugins/tdd-workflows"

mkdir -p ~/.claude/commands ~/.claude/agents
cp "$SRC"/commands/*.md ~/.claude/commands/
cp "$SRC"/agents/*.md   ~/.claude/agents/
```

You get `/tdd-cycle` plus `/tdd-red`, `/tdd-green`, `/tdd-refactor`, backed by the `tdd-workflows-tdd-orchestrator` and `tdd-workflows-code-reviewer` subagents. The command references those agents by their namespaced frontmatter names, which is why the two `cp` lines go together.

Upstream also ships a `.codex-plugin/plugin.json` beside `.claude-plugin/`, so the same payload is intended to load in Codex.

## Details

- **Upstream:** [`plugins/tdd-workflows`](https://github.com/wshobson/agents/tree/main/plugins/tdd-workflows) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** `c4b82b0ad771190355eb8e204b1329732a18449a` (no release tags upstream)
- **Permissions:** `repository:read`, `filesystem:write`, `shell:exec` — it writes tests, implementation, and its own `.tdd-cycle/` state directory, and runs the suite between phases.
- **Note:** it writes `.tdd-cycle/` into your working directory. Add it to `.gitignore` before the first run.
- **License:** MIT.
- **Measured at pin (2026-07-29):** 38,342 stars · last commit 2026-07-18 · not archived.

Enforces the same rule as the [`superpowers-test-driven-development`](../../skills/superpowers-test-driven-development/) skill — that one as a discipline you carry, this one as a pipeline you run.
