# PM Feedback Loop (workflow)

> The PM's comment reaches the agent that is already mid-ticket.
>
> Slash command: `/tf-feedback`

1. **Step 1 — fetch.** Unread PM feedback, per ticket, with the ticket's current status and when the comment arrived.
2. **Step 2 — reply.** The answer goes on the ticket as an activity, so it stays with the work rather than in a chat window someone has to remember.
3. **Step 3 — acknowledge and apply.** Feedback is marked read, and any change it asks for is folded into the work in progress.

## This one is not standalone

Being straight about it: this is a Claude Code slash command whose every step is a call into the **Marblo MCP server**, which ships inside the Marblo app. Copy the files below into a project without that server connected and the command loads fine, then has nothing to call. **This item needs Marblo.**

Concretely, the body calls `check_feedback`, `acknowledge_feedback`, `add_activity`, `get_task_activities`, `get_all_tasks` — the ticket board *is* the state this workflow reads and writes, and there is no portable stand-in for it.

What you can take without installing anything: the procedure itself. `SKILL.md` is the whole thing, in the open — the questions asked, the order they are asked in, the checklists, the output formats. Rebuilding it against your own tracker is a reading job, not a reverse-engineering one.

## The files

| File | Where it goes | What it is |
| --- | --- | --- |
| [`SKILL.md`](SKILL.md) | `.claude/skills/tf-feedback/SKILL.md` | The workflow body — verbatim, as Marblo runs it. |
| [`COMMAND.md`](COMMAND.md) | `.claude/commands/tf-feedback.md` | The slash-command wrapper that makes `/tf-feedback` invoke the skill. |

The wrapper is deliberately thin — it exists so the command is user-invocable and not model-invocable:

```markdown
---
description: "Check and respond to feedback the PM left on the dashboard. A two-way communication channel."
disable-model-invocation: true
---

Invoke the `tf-feedback` skill and follow it exactly as presented to you
```

Related: [`tf-work`](../tf-work/) checks feedback before submitting; [`tf-review`](../tf-review/) is where most feedback originates.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Install:** find **PM Feedback Loop (/tf-feedback)** in the Marblo Store (category: Workflows).
- **Permissions:** `repository:read`, `repository:write`, `shell:exec` — derived from the `allowed-tools` line in `SKILL.md`, not asserted separately.
- **License:** MIT.
