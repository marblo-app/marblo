# Plan a Project (workflow)

> Think the project all the way through before a single line of code.
>
> Slash command: `/tf-plan`

1. **Phase 0 — lock the project name.** Every ticket created later carries this exact name, so it is agreed first and recorded in the PRD.
2. **Phase 1 — Socratic questioning.** Eight required questions (core value, persona pain, user scale, three must-have features, success metrics, MVP-vs-full, tech preference, operating environment) plus five to seven optional ones. Phase 2 does not start until all eight are answered; anything still unknown becomes a written Assumption.
3. **Phase 2 — the PRD.** A fixed template: one-line summary, core problem, target users, KPI table, tech stack, system diagram, MVP features, screens, API endpoints, DB tables, NFRs, constraints, a risk table with mitigations, assumptions, and an explicit NOT-in-scope list.
4. **Phase 3 — task decomposition.** 18–22 tasks laid out over dependency layers, each with role, priority, `depends_on`, a non-overlapping file `scope`, measurable completion criteria, and a model recommendation (opus / sonnet / haiku) matched to complexity. Three worked templates ship with it: SaaS web app, data pipeline, browser extension.
5. **Phase 4 — review checklist.** Fifteen checks across PRD completeness and decomposition quality, then `docs/PRD.md` is saved and you are pointed at `/tf-start`.

## This one is not standalone

Being straight about it: this is a Claude Code slash command whose every step is a call into the **Marblo MCP server**, which ships inside the Marblo app. Copy the files below into a project without that server connected and the command loads fine, then has nothing to call. **This item needs Marblo.**

Concretely, the body calls `create_tasks_bulk`, `create_task`, `get_all_tasks`, `get_available_tasks`, `claim_task`, `update_task_status`, `add_activity`, `submit_for_review`, `check_feedback`, `get_task_activities`, `get_agent_skill`, `get_task_dependencies` — the ticket board *is* the state this workflow reads and writes, and there is no portable stand-in for it.

What you can take without installing anything: the procedure itself. `SKILL.md` is the whole thing, in the open — the questions asked, the order they are asked in, the checklists, the output formats. Rebuilding it against your own tracker is a reading job, not a reverse-engineering one.

## The files

| File | Where it goes | What it is |
| --- | --- | --- |
| [`SKILL.md`](SKILL.md) | `.claude/skills/tf-plan/SKILL.md` | The workflow body — verbatim, as Marblo runs it. |
| [`COMMAND.md`](COMMAND.md) | `.claude/commands/tf-plan.md` | The slash-command wrapper that makes `/tf-plan` invoke the skill. |

The wrapper is deliberately thin — it exists so the command is user-invocable and not model-invocable:

```markdown
---
description: "Write the project PRD and plan the task breakdown. A step for thinking hard before writing any code."
disable-model-invocation: true
---

Invoke the `tf-plan` skill and follow it exactly as presented to you
```

Next: [`tf-start`](../tf-start/) turns the finished plan into tickets and agents. For a lighter, minutes-not-hours version, see [`tf-analyze`](../tf-analyze/).

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Install:** find **Plan a Project (/tf-plan)** in the Marblo Store (category: Workflows).
- **Permissions:** `repository:read`, `repository:write`, `shell:exec` — derived from the `allowed-tools` line in `SKILL.md`, not asserted separately.
- **License:** MIT.
