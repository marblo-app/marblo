# SRE Engineer (agent · community)

**Why it's here:** reliability outside an incident is a budgeting problem, not a firefighting one. This agent works on the artefacts that exist between outages — SLOs, error budgets, and the toil list — which nothing else in the registry covered.

> **Referenced, not vendored.** The definition lives in [`VoltAgent/awesome-claude-code-subagents`](https://github.com/VoltAgent/awesome-claude-code-subagents), pinned to commit `947b44c`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

The upstream repo is a curated collection; this is one file out of it, not the collection.

```bash
SHA=947b44ca0c58d606b084e9cb1a2389335b49278b
mkdir -p ~/.claude/agents && curl -sL \
  "https://raw.githubusercontent.com/VoltAgent/awesome-claude-code-subagents/$SHA/categories/03-infrastructure/sre-engineer.md" \
  -o ~/.claude/agents/sre-engineer.md
```

Ask for it as **`sre-engineer`** — VoltAgent does not namespace its frontmatter names, so the invocation name matches the filename.

## Details

- **Upstream:** [`categories/03-infrastructure/sre-engineer.md`](https://github.com/VoltAgent/awesome-claude-code-subagents/blob/main/categories/03-infrastructure/sre-engineer.md) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** `947b44ca0c58d606b084e9cb1a2389335b49278b`
- **Permissions:** `filesystem:read`, `filesystem:write`, `shell:exec` — matching its `tools: Read, Write, Edit, Bash, Glob, Grep`. It edits code and runs your toolchain; it has no network tool.
- **Requests model:** `sonnet` in its frontmatter.
- **Expects a context manager:** its prompt's first step is to query a *context manager* agent for service architecture and reliability requirements. Nothing breaks without one — it falls back to what you tell it — but the more you state up front, the less generic the output. [`voltagent-context-manager`](../voltagent-context-manager/) is that companion agent.
- **License:** MIT.
- **Measured at pin (2026-07-30):** 23,847 stars · pinned commit 2026-07-10 · not archived.

During the outage itself, use [`wshobson-incident-responder`](../wshobson-incident-responder/).
