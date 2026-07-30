# Incident Responder (agent · community)

**Why it's here:** during an outage the scarce resource is sequencing, not knowledge. This prompt is structured as a clock — assess, establish command, communicate, mitigate — which is the shape you actually want from an agent at 3am.

> **Referenced, not vendored.** The definition lives in [`wshobson/agents`](https://github.com/wshobson/agents), pinned to commit `c4b82b0`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

One subagent definition — YAML frontmatter plus a prompt, the format Claude Code already reads.

```bash
SHA=c4b82b0ad771190355eb8e204b1329732a18449a
mkdir -p ~/.claude/agents && curl -sL \
  "https://raw.githubusercontent.com/wshobson/agents/$SHA/plugins/incident-response/agents/incident-responder.md" \
  -o ~/.claude/agents/incident-responder.md
```

Scope it to one repo instead by writing to `.claude/agents/` inside it.

**Invoke it by the frontmatter name, not the filename:** this one registers as **`incident-responder`**. Upstream namespaces most of its agents per plugin — this file is one of the handful that does not.

## Details

- **Upstream:** [`plugins/incident-response/agents/incident-responder.md`](https://github.com/wshobson/agents/blob/main/plugins/incident-response/agents/incident-responder.md) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** `c4b82b0ad771190355eb8e204b1329732a18449a`
- **Permissions:** `repository:read`, `filesystem:read`, `filesystem:write`, `shell:exec`, `network:outbound` — declared wide **because the frontmatter carries no `tools:` line**, which in Claude Code means the agent inherits the session's entire tool set, web tools included. Narrow it yourself by adding a `tools:` line after install; compare [`voltagent-qa-expert`](../voltagent-qa-expert/), whose upstream does pin one.
- **Requests model:** `sonnet` in its frontmatter. Change that line if your fleet routes on cost.
- **Related but distinct:** the registry lists the whole [`wshobson-incident-response`](../../workflows/wshobson-incident-response/) plugin as a workflow. That workflow dispatches this agent among others; this manifest pins the single subagent for people who want it on its own.
- **License:** MIT.
- **Measured at pin (2026-07-30):** 38,358 stars · pinned commit 2026-07-18 · repo last push 2026-07-22 · not archived.

Pairs with [`wshobson-devops-troubleshooter`](../wshobson-devops-troubleshooter/) — command and diagnosis are different jobs.
