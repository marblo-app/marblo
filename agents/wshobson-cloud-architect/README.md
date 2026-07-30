# Cloud Architect (agent · community)

**Why it's here:** cloud spend is decided at design time and paid monthly forever. This subagent's prompt puts FinOps and disaster recovery in the same pass as the architecture, which is the only point where changing them is still cheap.

> **Referenced, not vendored.** The definition lives in [`wshobson/agents`](https://github.com/wshobson/agents), pinned to commit `c4b82b0`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

One subagent definition — YAML frontmatter plus a prompt, the format Claude Code already reads.

```bash
SHA=c4b82b0ad771190355eb8e204b1329732a18449a
mkdir -p ~/.claude/agents && curl -sL \
  "https://raw.githubusercontent.com/wshobson/agents/$SHA/plugins/cloud-infrastructure/agents/cloud-architect.md" \
  -o ~/.claude/agents/cloud-architect.md
```

Scope it to one repo instead by writing to `.claude/agents/` inside it.

**Invoke it by the frontmatter name, not the filename:** this one registers as **`cloud-infrastructure-cloud-architect`**. Upstream namespaces its agents per plugin; edit the `name:` line if you would rather type less.

## Details

- **Upstream:** [`plugins/cloud-infrastructure/agents/cloud-architect.md`](https://github.com/wshobson/agents/blob/main/plugins/cloud-infrastructure/agents/cloud-architect.md) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** `c4b82b0ad771190355eb8e204b1329732a18449a`
- **Permissions:** `repository:read`, `filesystem:read`, `filesystem:write`, `shell:exec`, `network:outbound` — declared wide **because the frontmatter carries no `tools:` line**, which in Claude Code means the agent inherits the session's entire tool set, web tools included. Narrow it yourself by adding a `tools:` line after install; compare [`voltagent-qa-expert`](../voltagent-qa-expert/), whose upstream does pin one.
- **Requests model:** `opus` in its frontmatter. Change that line if your fleet routes on cost.
- **Runs on Oracle too:** unusually for an agent of this kind, its capability list names OCI (OKE, Autonomous Database, FastConnect) alongside the big three — relevant if that is where your workloads live.
- **License:** MIT.
- **Measured at pin (2026-07-30):** 38,358 stars · pinned commit 2026-07-18 · repo last push 2026-07-22 · not archived.

For the Kubernetes half of the same problem, see [`wshobson-kubernetes-architect`](../wshobson-kubernetes-architect/); for the IaC that implements the design, [`wshobson-terraform-specialist`](../wshobson-terraform-specialist/).
