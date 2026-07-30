# Payment Integration (agent · community)

**Why it's here:** payment bugs are the expensive kind, and they cluster in the same three places every time: idempotency, webhook ordering, and what gets logged. This prompt leads with exactly those.

> **Referenced, not vendored.** The definition lives in [`wshobson/agents`](https://github.com/wshobson/agents), pinned to commit `c4b82b0`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

One subagent definition — YAML frontmatter plus a prompt, the format Claude Code already reads.

```bash
SHA=c4b82b0ad771190355eb8e204b1329732a18449a
mkdir -p ~/.claude/agents && curl -sL \
  "https://raw.githubusercontent.com/wshobson/agents/$SHA/plugins/payment-processing/agents/payment-integration.md" \
  -o ~/.claude/agents/payment-integration.md
```

Scope it to one repo instead by writing to `.claude/agents/` inside it.

**Invoke it by the frontmatter name, not the filename:** this one registers as **`payment-integration`**. Upstream namespaces most of its agents per plugin — this file is one of the handful that does not.

## Details

- **Upstream:** [`plugins/payment-processing/agents/payment-integration.md`](https://github.com/wshobson/agents/blob/main/plugins/payment-processing/agents/payment-integration.md) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** `c4b82b0ad771190355eb8e204b1329732a18449a`
- **Permissions:** `repository:read`, `filesystem:read`, `filesystem:write`, `shell:exec`, `network:outbound` — declared wide **because the frontmatter carries no `tools:` line**, which in Claude Code means the agent inherits the session's entire tool set, web tools included. Narrow it yourself by adding a `tools:` line after install; compare [`voltagent-qa-expert`](../voltagent-qa-expert/), whose upstream does pin one.
- **Requests model:** `sonnet` in its frontmatter. Change that line if your fleet routes on cost.
- **Its first rule is a logging rule** — never log sensitive card data — which is the one to verify still holds in whatever it writes for you.
- **License:** MIT.
- **Measured at pin (2026-07-30):** 38,358 stars · pinned commit 2026-07-18 · repo last push 2026-07-22 · not archived.
