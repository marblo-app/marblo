# Backend Architect (agent · community)

**Why it's here:** the registry already had an architect for the data layer ([`wshobson-database-architect`](../wshobson-database-architect/)) and none for the layer above it. This is the agent for the decision that outlives the code: where the service boundaries fall, and what contract crosses them.

> **Referenced, not vendored.** The definition lives in [`wshobson/agents`](https://github.com/wshobson/agents), pinned to commit `c4b82b0`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

One subagent definition — YAML frontmatter plus a prompt, the format Claude Code already reads.

```bash
SHA=c4b82b0ad771190355eb8e204b1329732a18449a
mkdir -p ~/.claude/agents && curl -sL \
  "https://raw.githubusercontent.com/wshobson/agents/$SHA/plugins/backend-development/agents/backend-architect.md" \
  -o ~/.claude/agents/backend-architect.md
```

Scope it to one repo instead by writing to `.claude/agents/` inside it.

**Invoke it by the frontmatter name, not the filename:** this one registers as **`backend-development-backend-architect`**. Upstream namespaces its agents per plugin; edit the `name:` line if you would rather type less.

## Details

- **Upstream:** [`plugins/backend-development/agents/backend-architect.md`](https://github.com/wshobson/agents/blob/main/plugins/backend-development/agents/backend-architect.md) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** `c4b82b0ad771190355eb8e204b1329732a18449a`
- **Permissions:** `repository:read`, `filesystem:read`, `filesystem:write`, `shell:exec`, `network:outbound` — declared wide **because the frontmatter carries no `tools:` line**, which in Claude Code means the agent inherits the session's entire tool set, web tools included. Narrow it yourself by adding a `tools:` line after install; compare [`voltagent-qa-expert`](../voltagent-qa-expert/), whose upstream does pin one.
- **Requests model:** `inherit` — it runs on whatever model your session is already using, so cost follows your routing rather than overriding it.
- **What comes with it:** the `backend-development` plugin also carries `event-sourcing-architect`, `graphql-architect`, `security-auditor`, `tdd-orchestrator`, `temporal-python-pro`, `test-automator`, and `performance-engineer`. This manifest pins one file; the siblings sit in the same tree.
- **License:** MIT.
- **Measured at pin (2026-07-30):** 38,358 stars · pinned commit 2026-07-18 · repo last push 2026-07-22 · not archived.

Pairs with [`wshobson-database-architect`](../wshobson-database-architect/) — service contracts above, schema below.
