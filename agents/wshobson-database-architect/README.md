# Database Architect (agent · community)

**Why it's here:** the registry had agents for diagnosing production and reviewing code, and none for the decision that is hardest to reverse later — which engine, which schema, which migration path. This is a subagent whose whole prompt is that decision, before the first table exists.

> **Referenced, not vendored.** The definition lives in [`wshobson/agents`](https://github.com/wshobson/agents), pinned to commit `c4b82b0`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

A single subagent definition — YAML frontmatter plus a prompt, the format Claude Code already reads.

```bash
SHA=c4b82b0ad771190355eb8e204b1329732a18449a
mkdir -p ~/.claude/agents && curl -sL \
  "https://raw.githubusercontent.com/wshobson/agents/$SHA/plugins/database-design/agents/database-architect.md" \
  -o ~/.claude/agents/database-architect.md
```

Scope it to one repo instead by writing to `.claude/agents/` inside it.

**Then ask for it by the name in the frontmatter, not the filename.** Upstream namespaces its agents per plugin, so this one registers as **`database-design-database-architect`**. Edit the `name:` line to `database-architect` if you would rather type less — it is the only line that matters for invocation.

## Details

- **Upstream:** [`plugins/database-design/agents/database-architect.md`](https://github.com/wshobson/agents/blob/main/plugins/database-design/agents/database-architect.md) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** `c4b82b0ad771190355eb8e204b1329732a18449a`
- **Permissions:** `repository:read`, `filesystem:read`, `filesystem:write`, `shell:exec` — declared wide **because the frontmatter declares no `tools:` line at all**, which in Claude Code means the agent inherits the full tool set rather than a restricted one. Compare [`voltagent-security-auditor`](../voltagent-security-auditor/), which pins itself to `Read, Grep, Glob` and gets a correspondingly narrow declaration. Narrow it yourself by adding a `tools:` line after install.
- **Requests model:** `opus` in its frontmatter — the most expensive default of any agent in this registry. Change it if your fleet routes on cost.
- **What it does not ship with:** the upstream plugin also contains a `sql-pro` agent and a `postgresql` skill. This manifest pins the one file above; grab the siblings from the same tree if you want them.
- **License:** MIT.
- **Measured at pin (2026-07-29):** 38,347 stars · pinned commit 2026-07-18 · not archived.
