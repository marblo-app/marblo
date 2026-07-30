# Terraform Specialist (agent · community)

**Why it's here:** state is the part of infrastructure-as-code that breaks in ways `plan` will not warn you about. This agent's prompt treats backends, locking, encryption, and workspace strategy as first-class subjects rather than setup trivia.

> **Referenced, not vendored.** The definition lives in [`wshobson/agents`](https://github.com/wshobson/agents), pinned to commit `c4b82b0`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

One subagent definition — YAML frontmatter plus a prompt, the format Claude Code already reads.

```bash
SHA=c4b82b0ad771190355eb8e204b1329732a18449a
mkdir -p ~/.claude/agents && curl -sL \
  "https://raw.githubusercontent.com/wshobson/agents/$SHA/plugins/cicd-automation/agents/terraform-specialist.md" \
  -o ~/.claude/agents/terraform-specialist.md
```

Scope it to one repo instead by writing to `.claude/agents/` inside it.

**Invoke it by the frontmatter name, not the filename:** this one registers as **`cicd-automation-terraform-specialist`**. Upstream namespaces its agents per plugin; edit the `name:` line if you would rather type less.

## Details

- **Upstream:** [`plugins/cicd-automation/agents/terraform-specialist.md`](https://github.com/wshobson/agents/blob/main/plugins/cicd-automation/agents/terraform-specialist.md) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** `c4b82b0ad771190355eb8e204b1329732a18449a`
- **Permissions:** `repository:read`, `filesystem:read`, `filesystem:write`, `shell:exec`, `network:outbound` — declared wide **because the frontmatter carries no `tools:` line**, which in Claude Code means the agent inherits the session's entire tool set, web tools included. Narrow it yourself by adding a `tools:` line after install; compare [`voltagent-qa-expert`](../voltagent-qa-expert/), whose upstream does pin one.
- **Requests model:** `opus` in its frontmatter. Change that line if your fleet routes on cost.
- **OpenTofu-aware:** it names migration paths off Terraform explicitly, which matters if the licence change pushed you off HashiCorp's distribution.
- **License:** MIT.
- **Measured at pin (2026-07-30):** 38,358 stars · pinned commit 2026-07-18 · repo last push 2026-07-22 · not archived.

Sits downstream of [`wshobson-cloud-architect`](../wshobson-cloud-architect/): one decides the topology, this one writes it down in HCL.
