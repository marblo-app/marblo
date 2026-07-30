# Work a Task (workflow)

> One ticket, claimed to submitted, with the log written as you go.
>
> Slash command: `/tf-work`

1. **Step 1 — select.** The workable tickets are listed with role and priority, and one is recommended. Only tickets whose dependencies are already satisfied appear.
2. **Step 2 — start.** Claim the ticket, move it to IN_PROGRESS, load the role's skill file, and read the `scope` field so the working area is known before any file is touched.
3. **Step 3 — code and log.** Activities are written as the work happens, not reconstructed afterwards: file created, major logic done, test written, test run, issue hit, decision made. The format is `[action] [target] — [details]`.
4. **Step 4 — submit.** Check the skill file's completion criteria, check for PM feedback, then submit for review with the deliverable list and the test result.

## This one is not standalone

Being straight about it: this is a Claude Code slash command whose every step is a call into the **Marblo MCP server**, which ships inside the Marblo app. Copy the files below into a project without that server connected and the command loads fine, then has nothing to call. **This item needs Marblo.**

Concretely, the body calls `get_available_tasks`, `claim_task`, `update_task_status`, `add_activity`, `submit_for_review`, `check_feedback`, `get_task_activities`, `get_agent_skill` — the ticket board *is* the state this workflow reads and writes, and there is no portable stand-in for it.

What you can take without installing anything: the procedure itself. `SKILL.md` is the whole thing, in the open — the questions asked, the order they are asked in, the checklists, the output formats. Rebuilding it against your own tracker is a reading job, not a reverse-engineering one.

## The files

| File | Where it goes | What it is |
| --- | --- | --- |
| [`SKILL.md`](SKILL.md) | `.claude/skills/tf-work/SKILL.md` | The workflow body — verbatim, as Marblo runs it. |
| [`COMMAND.md`](COMMAND.md) | `.claude/commands/tf-work.md` | The slash-command wrapper that makes `/tf-work` invoke the skill. |

The wrapper is deliberately thin — it exists so the command is user-invocable and not model-invocable:

```markdown
---
description: "Claim a task, code per the skill-file rules, and auto-log progress as you go"
disable-model-invocation: true
---

Invoke the `tf-work` skill and follow it exactly as presented to you
```

Next: [`tf-review`](../tf-review/) is the gate the submission lands in. If the ticket cannot be finished, [`tf-handoff`](../tf-handoff/).

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Install:** find **Work a Task (/tf-work)** in the Marblo Store (category: Workflows).
- **Permissions:** `repository:read`, `repository:write`, `shell:exec` — derived from the `allowed-tools` line in `SKILL.md`, not asserted separately.
- **License:** MIT.
