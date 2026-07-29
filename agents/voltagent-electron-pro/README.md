# Electron Pro (agent · community)

**Why it's here:** desktop agent tooling is where a lot of this ecosystem actually runs, and Electron has a specific failure surface — a renderer with `nodeIntegration` on, an IPC channel that forwards whatever it is handed, an unsigned build that macOS quarantines. Its checklist opens on exactly those, not on "how to make a window."

> **Referenced, not vendored.** The definition lives in [`VoltAgent/awesome-claude-code-subagents`](https://github.com/VoltAgent/awesome-claude-code-subagents), pinned to commit `947b44c`.
>
> **Tier `community` = listed, not installable** in the Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

The upstream repo is a curated list; this is one file out of it, not the list.

```bash
SHA=947b44ca0c58d606b084e9cb1a2389335b49278b
mkdir -p ~/.claude/agents && curl -sL \
  "https://raw.githubusercontent.com/VoltAgent/awesome-claude-code-subagents/$SHA/categories/01-core-development/electron-pro.md" \
  -o ~/.claude/agents/electron-pro.md
```

Ask for it as **`electron-pro`** — this one's frontmatter name is not namespaced.

## Details

- **Upstream:** [`categories/01-core-development/electron-pro.md`](https://github.com/VoltAgent/awesome-claude-code-subagents/blob/main/categories/01-core-development/electron-pro.md) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** `947b44ca0c58d606b084e9cb1a2389335b49278b`
- **Permissions:** `filesystem:read`, `filesystem:write`, `shell:exec` — matching its declared `tools: Read, Write, Edit, Bash, Glob, Grep`. It builds and packages, so it runs commands. No network declared: signing and notarization credentials stay yours to supply.
- **Requests model:** `sonnet` in its frontmatter.
- **Two honest caveats:** (1) its prompt targets **Electron 27+**, and Electron moves fast — treat its version-specific advice as a starting point, not as current API truth at whatever version you are on. (2) Like its siblings here, it opens by querying a _context manager_ agent for OS targets and requirements; without one it proceeds from what you tell it.
- **License:** MIT.
- **Measured at pin (2026-07-29):** 23,821 stars · pinned commit 2026-07-10 · not archived.

Pairs with [`anthropic-webapp-testing`](../../skills/anthropic-webapp-testing/) when the renderer needs to be driven in a real browser context.
