# Security Hardening (workflow · community)

**Why it's here:** "run a security review" produces a list; this produces a *layered* pass with a threat model behind it — STRIDE analysis and attack-tree construction ship as skills alongside the command, so the findings have structure instead of vibes.

> **Referenced, not vendored.** Files live in [`wshobson/agents`](https://github.com/wshobson/agents), pinned to commit `c4b82b0`.
>
> **Tier `community` = listed, not installable** in the Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

Three commands, two subagents, five skills:

```bash
SHA=c4b82b0ad771190355eb8e204b1329732a18449a
TMP=$(mktemp -d)
curl -sL "https://codeload.github.com/wshobson/agents/tar.gz/$SHA" \
  | tar -xz -C "$TMP" "agents-$SHA/plugins/security-scanning"
SRC="$TMP/agents-$SHA/plugins/security-scanning"

mkdir -p ~/.claude/commands ~/.claude/agents ~/.claude/skills
cp "$SRC"/commands/*.md ~/.claude/commands/
cp "$SRC"/agents/*.md   ~/.claude/agents/
cp -R "$SRC"/skills/*   ~/.claude/skills/
```

Gives you `/security-hardening`, `/security-sast`, `/security-dependencies`, backed by `security-scanning-security-auditor` and `threat-modeling-expert`, plus the STRIDE, attack-tree, SAST-config, requirement-extraction, and mitigation-mapping skills.

```
--depth quick|standard|comprehensive
--compliance owasp,soc2,gdpr,hipaa,pci-dss
```

## Details

- **Upstream:** [`plugins/security-scanning`](https://github.com/wshobson/agents/tree/main/plugins/security-scanning) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** `c4b82b0ad771190355eb8e204b1329732a18449a`
- **Permissions:** `repository:read`, `filesystem:write`, `shell:exec` — it reads the codebase, runs scanners, and writes findings and remediation into `.security-hardening/`. No `network:outbound` declared: the SAST path is local tooling.
- **What it is not:** a substitute for a security review by a person. It says so itself; we are repeating it because a compliance flag in a CLI is not a compliance attestation.
- **License:** MIT.
- **Measured at pin (2026-07-29):** 38,342 stars · last commit 2026-07-18 · not archived.
