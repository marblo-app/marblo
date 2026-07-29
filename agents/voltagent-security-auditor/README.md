# Security Auditor (agent · community)

**Why it's here:** it is the narrowest agent in this registry — `tools: Read, Grep, Glob`, nothing else. An auditor that cannot edit, cannot shell out, and cannot reach the network is one you can point at a repository you do not fully trust, which is precisely when you want an audit.

> **Referenced, not vendored.** The definition lives in [`VoltAgent/awesome-claude-code-subagents`](https://github.com/VoltAgent/awesome-claude-code-subagents), pinned to commit `947b44c`.
>
> **Tier `community` = listed, not installable** in the Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

The upstream repo is a curated list; this is one file out of it, not the list.

```bash
SHA=947b44ca0c58d606b084e9cb1a2389335b49278b
mkdir -p ~/.claude/agents && curl -sL \
  "https://raw.githubusercontent.com/VoltAgent/awesome-claude-code-subagents/$SHA/categories/04-quality-security/security-auditor.md" \
  -o ~/.claude/agents/security-auditor.md
```

Ask for it as **`security-auditor`** — this one's frontmatter name is not namespaced. Note that `wshobson/agents` ships agents by the same name inside several of its plugins; if you have those installed too, the namespaced ones (`comprehensive-review-security-auditor`, `full-stack-orchestration-security-auditor`) are distinct entries and will not collide with this one.

## Details

- **Upstream:** [`categories/04-quality-security/security-auditor.md`](https://github.com/VoltAgent/awesome-claude-code-subagents/blob/main/categories/04-quality-security/security-auditor.md) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** `947b44ca0c58d606b084e9cb1a2389335b49278b`
- **Permissions:** `filesystem:read` — the whole declaration, matching its `tools: Read, Grep, Glob`. It reports; it does not remediate.
- **Requests model:** `inherit` — unlike most agents in this repo it does not pin a tier, so it runs on whatever model your session is already using.
- **One honest caveat:** like its sibling [`voltagent-multi-agent-coordinator`](../voltagent-multi-agent-coordinator/), its prompt opens by querying a _context manager_ agent for security policies and compliance requirements. Nothing breaks without one — it proceeds from what you tell it — but if you say nothing about your compliance regime, its findings will be generic.
- **License:** MIT.
- **Measured at pin (2026-07-29):** 23,821 stars · pinned commit 2026-07-10 · not archived.

For an audit that also _fixes_, see the [`wshobson-security-hardening`](../../workflows/wshobson-security-hardening/) workflow — this agent is the read-only half of that job.
