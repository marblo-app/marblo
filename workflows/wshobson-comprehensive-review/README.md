# Comprehensive Review (workflow · community)

**Why it's here:** one reviewer reading for everything reads for nothing in particular. This one splits the pass into separate dispatches with separate prompts — quality, then architecture, then security — so each dimension gets its own attention budget and its own file on disk instead of competing inside one context window.

> **Referenced, not vendored.** Files live in [`wshobson/agents`](https://github.com/wshobson/agents), pinned to commit `c4b82b0`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

A Claude Code slash command plus the three subagents it dispatches. Install both halves or the dispatch will fail.

```bash
SHA=c4b82b0ad771190355eb8e204b1329732a18449a
TMP=$(mktemp -d)
curl -sL "https://codeload.github.com/wshobson/agents/tar.gz/$SHA" \
  | tar -xz -C "$TMP" "agents-$SHA/plugins/comprehensive-review"
SRC="$TMP/agents-$SHA/plugins/comprehensive-review"

mkdir -p ~/.claude/commands ~/.claude/agents
cp "$SRC"/commands/*.md ~/.claude/commands/
cp "$SRC"/agents/*.md   ~/.claude/agents/
```

You get `/full-review` — the pipeline — plus `/pr-enhance`. It is backed by the `comprehensive-review-code-reviewer`, `comprehensive-review-architect-review`, and `comprehensive-review-security-auditor` subagents, dispatched by those namespaced frontmatter names, which is why the two `cp` lines go together. Later steps dispatch `general-purpose`, so there are no cross-plugin dependencies.

Flags worth knowing: `--security-focus`, `--performance-critical`, `--strict-mode`, and `--framework react|spring|django|rails`.

Upstream also ships a `.codex-plugin/plugin.json` beside `.claude-plugin/`, so the same payload is intended to load in Codex.

## Details

- **Upstream:** [`plugins/comprehensive-review`](https://github.com/wshobson/agents/tree/main/plugins/comprehensive-review) · **Manifest:** [`marblo.yaml`](marblo.yaml) · plugin version `1.3.1` at the pin
- **Pinned to:** `c4b82b0ad771190355eb8e204b1329732a18449a` (no release tags upstream)
- **Permissions:** `repository:read`, `filesystem:write`, `shell:exec` — it reads the target, writes its findings, and runs tooling to check what it claims. It reviews; it does not commit, push, or merge.
- **Note:** it writes `.full-review/` into your working directory. Add it to `.gitignore` before the first run.
- **License:** MIT.
- **Measured at pin (2026-07-29):** 38,347 stars · pinned commit 2026-07-18 · not archived.

Overlaps deliberately with our own [`code-review`](../../skills/code-review/) skill and [`review-and-merge`](../review-and-merge/) workflow — ours is a single opinionated pass wired to a merge gate, this one is a fan-out across dimensions with no gate at the end. Run this to find things; run ours to decide whether the change lands.
