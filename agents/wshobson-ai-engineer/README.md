# AI Engineer (agent · community)

**Why it's here:** building with models is now ordinary product work, and it has its own failure modes — retrieval quality, routing, evaluation. This subagent covers that surface specifically, instead of treating it as generic backend engineering.

> **Referenced, not vendored.** The definition lives in [`wshobson/agents`](https://github.com/wshobson/agents), pinned to commit `c4b82b0`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

One subagent definition — YAML frontmatter plus a prompt, the format Claude Code already reads.

```bash
SHA=c4b82b0ad771190355eb8e204b1329732a18449a
mkdir -p ~/.claude/agents && curl -sL \
  "https://raw.githubusercontent.com/wshobson/agents/$SHA/plugins/llm-application-dev/agents/ai-engineer.md" \
  -o ~/.claude/agents/ai-engineer.md
```

Scope it to one repo instead by writing to `.claude/agents/` inside it.

**Invoke it by the frontmatter name, not the filename:** this one registers as **`ai-engineer`**. Upstream namespaces most of its agents per plugin — this file is one of the handful that does not.

## Details

- **Upstream:** [`plugins/llm-application-dev/agents/ai-engineer.md`](https://github.com/wshobson/agents/blob/main/plugins/llm-application-dev/agents/ai-engineer.md) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** `c4b82b0ad771190355eb8e204b1329732a18449a`
- **Permissions:** `repository:read`, `filesystem:read`, `filesystem:write`, `shell:exec`, `network:outbound` — declared wide **because the frontmatter carries no `tools:` line**, which in Claude Code means the agent inherits the session's entire tool set, web tools included. Narrow it yourself by adding a `tools:` line after install; compare [`voltagent-qa-expert`](../voltagent-qa-expert/), whose upstream does pin one.
- **Requests model:** `inherit` — it runs on whatever model your session is already using, so cost follows your routing rather than overriding it.
- **Read the model list with a date in mind:** the prompt enumerates specific model names and versions, which is the fastest-ageing part of any AI agent definition. Treat it as illustrative, not current.
- **License:** MIT.
- **Measured at pin (2026-07-30):** 38,358 stars · pinned commit 2026-07-18 · repo last push 2026-07-22 · not archived.

For the prompt itself rather than the system around it, see [`wshobson-prompt-engineer`](../wshobson-prompt-engineer/).
