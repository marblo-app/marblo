# Sync Tickets to Code (workflow)

> When the board and the repository stopped agreeing, find out where.
>
> Slash command: `/tf-sync`

1. **Step 1 — collect both sides.** Every ticket's status, `scope` and last activity on one side; whether those files exist, were recently modified (`git diff`, `git log`) and have tests on the other.
2. **Step 2 — detect mismatches.** Ticket is TODO but the code exists. Ticket is IN_PROGRESS with no activity log. Ticket is IN_PROGRESS but the code is finished and the tests pass. Ticket is DONE but the file is gone. Each mismatch comes with a recommended transition and the evidence behind it.
3. **Step 3 — apply, one at a time.** You choose per mismatch: move it forward, move it to IN_PROGRESS, log the current state only, or skip. Illegal transitions are handled correctly — TODO cannot jump straight to REVIEW, so it goes through IN_PROGRESS.
4. **Step 4 — summary.** Updated, skipped and already-correct counts, the resulting board, and what to do next.

## This one is not standalone

Being straight about it: this is a Claude Code slash command whose every step is a call into the **Marblo MCP server**, which ships inside the Marblo app. Copy the files below into a project without that server connected and the command loads fine, then has nothing to call. **This item needs Marblo.**

Concretely, the body calls `get_all_tasks`, `update_task_status`, `add_activity`, `submit_for_review`, `claim_task` — the ticket board *is* the state this workflow reads and writes, and there is no portable stand-in for it.

What you can take without installing anything: the procedure itself. `SKILL.md` is the whole thing, in the open — the questions asked, the order they are asked in, the checklists, the output formats. Rebuilding it against your own tracker is a reading job, not a reverse-engineering one.

## The files

| File | Where it goes | What it is |
| --- | --- | --- |
| [`SKILL.md`](SKILL.md) | `.claude/skills/tf-sync/SKILL.md` | The workflow body — verbatim, as Marblo runs it. |
| [`COMMAND.md`](COMMAND.md) | `.claude/commands/tf-sync.md` | The slash-command wrapper that makes `/tf-sync` invoke the skill. |

The wrapper is deliberately thin — it exists so the command is user-invocable and not model-invocable:

```markdown
---
description: "Sync the current code state with Marblo tickets. Catches missed updates and brings tickets up to date."
disable-model-invocation: true
---

Invoke the `tf-sync` skill and follow it exactly as presented to you
```

Related: [`tf-hold`](../tf-hold/) when the board is confusing rather than merely stale.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Install:** find **Sync Tickets to Code (/tf-sync)** in the Marblo Store (category: Workflows).
- **Permissions:** `repository:read`, `shell:exec` — derived from the `allowed-tools` line in `SKILL.md`, not asserted separately.
- **License:** MIT.
