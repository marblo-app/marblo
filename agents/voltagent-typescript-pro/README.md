# TypeScript Pro (agent · community)

**Why it's here:** Marblo's own app is TypeScript in strict mode, and the hard parts are never syntax — they are the generic that will not narrow and the boundary where types stop being checked. That is this agent's whole subject.

> **Referenced, not vendored.** The definition lives in [`VoltAgent/awesome-claude-code-subagents`](https://github.com/VoltAgent/awesome-claude-code-subagents), pinned to commit `947b44c`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

The upstream repo is a curated collection; this is one file out of it, not the collection.

```bash
SHA=947b44ca0c58d606b084e9cb1a2389335b49278b
mkdir -p ~/.claude/agents && curl -sL \
  "https://raw.githubusercontent.com/VoltAgent/awesome-claude-code-subagents/$SHA/categories/02-language-specialists/typescript-pro.md" \
  -o ~/.claude/agents/typescript-pro.md
```

Ask for it as **`typescript-pro`** — VoltAgent does not namespace its frontmatter names, so the invocation name matches the filename.

## Details

- **Upstream:** [`categories/02-language-specialists/typescript-pro.md`](https://github.com/VoltAgent/awesome-claude-code-subagents/blob/main/categories/02-language-specialists/typescript-pro.md) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** `947b44ca0c58d606b084e9cb1a2389335b49278b`
- **Permissions:** `filesystem:read`, `filesystem:write`, `shell:exec` — matching its `tools: Read, Write, Edit, Bash, Glob, Grep`. It edits code and runs your toolchain; it has no network tool.
- **Requests model:** `sonnet` in its frontmatter.
- **Expects a context manager:** its prompt's first step is to query a *context manager* agent for existing TypeScript configuration and project setup. Nothing breaks without one — it falls back to what you tell it — but the more you state up front, the less generic the output. [`voltagent-context-manager`](../voltagent-context-manager/) is that companion agent.
- **License:** MIT.
- **Measured at pin (2026-07-30):** 23,847 stars · pinned commit 2026-07-10 · not archived.
