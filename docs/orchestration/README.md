# Orchestration

How a goal becomes shipped code:

1. **Decompose** — the orchestrator turns a natural-language goal into a ticket graph.
2. **Assign & spawn** — each ticket gets the model that fits it; the orchestrator diversifies across your fleet rather than locking to one vendor, weighing task shape, cost, and remaining quota.
3. **Run in parallel** — agents work in isolated worktrees, with watchdog self-heal when one stalls.
4. **Review & merge** — the [`review-and-merge`](../../workflows/review-and-merge/) workflow gates every change; nothing lands without a review pass and your confirmation.

Related: [`reviewer` agent](../../agents/reviewer/) · [`code-review` skill](../../skills/code-review/)
