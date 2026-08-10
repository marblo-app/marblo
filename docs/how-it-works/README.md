# How Marblo works

What actually happens between "here is a goal" and "this commit landed on `main`" —
the mechanism, not the pitch.

This page is for the reader who wants to know whether there is an engine under the
board before installing anything. It describes the pieces in the order a ticket
passes through them, names the real behaviours and their limits, and says plainly
where something is opt-in, off by default, or not instrumented yet.

Related: **[The hard parts](hard-parts.md)** — the failure modes each of these
steps exists to prevent, and what it costs to handle them.
**[Concepts](../concepts/)** for the vocabulary. **[Recipes](../recipes/)** for how
to drive it. **[Benchmark](../benchmark/)** for how we measure it.

---

## The shape

Marblo is a desktop app that supervises **other people's CLIs**. It does not host a
model, does not proxy your prompts, and does not implement an agent loop.

```
  your goal
      │
      ▼
  ┌─────────────────────────────────────────────┐
  │  orchestrator — a coding CLI + MCP toolset  │
  └─────────────────────────────────────────────┘
      │  create_tasks_bulk · dispatch_task
      ▼
  tickets ─────────────────▶ the board
      │
      ├─ spawn ─▶ agent CLI ─▶ worktree A ─┐
      ├─ spawn ─▶ agent CLI ─▶ worktree B ─┼─▶ review ─▶ safe merge ─▶ base branch
      └─ spawn ─▶ agent CLI ─▶ worktree C ─┘                 ▲
                      │                                      │
                      ├─ PTY bytes ───▶ live terminal    you decide
                      ├─ session log ─▶ cost tracker
                      └─ MCP calls ───▶ audit ledger (hash-chained)
```

Four kinds of state have to stay consistent: the board, the git repository, the
running CLI processes, and the cost/audit record. Almost every mechanism below
exists because one of those four drifts out of sync with the others when nobody is
holding them together.

---

## 1 · Decomposition — the planner is an agent, not a rule engine

The orchestrator is not a hardcoded planner. It is **a coding CLI running in a
terminal with the Marblo MCP server attached**, driven by a prompt that tells it to
break the goal into tickets sized for an hour or two, tag each with a role, declare
`depends_on` edges, and declare each ticket's file `scope` so parallel tickets do
not overlap. It then calls `create_tasks_bulk` and dispatches.

That choice has two consequences a reader should weigh honestly:

- **Upside** — decomposition quality tracks the model you point at it, and improves
  when models do. There is no planning DSL to outgrow.
- **Downside** — it is a language model, so it can produce a bad ticket graph. The
  board is what makes that recoverable: a bad ticket is visible, editable, and
  re-dispatchable before an agent burns tokens on it. Nothing here assumes the
  decomposition is correct.

The orchestrator is a swappable slot. Claude Code, Codex and Grok have all been run
in it; the MCP toolset it holds is the same in each case.

## 2 · Dispatch — model selection is two layers, and they answer different questions

