# Playbook — Parallel feature build

**One vertical feature — API, UI, tests — built by several agents at once and landed as an ordered stack of PRs.**

This is the base playbook. It is also the one people get wrong in the same way every time: they fan out immediately, three agents each invent their own version of the same interface, and the merge is a rewrite. The fix is one ticket, first, alone.

|                 |                                                                                                                                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fits**        | A feature with a clear acceptance test that touches more than one layer.                                                                                                                                        |
| **Doesn't fit** | Exploratory work where you don't yet know what you're building — decide that first, in one session with one agent. Also a bad fit for anything under ~20 minutes of work: the decomposition overhead dominates. |
| **Shape**       | 1 contract ticket → N parallel implementation tickets → 1 integration/test ticket → ordered merge.                                                                                                              |
| **Wall clock**  | Roughly the longest single ticket, plus the merge pass.                                                                                                                                                         |

---

## 1. Write the goal as an acceptance test

Before you open Marblo, write one sentence that a stranger could check. Not "add saved searches" — that decomposes into whatever the orchestrator feels like. Instead:

> A signed-in user can save the current filter set under a name, see their saved sets in the sidebar, and restore one in a single click. Anonymous users see nothing new.

Two properties matter here. It names the **surfaces** (sidebar, filter set, auth state), which is what the orchestrator uses to draw ticket boundaries. And it is **falsifiable**, which is what the test ticket turns into assertions.

## 2. Decompose — and read the graph before anything spawns

On the **Board**, press **AI Breakdown** and paste the goal. Ask for the contract split explicitly; the orchestrator will produce a reasonable graph without it, but "reasonable" and "share one interface" are different things.

```
You → Break this into tickets:

"A signed-in user can save the current filter set under a name, see their
saved sets in the sidebar, and restore one in a single click. Anonymous
users see nothing new."

Constraints:
- The data shape + API contract is its own ticket, first, and nothing else
  starts until it merges. Put the types and the endpoint signature in it.
- Backend and frontend are separate tickets, both depending on the contract
  ticket.
- One test ticket depending on both, whose acceptance criteria are the
  sentence above, asserted.
- Show me the ticket list before you spawn anything.
```

What a correct response looks like — the orchestrator creating four tickets in one batch, with the dependency edges already wired:

```
Orchestrator → create_tasks_bulk([
  { alias: "contract", role: "backend",  priority: 5,
    title:  "Saved-search contract — types + endpoint signatures",
    goal:   "One source of truth for the SavedSearch shape and its 4 endpoints.",
    changes:    ["types/savedSearch.ts", "api/routes/savedSearch (signatures + 501 stubs)"],
    acceptance: ["Types compile and are imported by nothing yet",
                 "Each endpoint exists, is authenticated, returns 501"] },

  { alias: "api", role: "backend", depends_on: ["contract"], priority: 4,
    title: "Saved-search persistence + endpoints", ... },

  { alias: "ui",  role: "frontend", depends_on: ["contract"], priority: 4,
    title: "Sidebar saved-search list + save/restore", ... },

  { alias: "e2e", role: "test", depends_on: ["api", "ui"], priority: 3,
    title: "Saved-search acceptance test",
    acceptance: ["Signed-in: save → appears in sidebar → restore applies filters",
                 "Anonymous: no sidebar section, endpoints 401"] },
])
```

**Read this list.** You are looking for four specific defects, in this order of expense:

| Defect                                                            | Why it costs you                                                                                    |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Two tickets that both define the same type or endpoint            | The expensive one. Two agents, two contracts, and the second PR to merge is a rewrite.              |
| A missing `depends_on` edge                                       | The dependent agent starts against a file that does not exist yet and invents a placeholder for it. |
| A ticket whose acceptance criteria are a restatement of its title | Nothing to verify against, so "done" becomes the agent's opinion.                                   |
| One ticket that is obviously three                                | It will run long, and its diff will be the one you cannot review.                                   |

Fix by talking, not by re-running the breakdown — a re-run throws away the parts that were right.

