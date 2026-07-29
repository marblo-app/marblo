# Incident Response (workflow · community)

**Why it's here:** during an incident the failure is coordination, not knowledge — this encodes severity triage, parallel investigation across specialists, and the postmortem, so the sequence exists before you need it.

> **Referenced, not vendored.** Files live in [`wshobson/agents`](https://github.com/wshobson/agents), pinned to commit `c4b82b0`.
>
> **Tier `community` = listed, not installable** in the Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

A slash command, six subagents it dispatches, and three companion skills (runbook templates, on-call handoff, postmortem writing). Install all three parts:

```bash
SHA=c4b82b0ad771190355eb8e204b1329732a18449a
TMP=$(mktemp -d)
curl -sL "https://codeload.github.com/wshobson/agents/tar.gz/$SHA" \
  | tar -xz -C "$TMP" "agents-$SHA/plugins/incident-response"
SRC="$TMP/agents-$SHA/plugins/incident-response"

mkdir -p ~/.claude/commands ~/.claude/agents ~/.claude/skills
cp "$SRC"/commands/*.md ~/.claude/commands/
cp "$SRC"/agents/*.md   ~/.claude/agents/
cp -R "$SRC"/skills/*   ~/.claude/skills/
```

Gives you `/incident-response` and `/smart-fix`. The command dispatches `incident-responder`, `incident-response-debugger`, and `incident-response-devops-troubleshooter` by their frontmatter names — all three come from the `agents/` copy above, which is why it is not optional.

## Details

- **Upstream:** [`plugins/incident-response`](https://github.com/wshobson/agents/tree/main/plugins/incident-response) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** `c4b82b0ad771190355eb8e204b1329732a18449a`
- **Permissions:** `repository:read`, `filesystem:write`, `shell:exec`, `network:outbound` — it reads logs and metrics endpoints, runs diagnostics, and writes `.incident-response/` plus the postmortem.
- **Read this before you run it in anger:** the command's own rules tell it to halt at phase checkpoints and wait for approval. Point it at production only if you accept that the mitigation phase proposes changes to a live system.
- **License:** MIT.
- **Measured at pin (2026-07-29):** 38,342 stars · last commit 2026-07-18 · not archived.

Pairs with the [`wshobson-devops-troubleshooter`](../../agents/wshobson-devops-troubleshooter/) agent for one-off debugging when a full incident run is more ceremony than you need.
