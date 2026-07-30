# Project Kickoff (workflow)

> A finished plan on one side, a running fleet on the other.
>
> Slash command: `/tf-start`

1. **Pre-flight.** Three gates before anything is created: a finalised plan exists (`docs/PRD.md` or the conversation), the Marblo MCP connection answers, and existing tickets are checked for conflicts. No PRD means you get sent to `/tf-plan` rather than a half-built board.
2. **Phase 1 — bulk-create.** The PRD's task plan is converted into a single `create_tasks_bulk` call. Every ticket carries the locked project name, plus title, description with completion criteria, role, priority, `depends_on` and `scope`. The board is then read back to verify the dependency mapping.
3. **Phase 2 — spawn and start.** Role skill files are loaded, the immediately-workable tickets are identified, agents are spawned, and each runs claim → IN_PROGRESS → code → log → submit.
4. **Phase 3 — monitor.** Unblocked tickets start as their dependencies clear; REVIEWs and FAILEDs are surfaced to you as they happen, and PM feedback is checked along the way.

## This one is not standalone

Being straight about it: this is a Claude Code slash command whose every step is a call into the **Marblo MCP server**, which ships inside the Marblo app. Copy the files below into a project without that server connected and the command loads fine, then has nothing to call. **This item needs Marblo.**

Concretely, the body calls `create_tasks_bulk`, `create_task`, `get_all_tasks`, `get_available_tasks`, `claim_task`, `update_task_status`, `add_activity`, `submit_for_review`, `check_feedback`, `get_task_activities`, `get_agent_skill`, `get_task_dependencies` — the ticket board *is* the state this workflow reads and writes, and there is no portable stand-in for it.

What you can take without installing anything: the procedure itself. `SKILL.md` is the whole thing, in the open — the questions asked, the order they are asked in, the checklists, the output formats. Rebuilding it against your own tracker is a reading job, not a reverse-engineering one.

## The files

| File | Where it goes | What it is |
| --- | --- | --- |
| [`SKILL.md`](SKILL.md) | `.claude/skills/tf-start/SKILL.md` | The workflow body — verbatim, as Marblo runs it. |
| [`COMMAND.md`](COMMAND.md) | `.claude/commands/tf-start.md` | The slash-command wrapper that makes `/tf-start` invoke the skill. |

The wrapper is deliberately thin — it exists so the command is user-invocable and not model-invocable:

```markdown
---
description: "Create tasks from the PRD and spawn agents to start the project. Use after /tf-plan."
disable-model-invocation: true
---

Invoke the `tf-start` skill and follow it exactly as presented to you
```

Previous: [`tf-plan`](../tf-plan/). To stop cleanly mid-flight: [`tf-hold`](../tf-hold/).

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Install:** find **Project Kickoff (/tf-start)** in the Marblo Store (category: Workflows).
- **Permissions:** `repository:read`, `repository:write`, `shell:exec` — derived from the `allowed-tools` line in `SKILL.md`, not asserted separately.
- **License:** MIT.
