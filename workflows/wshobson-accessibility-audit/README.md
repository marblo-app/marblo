# Accessibility Audit (workflow · community)

**Why it's here:** accessibility is the compliance area most often deferred until a customer complains, and the automated half is genuinely automatable. This pipeline runs that half properly and is explicit that the rest — keyboard paths, screen-reader output — still has to be verified by hand.

> **Referenced, not vendored.** Files live in [`wshobson/agents`](https://github.com/wshobson/agents), pinned to commit `c4b82b0`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

The plugin is the `accessibility-audit` command, the `ui-visual-validator` agent, and two skills (`wcag-audit-patterns`, `screen-reader-testing`). Install the parts together — the commands dispatch the agents by their namespaced frontmatter names.

```bash
SHA=c4b82b0ad771190355eb8e204b1329732a18449a
TMP=$(mktemp -d)
curl -sL "https://codeload.github.com/wshobson/agents/tar.gz/$SHA" \
  | tar -xz -C "$TMP" "agents-$SHA/plugins/accessibility-compliance"
SRC="$TMP/agents-$SHA/plugins/accessibility-compliance"

mkdir -p ~/.claude/commands ~/.claude/agents
cp "$SRC"/commands/*.md ~/.claude/commands/
cp "$SRC"/agents/*.md   ~/.claude/agents/
mkdir -p ~/.claude/skills
cp -R "$SRC"/skills/*     ~/.claude/skills/
```

## Details

- **Upstream:** [`plugins/accessibility-compliance`](https://github.com/wshobson/agents/tree/main/plugins/accessibility-compliance) · **Manifest:** [`marblo.yaml`](marblo.yaml) · plugin version `1.2.3` at the pin
- **Pinned to:** `c4b82b0ad771190355eb8e204b1329732a18449a` (no release tags upstream)
- **Permissions:** `repository:read`, `filesystem:write`, `shell:exec`, `network:outbound` — the audit script launches a browser against a URL and writes a report, so it both shells out and reaches the network.
- **It expects a JavaScript toolchain.** The command's audit harness is `@axe-core/puppeteer` plus `puppeteer`; on a repo without Node those steps cannot run and you are left with the manual checklist.
- **The command file has no YAML frontmatter**, so it contributes no description to the slash-command list — the same cosmetic quirk as [`wshobson-context-management`](../wshobson-context-management/).
- **`ui-visual-validator` requests `sonnet`** and works from screenshots, which means it needs images supplied to it rather than taking them itself.
- **License:** MIT.
- **Measured at pin (2026-07-30):** 38,358 stars · pinned commit 2026-07-18 · repo last push 2026-07-22 · not archived.

The read-only agent form, cheaper and with no browser required, is [`voltagent-accessibility-tester`](../../agents/voltagent-accessibility-tester/).
