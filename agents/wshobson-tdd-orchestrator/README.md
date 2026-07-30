# TDD Orchestrator (agent · community)

**Why it's here:** TDD fails in fleets for a boring reason: nobody checks that the test came first. This agent's job is that check, plus the coordination that makes the discipline survive more than one agent writing code at once.

> **Referenced, not vendored.** The definition lives in [`wshobson/agents`](https://github.com/wshobson/agents), pinned to commit `c4b82b0`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

One subagent definition — YAML frontmatter plus a prompt, the format Claude Code already reads.

```bash
SHA=c4b82b0ad771190355eb8e204b1329732a18449a
mkdir -p ~/.claude/agents && curl -sL \
  "https://raw.githubusercontent.com/wshobson/agents/$SHA/plugins/tdd-workflows/agents/tdd-orchestrator.md" \
  -o ~/.claude/agents/tdd-orchestrator.md
```

Scope it to one repo instead by writing to `.claude/agents/` inside it.

**Invoke it by the frontmatter name, not the filename:** this one registers as **`tdd-workflows-tdd-orchestrator`**. Upstream namespaces its agents per plugin; edit the `name:` line if you would rather type less.

## Details

- **Upstream:** [`plugins/tdd-workflows/agents/tdd-orchestrator.md`](https://github.com/wshobson/agents/blob/main/plugins/tdd-workflows/agents/tdd-orchestrator.md) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** `c4b82b0ad771190355eb8e204b1329732a18449a`
- **Permissions:** `repository:read`, `filesystem:read`, `filesystem:write`, `shell:exec`, `network:outbound` — declared wide **because the frontmatter carries no `tools:` line**, which in Claude Code means the agent inherits the session's entire tool set, web tools included. Narrow it yourself by adding a `tools:` line after install; compare [`voltagent-qa-expert`](../voltagent-qa-expert/), whose upstream does pin one.
- **Requests model:** `opus` in its frontmatter. Change that line if your fleet routes on cost.
- **Pins `opus`,** the most expensive tier — worth weighing against how often it runs, since a governance agent fires on every task rather than once.
- **License:** MIT.
- **Measured at pin (2026-07-30):** 38,358 stars · pinned commit 2026-07-18 · repo last push 2026-07-22 · not archived.

The [`wshobson-tdd-cycle`](../../workflows/wshobson-tdd-cycle/) workflow is the slash-command form of the same plugin; this is the subagent it leans on.