A common flattening in this space is treating "which model" as one decision. It is
two, and conflating them measures a confound (this is the same distinction the
[benchmark methodology](../benchmark/methodology.md#the-axes) is built on).

| Layer                                       | Question                                  | Competing on                                                                                                                                                                               |
| ------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1 — harness** (which CLI)                 | Claude Code? Codex? Grok?                 | task tags, live quota headroom, weekly token limits, observed usage, the routing graph                                                                                                     |
| **2 — rung** (which model/effort inside it) | `sonnet-5`? `opus-5`? `gpt-5.6-sol@high`? | distance from the tier's entry rung, blended price (counted in log₂ multiples), published capability scores, observed outcomes for that exact `model@effort` cell, remaining account quota |

Layer 2 exists because it used to be a constant — `standard → opus-5`, literally —
and since `standard` is the default complexity, layer 1 choosing Claude meant layer 2
always chose Opus. The live fleet showed exactly that. Replacing the constant with a
scored decision is what made the rung axis real.

**Vendors are not all harnesses.** Some vendors ship their own CLI (a new harness);
others sell a subscription that opens an Anthropic-compatible endpoint, so they ride
the Claude harness by swapping three environment variables and appear as _rungs on
the Claude ladder_ rather than as separate harnesses. Which shape a vendor takes is
not predictable from "does it ship a CLI" — the test is whether the subscription
opens a compatible URL. This is written up in detail in the
[Fleet Operations knowledge pack](../../knowledge/fleet-operations/KNOWLEDGE.md).

**Exploration is deliberate.** Spawn outcomes feed back into the routing graph that
scores the next spawn. Always picking the historical best therefore accumulates data
for one cell only, and every other cell stays at n=0 forever — a self-fulfilling
prophecy dressed as evidence. Two mechanisms cut it: rotation when scores are inside
a tie band (the candidates are tied _on the evidence_, so the tie-break is
arbitrary and may as well diversify), and an ε-greedy step that picks the
**least-observed** neighbouring rung rather than a random one. The goal is filling
empty cells, not variety for its own sake.

**Expensive rungs are not reachable by autoselect.** `max` / `ultra` effort sit
behind a per-ticket, single-use approval record. The autoselect module enumerates
usable rungs _without_ an approval record, so it is structurally unable to route
around the gate. An agent can request an escalation; it cannot grant itself one.

## 3 · Spawn — one chokepoint, and what it refuses

Everything that starts an agent — board dispatch, HTTP, the mission engine, a
lane, the UI — funnels through one function. Gates live there rather than in the UI
path, because a gate in the UI path is a gate every other caller walks past.

The gate that matters most is the **vendor credential check**, and it is worth
spelling out because the failure it prevents is silent rather than loud:

> An env-swap vendor is reached by injecting a base URL _and_ an auth token. Marblo
> injects a vendor profile **all-or-nothing** — a partial injection would leave the
> Claude CLI holding _your Anthropic credentials_ while being told to run another
> vendor's model id. That request succeeds. It bills your Anthropic quota, under
> another vendor's model name, and surfaces to the user as "why isn't auth working".
> So a pinned model whose vendor keys are missing does not spawn at all. The error
> names the missing **environment variable names**, never their values.

Skills are pre-flighted the same way: a dispatch that names a skill has that skill
checked **against the disk**, and a missing or misspelled name fails immediately
with a suggestion, before any ticket or worktree is created. The alternative —
which is what happened before — is that the agent spawns, silently lacks the skill,
and produces plausible work with the wrong method.

## 4 · Isolation — a git worktree per ticket

Before an agent launches, a coordinator guarantees two things exist: a board ticket
and an isolated git worktree. The agent's cwd is that worktree.

What "isolated" concretely means:

- **Fresh branch off current upstream.** `git fetch origin` runs _before_ the base
  ref is resolved, so a worktree forks off the latest upstream default branch rather
  than a stale local one — unless the caller pinned an explicit base, in which case
  the fetch is skipped and the caller's intent is respected. A failed or offline
  fetch warns and falls back to the last-known local ref; it never blocks the spawn.
- **Collision-safe branch names.** `marblo/<slug>-<first-8-of-ticket-id>` is the
  normal case. On an actual clash the id slice widens (12 → 16 → full), then a
  numeric suffix — specificity escalates only when it has to, so branch names stay
  readable.
- **`node_modules` is symlinked, not copied.** It is gitignored, so a fresh worktree
  has none, and an agent that cannot run `typecheck` or `test` will confidently
  submit unverified work. The repo's `node_modules` (root and monorepo package) is
  linked in with an absolute symlink: instant, zero disk. Best-effort — a failure
  warns and worktree creation still succeeds.
- **Prepare is serialized per `(projectId, ticketId)`.** "List worktrees → find
  ours → create if absent" is a check-then-act straddling `await`s. Two concurrent
  spawns for the same ticket would both see "none yet" and both create one. Each
  ticket key gets a lock, so the second caller runs after the first and sees its
  worktree.

The whole path is written never to throw: a non-git folder, or no project context,
falls back to a plain cwd rather than blocking work.

## 5 · Watching it run

Two independent observers, deliberately not sharing a channel:

**The terminal** streams raw PTY bytes. You can type into a running agent without
killing it, which is the difference between steering and restarting.

**The cost tracker** is a read-only observer of the CLI's own **session log**
(JSONL), polled every 15 seconds, parsed incrementally per vendor format. It never
touches the PTY data flow. For CLIs without a parseable session log it falls back to
scraping PTY output, and that fallback is labelled best-effort where it appears.

One caveat we publish rather than hide: **PTY byte flow is a bad liveness signal in
both directions.** A CLI that finished can leave the terminal looking busy; a model
that is thinking emits nothing and looks idle. Marblo's watchdog therefore does not
treat silence as death — and the honest version of this, with the measurements
behind it, is in the [Fleet Operations pack](../../knowledge/fleet-operations/KNOWLEDGE.md).

## 6 · Cross-checking — what is automatic and what is not

Three distinct things, and it matters which is which:

| Mechanism                                                       | Trigger                     | Default                          |
| --------------------------------------------------------------- | --------------------------- | -------------------------------- |
| **Review ticket on a different vendor** (the practice)          | you or the orchestrator ask | **the recommended default**      |
| **`mix: "cross-check"`** on a dispatch                          | explicit parameter          | **off** (opt-in, `complex` only) |
| **Auto-mix policy** (mix when both vendors have quota headroom) | environment flag            | **off**                          |

`mix: "cross-check"` spawns a second agent on a different vendor with an
adversarial framing — _do this work independently and try to refute the primary
agent's output; escalate on disagreement._ The companion deliberately gets **no
shared ticket id**, so it lands in its own ad-hoc worktree and cannot collide with
the primary's isolated tree (one worktree, one agent). It costs two slots, so it is
scoped to design, security and migration work rather than switched on globally. If
the dispatch named a skill that the companion's vendor does not have installed, the
companion is dropped and the dispatch degrades to single — rather than running a
companion that silently lacks the method.

The auto-mix policy is a pure function (no clock, no env, no spawning) that decides
whether to add a cross-check based on both vendors' remaining quota. It is
**off unless a flag is set**, never touches `simple`/`standard`, always defers to an
explicit `mix`, never overrides an explicitly named model, and — importantly —
treats missing usage data as _no decision_ rather than as headroom.

We are not going to describe cross-vendor review as an automatic guarantee. It is a
cheap, high-yield practice that the product makes easy; the
[review & safe merge playbook](../recipes/review-and-safe-merge.md) is the version
you actually run.

## 7 · Safe merge — what "safe" is defined as

"Safe merge" is a specific set of refusals, not a synonym for "we merge for you".
**The merge authority is you.** Nothing here lands code on `main` on its own.

The squash-to-base path holds two invariants, both of which exist because the
earlier version violated them:

1. **The squash is computed against the resolved base commit** (`<baseRef>^{commit}`),
   not against whatever branch the main checkout happens to be sitting on. When the
   local branch had diverged from the base — local `main` behind `origin/main`, the
   ordinary case — the old code conflated unrelated commits or landed on the wrong
   branch.
2. **No destructive git command ever runs against a dirty main checkout.** A
   `git status --porcelain` that is non-empty aborts the merge up front with an
   explanatory error, and the worktree is preserved so the merge can be retried after
   you commit or stash. The old error paths ran `git reset --hard` unconditionally,
   which could wipe uncommitted work.

Given a clean checkout, the landing strategy is chosen from how the checkout relates
to the base commit:

| Relationship                      | Strategy                                                                                                                                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| checkout at/ahead of base         | `git merge --squash` then commit — the tested clean path                                                                                                                                                       |
| checkout strictly **behind** base | build the squashed commit with `commit-tree` (pure plumbing, touches no index or working tree), then `merge --ff-only` — guaranteed fast-forward, brings the checkout to base and lands the ticket in one move |
| diverged in **both** directions   | **refuse.** Landing here would either lose local commits or fabricate misleading history. The worktree is kept and the error says to resolve manually                                                          |

The rebase runs first; a real conflict returns `needsResolve` with the unmerged
paths (routing to a resolver agent), while a non-conflict failure — dirty tree, bad
ref — is surfaced as a plain error rather than mis-routed to a resolver with an
empty conflict list.

**Reaping is gated separately.** A worktree is removed only when removal is provably
lossless: no uncommitted changes, and no commits that exist neither in base nor on
the remote branch. Anything else is preserved with the blockers enumerated. Unreadable
branch state counts as unsafe. Idle worktrees can be auto-archived from the UI, but
dirty / unpushed / busy each veto that outright.

## 8 · Closeout — why the ticket does not always flip to DONE

Merging leaves two other pieces of state stale — the ticket status and the worktree
— and raises a third question nobody asks in the moment: whether the _work_ is
finished, or only the code. `merge_and_close` handles all three together, and its
decision core is a **pure function over plain data** — no
Firestore, no git, no `gh` — so every branch is unit-pinned rather than only
exercised against a live board.

It is biased toward **holding**, because the failure modes are asymmetric:

- A wrong `DONE` silently closes work that is not finished. Two real tickets are
  exactly this shape: a PR merged while the data backfill it existed for was never
  run, and a change merged while its alerting rules awaited approval. Auto-closing
  those destroys the only signal that work remained.
- A wrong hold just leaves the ticket in `REVIEW`, where both the board and the
  orchestrator still show it.

So it verifies the PR is genuinely merged (if it is open or conflicting, it changes
nothing and says so), flips through the **normal state machine** rather than writing
the field directly, and holds at `REVIEW` with a recorded reason when the ticket's
own live text says follow-up remains. The scan distinguishes the ticket **body** —
immutable creation-time spec, scanned only for a deliberate opt-in marker — from the
**comment and notes**, which reflect current state. Without that split, phrases like
"approval required before running" in nearly every ticket's constraints section
would hold every ticket forever.

Worth internalizing: when `merge_and_close` declines to close a ticket, it is
usually right.

## 9 · The record — cost attribution and the audit ledger

**Cost** is attributed on two joins, and getting either wrong produces a
plausible-looking table that measures nothing:

- `events.model` on a spawn row is the **harness** id. `cost_logs.model` is the
  **model** id. They join on `agentId`.
- A `cost_logs` row is a **15-second poll delta**, not an API turn. `SUM()` is
  correct; a per-turn average derived from row counts is not.
- Cost figures are **imputed** — token counts times a local price table. Subscription
  plans are not applied, so flat-fee work is priced at list API rates and reads far
  above money actually spent. Every published cost figure carries that label; see
  [Cost is imputed, not billed](../benchmark/methodology.md#cost-is-imputed-not-billed).

The Usage tab reports which model an agent _actually_ ran along with the **evidence**
for that attribution — an observed billing session, or the spawn argv — and leaves
the field empty when there is none, rather than guessing.

**The audit ledger** records MCP tool calls at a single wrapper chokepoint (hooking
the renderer would capture human clicks and miss the AI actions that are the point).
Beyond storage rules, the integrity evidence is in the data itself: events are
hash-chained, and chain heads are periodically sealed into a checkpoint. Deleting or
altering an event mid-chain breaks the chain; deleting the chain wholesale
contradicts the checkpoint. Storage rules are access control, not integrity proof —
they only bind paths that go through them.

The chain unit is `(projectId, agentId)` rather than one chain per project. A single
project-wide chain would make every tool call from every parallel agent queue on one
shared head, so the audit feature would tax the product's throughput. Per-agent
chains have exactly one writer process each, so ordering is natural and sealing is a
single in-memory operation. Ordering authority is a per-process monotonic sequence
number, not `createdAt` — client clocks skew, and offline events can be re-queued
30 minutes later, so write order is not occurrence order.

---

## What this page does not claim

- **No claim that any harness or model in Marblo is best at anything.** Our
  telemetry is single-operator dogfooding data with non-randomized assignment. What
  it can and cannot support is spelled out in
  [the benchmark directory](../benchmark/).
- **Ship-rate grades above `E0` are not instrumented.** Today's outcome signal is
  the agent reporting its own success. That is the agent grading its own homework,
  and it is labelled that way everywhere it appears.
- **Declared permissions on Store items are disclosure, not enforcement.** See
  [SECURITY.md](../../SECURITY.md).
- **The merge decision is yours.** Marblo refuses unsafe merges; it does not approve
  changes for you.

## Verifying any of this

Most of this is checkable without taking our word for it — several of the checks are
plain git commands run against your own repository:

| Claim                       | How to check                                                                                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| worktree-per-ticket         | `git worktree list` in your repo while a fleet is running; branches are `marblo/<slug>-<id>`                                                                    |
| fresh base                  | `git log --oneline <base>..<ticket-branch>` — the fork point is current upstream, not your stale local                                                          |
| merge refusals              | leave an uncommitted change in your main checkout, then merge a ticket. It refuses and says why                                                                 |
| reap safety                 | reap a worktree with an unpushed commit. It preserves it and enumerates the blockers                                                                            |
| cost attribution            | Usage tab shows the model and the evidence for it; empty means no evidence, not zero                                                                            |
| the review pass, standalone | the [`reviewer` agent](../../agents/reviewer/) and [`code-review` skill](../../skills/code-review/) are plain files — run them in your own CLI, no app involved |

Found something here that does not match what the app does? That is a bug in this
page or in the app, and both are worth an issue — see
[CONTRIBUTING.md](../../CONTRIBUTING.md).
