# Multi-Agent Coordinator (agent · community)

**Why it's here:** it reasons about the failure modes Marblo's engine handles in code — dependency deadlock, partial failure, who owns which file — which makes it the useful thing to think *with* when you are designing a fleet, whether or not you run ours.

> **Referenced, not vendored.** The definition lives in [`VoltAgent/awesome-claude-code-subagents`](https://github.com/VoltAgent/awesome-claude-code-subagents), pinned to commit `947b44c`.
>
> **Tier `community` = listed, not installable** in the Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

The upstream repo is a curated list; this is one file out of it, not the list.

```bash
SHA=947b44ca0c58d606b084e9cb1a2389335b49278b
mkdir -p ~/.claude/agents && curl -sL \
  "https://raw.githubusercontent.com/VoltAgent/awesome-claude-code-subagents/$SHA/categories/09-meta-orchestration/multi-agent-coordinator.md" \
  -o ~/.claude/agents/multi-agent-coordinator.md
```

Ask for it as **`multi-agent-coordinator`** — this one's frontmatter name is not namespaced.

## Details

- **Upstream:** [`categories/09-meta-orchestration/multi-agent-coordinator.md`](https://github.com/VoltAgent/awesome-claude-code-subagents/blob/main/categories/09-meta-orchestration/multi-agent-coordinator.md) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** `947b44ca0c58d606b084e9cb1a2389335b49278b`
- **Permissions:** `filesystem:read`, `filesystem:write` — matching its declared `tools: Read, Write, Edit, Glob, Grep`. No shell, no network.
- **One honest caveat:** its prompt opens by querying a *context manager* agent for workflow state. Nothing breaks without one — it proceeds from what you tell it — but the plan it produces is only as good as the fleet state you hand it.
- **License:** MIT.
- **Measured at pin (2026-07-29):** 23,816 stars · last commit 2026-07-10 · not archived.

For what fleet coordination actually costs in production, see [Fleet Operations](../../knowledge/fleet-operations/KNOWLEDGE.md) — measured, where this agent is prescriptive.
