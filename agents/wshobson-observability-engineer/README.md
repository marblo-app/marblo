# Observability Engineer (agent · community)

**Why it's here:** the counterpart to the troubleshooter — one diagnoses the outage, this one makes the next outage visible before a user reports it.

> **Referenced, not vendored.** The definition lives in [`wshobson/agents`](https://github.com/wshobson/agents), pinned to commit `c4b82b0`.
>
> **Tier `community` = listed, not installable** in the Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

```bash
SHA=c4b82b0ad771190355eb8e204b1329732a18449a
mkdir -p ~/.claude/agents && curl -sL \
  "https://raw.githubusercontent.com/wshobson/agents/$SHA/plugins/application-performance/agents/observability-engineer.md" \
  -o ~/.claude/agents/observability-engineer.md
```

**Invoke it as `application-performance-observability-engineer`** — the frontmatter `name:` is plugin-namespaced upstream and that is what the harness registers. Rename the `name:` line if you prefer.

## Details

- **Upstream:** [`plugins/application-performance/agents/observability-engineer.md`](https://github.com/wshobson/agents/blob/main/plugins/application-performance/agents/observability-engineer.md) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** `c4b82b0ad771190355eb8e204b1329732a18449a`
- **Permissions:** `repository:read`, `filesystem:write`, `shell:exec`, `network:outbound` — unlike the troubleshooter it *writes*: dashboards, exporter config, alert rules.
- **Requests model:** `inherit` — it takes whatever your session is running.
- **License:** MIT.
- **Measured at pin (2026-07-29):** 38,342 stars · last commit 2026-07-18 · not archived.

Pairs with [`wshobson-devops-troubleshooter`](../wshobson-devops-troubleshooter/) and the [`wshobson-incident-response`](../../workflows/wshobson-incident-response/) workflow.
