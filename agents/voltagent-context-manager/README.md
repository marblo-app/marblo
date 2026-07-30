# Context Manager (agent · community)

**Why it's here:** it is the dependency the rest of this family assumes. Nearly every VoltAgent subagent opens by *querying a context manager*; without one installed, they proceed from whatever you happened to type. Installing this makes those handoff lines resolve to something.

> **Referenced, not vendored.** The definition lives in [`VoltAgent/awesome-claude-code-subagents`](https://github.com/VoltAgent/awesome-claude-code-subagents), pinned to commit `947b44c`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

The upstream repo is a curated collection; this is one file out of it, not the collection.

```bash
SHA=947b44ca0c58d606b084e9cb1a2389335b49278b
mkdir -p ~/.claude/agents && curl -sL \
  "https://raw.githubusercontent.com/VoltAgent/awesome-claude-code-subagents/$SHA/categories/09-meta-orchestration/context-manager.md" \
  -o ~/.claude/agents/context-manager.md
```

Ask for it as **`context-manager`** — VoltAgent does not namespace its frontmatter names, so the invocation name matches the filename.

## Details

- **Upstream:** [`categories/09-meta-orchestration/context-manager.md`](https://github.com/VoltAgent/awesome-claude-code-subagents/blob/main/categories/09-meta-orchestration/context-manager.md) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** `947b44ca0c58d606b084e9cb1a2389335b49278b`
- **Permissions:** `filesystem:read`, `filesystem:write` — matching its `tools: Read, Write, Edit, Glob, Grep`. No `Bash`, so it never shells out; no network tool either.
- **Requests model:** `sonnet` in its frontmatter.
- **This is the companion the others query.** Its own first step queries the *system* rather than another agent, so it has no upstream dependency of its own.
- **License:** MIT.
- **Measured at pin (2026-07-30):** 23,847 stars · pinned commit 2026-07-10 · not archived.

Not to be confused with the wshobson agent of the same role inside [`wshobson-context-management`](../../workflows/wshobson-context-management/) — same idea, different prompt, different frontmatter name (`context-management-context-manager`).
