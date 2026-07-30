# Manual Handoff (workflow)

> Some tickets are faster to finish yourself. This is how to pick them up cleanly.
>
> Slash command: `/tf-handoff`

1. **Find the candidates.** FAILED, BLOCKED, and IN_PROGRESS tickets that have gone stale — an agent that stopped without failing looks identical to one that is thinking, so the activity log is what distinguishes them.
2. **Read what was left.** The activity log says how far the agent got; the files on disk say what state it left them in. Handoff continues on top of that work rather than restarting it.
3. **Load the same rules.** The role's skill file is loaded so the takeover follows the conventions the ticket was written against.
4. **Finish and record.** Work is logged as a manual handoff, then submitted for review like any other ticket.
5. **When to take over at all** — three criteria are written down: the same ticket failed three or more times, the work needs environment setup (API keys, external service wiring), or it needs files outside the agent's `scope`.

## This one is not standalone

Being straight about it: this is a Claude Code slash command whose every step is a call into the **Marblo MCP server**, which ships inside the Marblo app. Copy the files below into a project without that server connected and the command loads fine, then has nothing to call. **This item needs Marblo.**

Concretely, the body calls `get_all_tasks`, `get_task_activities`, `update_task_status`, `claim_task`, `add_activity`, `submit_for_review`, `get_agent_skill` — the ticket board *is* the state this workflow reads and writes, and there is no portable stand-in for it.

What you can take without installing anything: the procedure itself. `SKILL.md` is the whole thing, in the open — the questions asked, the order they are asked in, the checklists, the output formats. Rebuilding it against your own tracker is a reading job, not a reverse-engineering one.

## The files

| File | Where it goes | What it is |
| --- | --- | --- |
| [`SKILL.md`](SKILL.md) | `.claude/skills/tf-handoff/SKILL.md` | The workflow body — verbatim, as Marblo runs it. |
| [`COMMAND.md`](COMMAND.md) | `.claude/commands/tf-handoff.md` | The slash-command wrapper that makes `/tf-handoff` invoke the skill. |

The wrapper is deliberately thin — it exists so the command is user-invocable and not model-invocable:

```markdown
---
description: "Take over a task an agent failed and finish it yourself"
disable-model-invocation: true
---

Invoke the `tf-handoff` skill and follow it exactly as presented to you
```

Related: [`tf-hold`](../tf-hold/) to survey the whole board first.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Install:** find **Manual Handoff (/tf-handoff)** in the Marblo Store (category: Workflows).
- **Permissions:** `repository:read`, `repository:write`, `shell:exec` — derived from the `allowed-tools` line in `SKILL.md`, not asserted separately.
- **License:** MIT.
