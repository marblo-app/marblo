# Threat Modeling Expert (agent · community)

**Why it's here:** every security agent in this registry so far audits code that already exists. This one runs before it does — on a diagram, an RFC, or a design doc — which is the only stage where a structural finding is still cheap to act on.

> **Referenced, not vendored.** The definition lives in [`wshobson/agents`](https://github.com/wshobson/agents), pinned to commit `c4b82b0`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

One subagent definition — YAML frontmatter plus a prompt, the format Claude Code already reads.

```bash
SHA=c4b82b0ad771190355eb8e204b1329732a18449a
mkdir -p ~/.claude/agents && curl -sL \
  "https://raw.githubusercontent.com/wshobson/agents/$SHA/plugins/security-scanning/agents/threat-modeling-expert.md" \
  -o ~/.claude/agents/threat-modeling-expert.md
```

Scope it to one repo instead by writing to `.claude/agents/` inside it.

**Invoke it by the frontmatter name, not the filename:** this one registers as **`threat-modeling-expert`**. Upstream namespaces most of its agents per plugin — this file is one of the handful that does not.

## Details

- **Upstream:** [`plugins/security-scanning/agents/threat-modeling-expert.md`](https://github.com/wshobson/agents/blob/main/plugins/security-scanning/agents/threat-modeling-expert.md) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** `c4b82b0ad771190355eb8e204b1329732a18449a`
- **Permissions:** `repository:read`, `filesystem:read`, `filesystem:write`, `shell:exec`, `network:outbound` — declared wide **because the frontmatter carries no `tools:` line**, which in Claude Code means the agent inherits the session's entire tool set, web tools included. Narrow it yourself by adding a `tools:` line after install; compare [`voltagent-qa-expert`](../voltagent-qa-expert/), whose upstream does pin one.
- **Requests model:** `opus` in its frontmatter. Change that line if your fleet routes on cost.
- **Shorter than it looks:** unlike most agents in this batch its body is a capability list rather than a long playbook, so expect it to follow your framing of the system closely. Give it a real data-flow description and it earns its keep; give it a one-liner and it will generalise.
- **License:** MIT.
- **Measured at pin (2026-07-30):** 38,358 stars · pinned commit 2026-07-18 · repo last push 2026-07-22 · not archived.

The read-only code-side counterpart is [`voltagent-security-auditor`](../voltagent-security-auditor/); the remediation-side one is the [`wshobson-security-hardening`](../../workflows/wshobson-security-hardening/) workflow.
