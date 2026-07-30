# Pause and Take Stock (workflow)

> Stop, look at the whole board, then decide — instead of pushing on.
>
> Slash command: `/tf-hold`

1. **Step 1 — snapshot.** Every ticket grouped by status, with the counts that make the shape of the problem visible.
2. **Step 2 — surface what is stuck.** In-progress work with no recent activity, failed and blocked tickets, and unread PM feedback.
3. **Step 3 — decide.** The pause is recorded on the board so the next session starts from a written state rather than a guess.

## This one is not standalone

Being straight about it: this is a Claude Code slash command whose every step is a call into the **Marblo MCP server**, which ships inside the Marblo app. Copy the files below into a project without that server connected and the command loads fine, then has nothing to call. **This item needs Marblo.**

Concretely, the body calls `get_all_tasks`, `get_task_activities`, `check_feedback`, `add_activity` — the ticket board *is* the state this workflow reads and writes, and there is no portable stand-in for it.

What you can take without installing anything: the procedure itself. `SKILL.md` is the whole thing, in the open — the questions asked, the order they are asked in, the checklists, the output formats. Rebuilding it against your own tracker is a reading job, not a reverse-engineering one.

## The files

| File | Where it goes | What it is |
| --- | --- | --- |
| [`SKILL.md`](SKILL.md) | `.claude/skills/tf-hold/SKILL.md` | The workflow body — verbatim, as Marblo runs it. |
| [`COMMAND.md`](COMMAND.md) | `.claude/commands/tf-hold.md` | The slash-command wrapper that makes `/tf-hold` invoke the skill. |

The wrapper is deliberately thin — it exists so the command is user-invocable and not model-invocable:

```markdown
---
description: "Pause work and tidy up the current state. Use it when things get confusing or you need to change direction."
disable-model-invocation: true
---

Invoke the `tf-hold` skill and follow it exactly as presented to you
```

Related: [`tf-sync`](../tf-sync/) if the board is merely out of date, [`tf-handoff`](../tf-handoff/) if one ticket is the problem.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Install:** find **Pause and Take Stock (/tf-hold)** in the Marblo Store (category: Workflows).
- **Permissions:** `repository:read`, `shell:exec` — derived from the `allowed-tools` line in `SKILL.md`, not asserted separately.
- **License:** MIT.