```
You → Ticket 3 defines the SavedSearch type too. Delete that from its changes
      list and have it import from the contract ticket. Also split ticket 4:
      the retention/cleanup job is not part of the acceptance sentence — make
      it a separate ticket at priority 1, no dependency.
```

Priority is an integer **1–5**, higher being more urgent. It is a hint for pickup order, not a scheduler.

## 3. Assign models per ticket, not per run

The whole reason to decompose is that the tickets have different difficulty, and difficulty is what should choose the model. A run where every ticket gets your best model is a run where you paid premium rates to rename some props.

```
You → Assignment: contract ticket complex, on your strongest reasoning model.
      api and ui standard. e2e simple. Diversify vendors across the three
      implementation tickets — I want the UI ticket on a different vendor
      than the API ticket.
```

Three things worth knowing about how this resolves:

- **`complexity` is the primary dial.** `simple` routes to a cheap tier, `standard` to the default top model, `complex` to top reasoning. If you say nothing else, this is what decides your bill.
- **You can name a model or just a vendor.** Naming a vendor (`claude`, `codex`/`gpt`, `grok`, …) lets that vendor's own difficulty policy pick the concrete model; naming a specific model pins it and bypasses scoring. Every Board card shows the concrete model it ran on, so an assignment you didn't intend is visible rather than silent.
- **Ask for the evidence instead of arguing about it.** `get_model_guidance` returns per-model facts (price, capability grade, context window, published benchmark rows with their source) plus how each model has actually performed on _your_ board; `get_routing_effectiveness` breaks that down by (model × difficulty × task type). Neither tool gives a recommendation — deliberately. They hand you success rate, average cost, and success-per-cost, and the judgement stays yours.

```
You → Before you assign: show me get_routing_effectiveness for this project,
      then justify each assignment in one line.
```

**Cross-vendor is not aesthetic.** Putting the UI and API tickets on different vendors is what makes the review step in [Review & safe merge](review-and-safe-merge.md) worth anything. A model reviewing another instance of itself agrees with itself far too readily.

**On the expensive rungs:** the top gated rungs require your explicit approval — an agent cannot elect one on its own. The orchestrator requests one with `request_model_escalation`, you decide, and the decision is recorded. Approval is single-use, one per ticket. If nothing is approved, the spawn quietly downgrades to the highest ungated rung rather than failing, which is worth remembering when you wonder why a ticket didn't run on what you assumed.

## 4. Run the contract ticket alone

Let the contract ticket run and merge **by itself**. This feels like waste — one agent working while your fleet idles — and it is the highest-return waiting you will do all day. Every downstream agent then reads a real file instead of guessing at one.

While it runs:

- Its terminal is live under **Agents**, or in the workspace terminal column. You can type into it directly; a human turn counts the same as a programmatic one.
- The ticket's timeline collects the agent's own progress notes.
- When the agent hits something only you can answer, it uses the typed Q&A channel and the question lands on the ticket and in the orchestrator. Answer it there and the answer is injected back into that agent's terminal. Questions that were raised while you were away are recoverable with `get_open_questions` — they are not lost if you missed the notification.

Then review and merge it using [Review & safe merge](review-and-safe-merge.md). Small diff, fast pass.

## 5. Fan out

With the contract merged, release the rest. The orchestrator can dispatch them, or you can — `dispatch_task` is the same path either way, and it prefers reusing an idle agent of the right role over spawning a new one.

```
You → Contract is merged and main is synced. Dispatch api, ui and e2e now.
      Rebase each worktree onto main first so nobody works against the old base.
```

Each ticket runs in its own worktree on its own `marblo/…` branch, named from the ticket, which is what makes this safe: two agents editing the same path cannot see each other's edits.

**What to watch, and what to ignore:**

