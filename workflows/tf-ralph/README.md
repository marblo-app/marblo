# Ralph Batch (workflow)

> Same job, N targets — each one a ticket, so the tally is real at the end.
>
> Slash command: `/tf-ralph`

1. **Define the batch.** Three inputs: the targets (files, components, endpoints), the work to do to each one, and the project name the tickets are filed under.
2. **One ticket per target.** Created in a single bulk call, titled `[work type] target` — `[Test] /api/users` — with a matching role and the same priority across the batch.
3. **Process sequentially.** Claim → work → record the concrete result ("wrote 3 pytest tests, 3/3 pass") → submit, or mark FAILED with the cause. One agent, one at a time, so a failure is attributable to a target rather than to concurrency.
4. **Report.** DONE count, FAILED count, and the cause of each failure.

## This one is not standalone

Being straight about it: this is a Claude Code slash command whose every step is a call into the **Marblo MCP server**, which ships inside the Marblo app. Copy the files below into a project without that server connected and the command loads fine, then has nothing to call. **This item needs Marblo.**

Concretely, the body calls `create_tasks_bulk`, `claim_task`, `update_task_status`, `add_activity`, `submit_for_review`, `get_all_tasks`, `get_available_tasks` — the ticket board *is* the state this workflow reads and writes, and there is no portable stand-in for it.

What you can take without installing anything: the procedure itself. `SKILL.md` is the whole thing, in the open — the questions asked, the order they are asked in, the checklists, the output formats. Rebuilding it against your own tracker is a reading job, not a reverse-engineering one.

## The files

| File | Where it goes | What it is |
| --- | --- | --- |
| [`SKILL.md`](SKILL.md) | `.claude/skills/tf-ralph/SKILL.md` | The workflow body — verbatim, as Marblo runs it. |
| [`COMMAND.md`](COMMAND.md) | `.claude/commands/tf-ralph.md` | The slash-command wrapper that makes `/tf-ralph` invoke the skill. |

The wrapper is deliberately thin — it exists so the command is user-invocable and not model-invocable:

```markdown
---
description: "Batch-process repetitive work with the Ralph pattern, tracking each item as a ticket"
disable-model-invocation: true
---

Invoke the `tf-ralph` skill and follow it exactly as presented to you
```

The skill also states when *not* to use it: Ralph is one agent repeating one job across N targets; different work in parallel is an agent team, which is [`tf-spawn-agents`](../tf-spawn-agents/).

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Install:** find **Ralph Batch (/tf-ralph)** in the Marblo Store (category: Workflows).
- **Permissions:** `repository:read`, `repository:write`, `shell:exec` — derived from the `allowed-tools` line in `SKILL.md`, not asserted separately.
- **License:** MIT.
