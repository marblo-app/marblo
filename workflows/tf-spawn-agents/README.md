# Spawn Agents (workflow)

> Decide the lineup from the board, then put it on the field.
>
> Slash command: `/tf-spawn-agents`

1. **Phase 1 — propose the lineup.** Read every ticket and every immediately-workable ticket, group them by role, and show which agent would own what — including the ones that cannot start until a dependency clears.
2. **Phase 2 — spawn.** After your approval, each agent is given its role skill file and its tickets. Non-overlapping `scope` is what makes them safe to run in parallel.
3. **Phase 3 — run the loop.** Each agent claims, moves to IN_PROGRESS, works, logs activities, and submits for review, then picks up the next workable ticket.

## This one is not standalone

Being straight about it: this is a Claude Code slash command whose every step is a call into the **Marblo MCP server**, which ships inside the Marblo app. Copy the files below into a project without that server connected and the command loads fine, then has nothing to call. **This item needs Marblo.**

Concretely, the body calls `get_all_tasks`, `get_available_tasks`, `claim_task`, `update_task_status`, `add_activity`, `submit_for_review`, `get_agent_skill` — the ticket board *is* the state this workflow reads and writes, and there is no portable stand-in for it.

What you can take without installing anything: the procedure itself. `SKILL.md` is the whole thing, in the open — the questions asked, the order they are asked in, the checklists, the output formats. Rebuilding it against your own tracker is a reading job, not a reverse-engineering one.

## The files

| File | Where it goes | What it is |
| --- | --- | --- |
| [`SKILL.md`](SKILL.md) | `.claude/skills/tf-spawn-agents/SKILL.md` | The workflow body — verbatim, as Marblo runs it. |
| [`COMMAND.md`](COMMAND.md) | `.claude/commands/tf-spawn-agents.md` | The slash-command wrapper that makes `/tf-spawn-agents` invoke the skill. |

The wrapper is deliberately thin — it exists so the command is user-invocable and not model-invocable:

```markdown
---
description: "Review tasks, spawn the right agents, and kick off work"
disable-model-invocation: true
---

Invoke the `tf-spawn-agents` skill and follow it exactly as presented to you
```

Previous: [`tf-create-tasks`](../tf-create-tasks/). [`tf-start`](../tf-start/) does creation and spawning in one pass.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Install:** find **Spawn Agents (/tf-spawn-agents)** in the Marblo Store (category: Workflows).
- **Permissions:** `repository:read`, `repository:write`, `shell:exec` — derived from the `allowed-tools` line in `SKILL.md`, not asserted separately.
- **License:** MIT.