- **Ignore silence.** An agent that is reasoning emits nothing. Output volume is not progress, in either direction.
- **Watch the Stuck lane.** `BLOCKED` and `FAILED` tickets live there, collapsed, along with stale ones — no progress for over 30 minutes, or a worktree untouched for a day. The lane also offers **Retry** / **Archive** per card.
- **Let the watchdog go first.** For a ticket whose agent died or went silent, the watchdog nudges the live terminal, and if that budget is spent, re-dispatches through the normal guarded path — so a still-live worker gets re-instructed rather than double-spawned. It only ever touches tickets that are already `CLAIMED`/`IN_PROGRESS` with a bound agent; it never picks up `TODO`.
- **Before you take over a ticket yourself, check whether the agent is actually dead.** An agent running a multi-minute build is silent on disk and in its terminal while being entirely alive. If a branch and an open PR already exist for that ticket, the work is submitted — stand down. ([Fleet Operations §7](../../knowledge/fleet-operations/KNOWLEDGE.md) has the three checks.)

### Steering mid-flight

Two moves cover most corrections:

**Comment on the code.** Open the ticket on the Board, look at its diff, drag-select the lines, right-click → **Comment to orchestrator**. The comment carries the file and line range, and the orchestrator routes it to the agent that wrote it. This is much cheaper than describing the problem in prose, and it is the main reason to review diffs in-app rather than on GitHub while work is in flight.

**Add a constraint to the run.** Say it once to the orchestrator and let it propagate:

```
You → Both implementation agents: no new dependencies without asking me first.
      The UI agent added a date library for one format call — have it use the
      existing formatter in lib/format.ts instead.
```

## 6. Merge in dependency order

Ready PRs do not merge in arbitrary order. **Dependency order first, then smallest diff first** among independents.

The **Worktrees** tab is the queue view. Every worktree is categorized — _In development_, _Merge needed_, _Cleanup · merged_, _Cleanup · stale_ — with the branch's status against base, links to GitHub, and merge history.

For each PR, in order:

1. **Rebase onto current base**, then re-run the tests. Not optional after the previous merge. A branch that is behind base also makes a three-dot diff (`main...branch`) report changes it never made, which will have you reviewing deletions that do not exist.
2. **Review it** — [Review & safe merge](review-and-safe-merge.md).
3. **Merge.** On conflicts, the orchestrator can put a resolver agent into that worktree: it rebases onto base, resolves, continues the rebase, and reports if it cannot.
4. **Close out with `merge_and_close`.** It verifies the PR really is merged, flips the ticket to `DONE` through the normal state machine, and reaps the stale worktree. It refuses to touch anything if the PR is still open or conflicting, and it deliberately holds the ticket at `REVIEW` when the ticket says follow-up work is outstanding — code merged is not work done. `dry_run: true` shows the verdict without writing.

The e2e ticket merges last, and its PR is the one that tells you whether the feature exists. If its assertions pass against merged code, the sentence you wrote in step 1 is now true.

## What you end up with

- One PR per ticket, each reviewable on its own, in an order that a reader can follow.
- A Board where each card carries the model that ran it, its cost, its timeline, and its PR — the run is auditable a month later.
- Worktrees reaped, tickets at `DONE`, nothing left in `REVIEW` pretending to be unfinished work.
- A cost figure in the **Usage** tab for the whole feature, broken down by model, which is the number that tells you whether your complexity assignments were sane.

## Failure modes

**"Every PR touches the same file."** Your decomposition was by layer when the work was by feature slice, or the contract ticket didn't actually own the shared file. Stop, re-split, and be explicit about which ticket owns which paths (`scope`).

**"The agent said done but the acceptance criteria aren't met."** Almost always an acceptance list that restates the title. Rewrite it as commands and expected output, and have the ticket require the command output in its completion report.

**"Two agents are fighting over one file."** They are in different worktrees, so they cannot be — unless one of them is working in the shared checkout rather than its worktree. Check the agent's cwd. Related: agents in worktrees can clobber _untracked_ files that exist only in the shared checkout, so commit early.

**"The run cost several times what I expected."** Check the concrete model on each card. Usual causes: everything landed on `standard` because no complexity was set, or a `complex` ticket ran with `mix` enabled (cross-check/split-role doubles the spawn, which is the point, but it is 2× cost).

**"I have six PRs and no idea which to merge first."** You skipped the ordering. Dependency order, then smallest first; rebase between each. Merging in "whatever finished first" order is how one bad merge becomes six conflicted branches.

---

Next: **[Large refactor](large-refactor.md)** applies the same seam-first shape to work with hundreds of mechanical call sites.
