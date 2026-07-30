# PM Review (workflow)

> Nothing reaches DONE because an agent said it was finished.
>
> Slash command: `/tf-review`

1. **Step 1 — queue.** Everything sitting in REVIEW, with how long it has been waiting and who submitted it.
2. **Step 2 — review each.** Read the activity log to learn what the agent actually did, then read the files in the ticket's `scope`. The checklist is fixed: feature completeness against the ticket description, code quality against the role's skill file, tests present and passing, error handling, scope compliance (did it touch files it was not given), and security.
3. **Step 3 — verdict.** Approve → DONE, and the tickets it unblocks are named. Reject → back to TODO with a concrete change request recorded as an activity, not a vague "needs work".
4. **After the pass** — approved and rejected counts, plus the tickets that just became workable.

## This one is not standalone

Being straight about it: this is a Claude Code slash command whose every step is a call into the **Marblo MCP server**, which ships inside the Marblo app. Copy the files below into a project without that server connected and the command loads fine, then has nothing to call. **This item needs Marblo.**

Concretely, the body calls `get_all_tasks`, `update_task_status`, `add_activity`, `get_task_activities` — the ticket board *is* the state this workflow reads and writes, and there is no portable stand-in for it.

What you can take without installing anything: the procedure itself. `SKILL.md` is the whole thing, in the open — the questions asked, the order they are asked in, the checklists, the output formats. Rebuilding it against your own tracker is a reading job, not a reverse-engineering one.

## The files

| File | Where it goes | What it is |
| --- | --- | --- |
| [`SKILL.md`](SKILL.md) | `.claude/skills/tf-review/SKILL.md` | The workflow body — verbatim, as Marblo runs it. |
| [`COMMAND.md`](COMMAND.md) | `.claude/commands/tf-review.md` | The slash-command wrapper that makes `/tf-review` invoke the skill. |

The wrapper is deliberately thin — it exists so the command is user-invocable and not model-invocable:

```markdown
---
description: "As PM, review REVIEW-status tasks, check code quality, then approve or reject"
disable-model-invocation: true
---

Invoke the `tf-review` skill and follow it exactly as presented to you
```

Related: [`review-and-merge`](../review-and-merge/) is the merge-side gate that runs after approval.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Install:** find **PM Review (/tf-review)** in the Marblo Store (category: Workflows).
- **Permissions:** `repository:read`, `shell:exec` — derived from the `allowed-tools` line in `SKILL.md`, not asserted separately.
- **License:** MIT.
