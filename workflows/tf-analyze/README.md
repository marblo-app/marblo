# Analyze Requirements (workflow)

> The minutes-long sketch of what needs building, before anyone builds it.
>
> Slash command: `/tf-analyze`

1. **Phase 1 — gather requirements.** Five things get pinned down: the problem, the users, the three must-have features, the stack, and whether this is an MVP or the full feature set.
2. **Phase 2 — codebase analysis** (existing projects only). Walk the directory tree, confirm the stack from `package.json` / `requirements.txt`, learn the existing routing / model / component patterns, and list the files a change would touch.
3. **Phase 3 — output.** Components split by backend and frontend, expected task count per role, a four-layer dependency graph (foundation → API → UI → integration), and the risks worth naming now.

## This one is not standalone

Being straight about it: this is a Claude Code slash command whose every step is a call into the **Marblo MCP server**, which ships inside the Marblo app. Copy the files below into a project without that server connected and the command loads fine, then has nothing to call. **This item needs Marblo.**

The body does not name individual tools, but every step it describes — creating, claiming, and updating tickets — goes through the Marblo MCP server.

What you can take without installing anything: the procedure itself. `SKILL.md` is the whole thing, in the open — the questions asked, the order they are asked in, the checklists, the output formats. Rebuilding it against your own tracker is a reading job, not a reverse-engineering one.

## The files

| File | Where it goes | What it is |
| --- | --- | --- |
| [`SKILL.md`](SKILL.md) | `.claude/skills/tf-analyze/SKILL.md` | The workflow body — verbatim, as Marblo runs it. |
| [`COMMAND.md`](COMMAND.md) | `.claude/commands/tf-analyze.md` | The slash-command wrapper that makes `/tf-analyze` invoke the skill. |

The wrapper is deliberately thin — it exists so the command is user-invocable and not model-invocable:

```markdown
---
description: "Analyze requirements and map out components, roles, and dependencies"
disable-model-invocation: true
---

Invoke the `tf-analyze` skill and follow it exactly as presented to you
```

Next: [`tf-create-tasks`](../tf-create-tasks/) turns the analysis into tickets. When the project warrants a real PRD instead of a sketch, use [`tf-plan`](../tf-plan/).

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Install:** find **Analyze Requirements (/tf-analyze)** in the Marblo Store (category: Workflows).
- **Permissions:** `repository:read`, `repository:write`, `shell:exec` — derived from the `allowed-tools` line in `SKILL.md`, not asserted separately.
- **License:** MIT.
