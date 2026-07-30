# Create Tasks in Bulk (workflow)

> Analysis in, a dependency-ordered ticket board out — in one call.
>
> Slash command: `/tf-create-tasks`

1. **Phase 1 — build the list.** Each ticket gets a structured body rather than prose: `goal` (1–2 sentences), `changes` (bullets), `acceptance` (verifiable), `notes` (optional). File paths live only in `scope`; in-progress narration lives only in activities. Sizing rule is one to two hours per ticket, one API endpoint per ticket.
2. **Phase 2 — confirmation.** The full list is shown with role, priority and dependencies. Nothing is created until you say so.
3. **Phase 3 — bulk creation.** One `create_tasks_bulk` call for the whole board, then the result is verified: every ticket registered, dependencies mapped, nothing dropped.
4. **Phase 4 — report.** Ticket counts per role, the dependency chains, and how many are workable immediately.

## This one is not standalone

Being straight about it: this is a Claude Code slash command whose every step is a call into the **Marblo MCP server**, which ships inside the Marblo app. Copy the files below into a project without that server connected and the command loads fine, then has nothing to call. **This item needs Marblo.**

Concretely, the body calls `create_tasks_bulk`, `get_all_tasks` — the ticket board *is* the state this workflow reads and writes, and there is no portable stand-in for it.

What you can take without installing anything: the procedure itself. `SKILL.md` is the whole thing, in the open — the questions asked, the order they are asked in, the checklists, the output formats. Rebuilding it against your own tracker is a reading job, not a reverse-engineering one.

## The files

| File | Where it goes | What it is |
| --- | --- | --- |
| [`SKILL.md`](SKILL.md) | `.claude/skills/tf-create-tasks/SKILL.md` | The workflow body — verbatim, as Marblo runs it. |
| [`COMMAND.md`](COMMAND.md) | `.claude/commands/tf-create-tasks.md` | The slash-command wrapper that makes `/tf-create-tasks` invoke the skill. |

The wrapper is deliberately thin — it exists so the command is user-invocable and not model-invocable:

```markdown
---
description: "Bulk-create tasks in Marblo MCP from the analysis results"
disable-model-invocation: true
---

Invoke the `tf-create-tasks` skill and follow it exactly as presented to you
```

Previous: [`tf-analyze`](../tf-analyze/). Next: [`tf-spawn-agents`](../tf-spawn-agents/).

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Install:** find **Create Tasks in Bulk (/tf-create-tasks)** in the Marblo Store (category: Workflows).
- **Permissions:** `repository:read`, `shell:exec` — derived from the `allowed-tools` line in `SKILL.md`, not asserted separately.
- **License:** MIT.
