# Full-Stack Feature (workflow · community)

**Why it's here:** it is the longest orchestration in this registry and the one that most resembles what a fleet actually does — requirements, schema, architecture, implementation, then **three agents launched in parallel in a single response** for tests, security, and performance, then deployment. If you want to see the shape of multi-agent work without an orchestrator product, this is it, in one file.

> **Referenced, not vendored.** Files live in [`wshobson/agents`](https://github.com/wshobson/agents), pinned to commit `c4b82b0`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

A Claude Code slash command plus the four subagents it dispatches. Install both halves or the dispatch will fail.

```bash
SHA=c4b82b0ad771190355eb8e204b1329732a18449a
TMP=$(mktemp -d)
curl -sL "https://codeload.github.com/wshobson/agents/tar.gz/$SHA" \
  | tar -xz -C "$TMP" "agents-$SHA/plugins/full-stack-orchestration"
SRC="$TMP/agents-$SHA/plugins/full-stack-orchestration"

mkdir -p ~/.claude/commands ~/.claude/agents
cp "$SRC"/commands/*.md ~/.claude/commands/
cp "$SRC"/agents/*.md   ~/.claude/agents/
```

You get `/full-stack-feature`, backed by the `full-stack-orchestration-test-automator`, `-security-auditor`, `-performance-engineer`, and `-deployment-engineer` subagents, dispatched by those namespaced frontmatter names — which is why the two `cp` lines go together. Its earlier steps dispatch `general-purpose`, so there are no cross-plugin dependencies.

Flags worth knowing: `--stack react/fastapi/postgres`, `--api-style rest|graphql`, `--complexity simple|medium|complex`.

Upstream also ships a `.codex-plugin/plugin.json` beside `.claude-plugin/`, so the same payload is intended to load in Codex.

## Details

- **Upstream:** [`plugins/full-stack-orchestration`](https://github.com/wshobson/agents/tree/main/plugins/full-stack-orchestration) · **Manifest:** [`marblo.yaml`](marblo.yaml) · plugin version `1.3.1` at the pin
- **Pinned to:** `c4b82b0ad771190355eb8e204b1329732a18449a` (no release tags upstream)
- **Permissions:** `repository:read`, `filesystem:write`, `shell:exec` — it writes application code across every layer and runs the suite. It does **not** declare `repository:write` or `network:outbound`: the pipeline ends at a deployment _plan and readiness pass_, not at a deploy. Pair it with [`wshobson-git-workflow`](../wshobson-git-workflow/) if you want the result pushed.
- **Read this before the first run:** it writes `.full-stack-feature/` into your working directory — add it to `.gitignore`. And size the ask honestly: this is the workflow most likely to produce a large diff in one run, which is exactly the diff that is hardest to review.
- **License:** MIT.
- **Measured at pin (2026-07-29):** 38,347 stars · pinned commit 2026-07-18 · not archived.

For what parallel agent fan-out costs once it leaves a demo, see [Fleet Operations](../../knowledge/fleet-operations/KNOWLEDGE.md) — measured, where this workflow is prescriptive.
