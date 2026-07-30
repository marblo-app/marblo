# Accessibility Tester (agent · community)

**Why it's here:** accessibility work is mostly a checklist nobody has time to run. This agent is cheap enough to run often — it is the only one in this batch that pins `haiku` — and read-only, so it reports without touching your markup.

> **Referenced, not vendored.** The definition lives in [`VoltAgent/awesome-claude-code-subagents`](https://github.com/VoltAgent/awesome-claude-code-subagents), pinned to commit `947b44c`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

The upstream repo is a curated collection; this is one file out of it, not the collection.

```bash
SHA=947b44ca0c58d606b084e9cb1a2389335b49278b
mkdir -p ~/.claude/agents && curl -sL \
  "https://raw.githubusercontent.com/VoltAgent/awesome-claude-code-subagents/$SHA/categories/04-quality-security/accessibility-tester.md" \
  -o ~/.claude/agents/accessibility-tester.md
```

Ask for it as **`accessibility-tester`** — VoltAgent does not namespace its frontmatter names, so the invocation name matches the filename.

## Details

- **Upstream:** [`categories/04-quality-security/accessibility-tester.md`](https://github.com/VoltAgent/awesome-claude-code-subagents/blob/main/categories/04-quality-security/accessibility-tester.md) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** `947b44ca0c58d606b084e9cb1a2389335b49278b`
- **Permissions:** `filesystem:read`, `shell:exec` — matching its `tools: Read, Grep, Glob, Bash`. It reads and runs, but cannot edit a file — findings come back as a report, not a patch.
- **Requests model:** `haiku` in its frontmatter.
- **Expects a context manager:** its prompt's first step is to query a *context manager* agent for application structure and accessibility requirements. Nothing breaks without one — it falls back to what you tell it — but the more you state up front, the less generic the output. [`voltagent-context-manager`](../voltagent-context-manager/) is that companion agent.
- **License:** MIT.
- **Measured at pin (2026-07-30):** 23,847 stars · pinned commit 2026-07-10 · not archived.

The workflow form, with axe-core automation attached, is [`wshobson-accessibility-audit`](../../workflows/wshobson-accessibility-audit/).
