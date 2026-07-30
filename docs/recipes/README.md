# Recipes & Playbooks

**End-to-end runs, written down.** Each playbook takes one real kind of work from a goal to merged code: how to decompose it into tickets, which model to put on each ticket, how to steer the run while several agents work at once, and how to decide the merge.

These are not feature tours. They are the sequences we actually run, including the parts that are manual and the parts where the honest answer is "you look at it yourself."

## The playbooks

| Playbook                                                  | The work                                                      | Shape                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| **[Parallel feature build](parallel-feature-build.md)**   | One vertical feature across API, UI, and tests                | 1 contract ticket → N parallel tickets → ordered merge             |
| **[Large refactor](large-refactor.md)**                   | Rename/replace an API across hundreds of call sites           | 1 seam ticket → batched mechanical tickets → verification ticket   |
| **[Bug audit → parallel fix](bug-audit-parallel-fix.md)** | Find real defects in a subsystem and fix the confirmed ones   | read-only audit → cross-vendor verify → 1 ticket per confirmed bug |
| **[Docs & asset harvest](docs-and-asset-harvest.md)**     | Non-code work: docs, knowledge packs, translation/i18n sweeps | policy gate → 1 ticket per asset → generated index last            |
| **[Review & safe merge](review-and-safe-merge.md)**       | Landing agent-written code without breaking `main`            | independent review → resolve or waive → merge → four-part closeout |

Start with **[Parallel feature build](parallel-feature-build.md)** — the other four assume its vocabulary.

## What every playbook assumes

- **Marblo installed and a folder connected.** Connecting a folder creates the project and boots the orchestrator ([Getting Started](../getting-started/)).
- **At least one harness signed in.** Two or more different vendors makes several of these playbooks work much better — cross-vendor review is the single highest-leverage habit in here, and it is impossible with one.
- **The repo is a git repo with a remote.** Every ticket gets its own worktree on its own `marblo/…` branch, named from the ticket, and merges go through pull requests.
- **You are the merge authority.** Nothing in these playbooks lands code on `main` without you.

## Conventions used below

- **Ticket** — one card on the Board. Statuses: `TODO → CLAIMED → IN_PROGRESS → REVIEW → DONE`, plus `BLOCKED` / `FAILED`, which appear in the collapsed **Stuck** lane rather than in a column.
- **Role** — `backend` · `frontend` · `test` · `devops`. Roles pick which agent skill the worker loads, and they are the Board's filter axis.
- **Complexity** — `simple` · `standard` · `complex`. This is a difficulty label that also selects the model tier, so it is a cost dial as much as a routing one.
- **Prompt blocks** — text in a fenced block prefixed `You →` is meant to be pasted to the orchestrator verbatim, with the bracketed parts replaced. Blocks prefixed `Orchestrator →` show the tool calls it makes in response, so you can recognize a correct decomposition from a wrong one.

## Reading these honestly

Three things these playbooks do **not** claim:

1. **The orchestrator is an agent, not an oracle.** Its decomposition is a draft. Every playbook here has a step where you read the ticket list before any agent spawns, because a bad ticket graph is much cheaper to fix at that moment than after six agents have acted on it.
2. **Parallelism is bounded.** How many agents run at once is capped by your plan and by your machine. Wide fan-out in these playbooks means "as wide as your cap," not "unbounded."
3. **You pay for the models.** Agents run the vendor CLIs you are signed in to, on your own subscriptions or keys. The cost dials — complexity, model choice, cheap-tier batching — are load-bearing, not decoration. The **Usage** tab is where you check what a run actually cost.

For the failure modes underneath all of this — why "the agent is working" is an unreliable signal, why merging is four actions and not one, what breaks when you run several vendor CLIs side by side — see the [Fleet Operations knowledge pack](../../knowledge/fleet-operations/KNOWLEDGE.md). The playbooks give you the sequence; that pack explains why the sequence has the shape it does.
