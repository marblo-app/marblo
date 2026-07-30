# Error Detective (agent · community)

**Why it's here:** the failure you can reproduce locally is the easy one. This agent starts from symptoms in aggregated logs and works backward, including correlating error onset against deployments — the question every production investigation eventually reaches.

> **Referenced, not vendored.** The definition lives in [`wshobson/agents`](https://github.com/wshobson/agents), pinned to commit `c4b82b0`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

One subagent definition — YAML frontmatter plus a prompt, the format Claude Code already reads.

```bash
SHA=c4b82b0ad771190355eb8e204b1329732a18449a
mkdir -p ~/.claude/agents && curl -sL \
  "https://raw.githubusercontent.com/wshobson/agents/$SHA/plugins/distributed-debugging/agents/error-detective.md" \
  -o ~/.claude/agents/error-detective.md
```

Scope it to one repo instead by writing to `.claude/agents/` inside it.

**Invoke it by the frontmatter name, not the filename:** this one registers as **`distributed-debugging-error-detective`**. Upstream namespaces its agents per plugin; edit the `name:` line if you would rather type less.

## Details

- **Upstream:** [`plugins/distributed-debugging/agents/error-detective.md`](https://github.com/wshobson/agents/blob/main/plugins/distributed-debugging/agents/error-detective.md) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** `c4b82b0ad771190355eb8e204b1329732a18449a`
- **Permissions:** `repository:read`, `filesystem:read`, `filesystem:write`, `shell:exec`, `network:outbound` — declared wide **because the frontmatter carries no `tools:` line**, which in Claude Code means the agent inherits the session's entire tool set, web tools included. Narrow it yourself by adding a `tools:` line after install; compare [`voltagent-qa-expert`](../voltagent-qa-expert/), whose upstream does pin one.
- **Requests model:** `sonnet` in its frontmatter. Change that line if your fleet routes on cost.
- **Query-language literate:** its prompt names Elasticsearch and Splunk query shapes directly, so it is most useful when you already have log aggregation and least useful when you do not.
- **License:** MIT.
- **Measured at pin (2026-07-30):** 38,358 stars · pinned commit 2026-07-18 · repo last push 2026-07-22 · not archived.

Reads the evidence; [`wshobson-debugger`](../wshobson-debugger/) fixes the code.
