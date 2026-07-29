# DevOps Troubleshooter (agent · community)

**Why it's here:** the registry had a reviewer for code and nothing for the 3 a.m. problem — this is a subagent whose whole prompt is log-to-trace-to-cause under time pressure.

> **Referenced, not vendored.** The definition lives in [`wshobson/agents`](https://github.com/wshobson/agents), pinned to commit `c4b82b0`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

A single subagent definition — YAML frontmatter plus a prompt, the format Claude Code already reads.

```bash
SHA=c4b82b0ad771190355eb8e204b1329732a18449a
mkdir -p ~/.claude/agents && curl -sL \
  "https://raw.githubusercontent.com/wshobson/agents/$SHA/plugins/cicd-automation/agents/devops-troubleshooter.md" \
  -o ~/.claude/agents/devops-troubleshooter.md
```

Scope it to one repo instead by writing to `.claude/agents/` inside it.

**Then ask for it by the name in the frontmatter, not the filename.** Upstream namespaces its agents per plugin, so this one registers as **`cicd-automation-devops-troubleshooter`**. Edit the `name:` line to `devops-troubleshooter` if you would rather type less — it is the only line that matters for invocation.

## Details

- **Upstream:** [`plugins/cicd-automation/agents/devops-troubleshooter.md`](https://github.com/wshobson/agents/blob/main/plugins/cicd-automation/agents/devops-troubleshooter.md) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** `c4b82b0ad771190355eb8e204b1329732a18449a`
- **Permissions:** `repository:read`, `filesystem:read`, `shell:exec`, `network:outbound` — it reads logs, runs diagnostic commands, and queries observability backends. It is a *diagnosis* agent; it does not declare repository write.
- **Requests model:** `sonnet` in its frontmatter. Change it if your fleet routes differently.
- **License:** MIT.
- **Measured at pin (2026-07-29):** 38,342 stars · last commit 2026-07-18 · not archived.
