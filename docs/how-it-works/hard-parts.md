# The hard parts

**Where the engineering actually is** — and, just as usefully, where it isn't.

A fair reading of Marblo's screenshots is "a kanban board for agents", and a fair
question follows: a board is a weekend project, so what is the rest? This page
answers it by naming the specific failure modes that appear once several agent CLIs
work the same repository at once, what each one costs to handle, and how easy each
is to copy.

The board is the **display**. Everything below is what makes the display true.

Every mechanism referenced here is described concretely in
[How Marblo works](README.md); this page is about _why each one is harder than it
looks_.

---

## 1 · Isolation is only interesting at the boundaries

**Looks easy:** `git worktree add` per ticket. It is one command.

**What actually breaks:**

| Failure                                                         | Why it happens                                                                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Two agents get the same worktree                                | "list → find → create" straddles `await`s. Two concurrent spawns for one ticket both see "none yet"           |
| An agent branches off a stale base and its clean diff conflicts | The local default branch is behind upstream; nobody fetched                                                   |
| Branch name collides and the spawn fails outright               | Two ticket ids sharing a prefix, or a leftover branch from an aborted run                                     |
| The agent cannot run tests, so it submits unverified work       | `node_modules` is gitignored, so a fresh worktree has none — and a `npm install` per worktree is unaffordable |
| Cleanup destroys work                                           | The branch had commits that were neither merged nor pushed, and the directory was the only copy               |

None of those is deep computer science. All of them are silent, all of them are only
discovered in a running fleet, and each fix is a specific decision:
per-`(project, ticket)` serialization; fetch before resolving base, with an offline
fallback that never blocks a spawn; escalate branch-name specificity only on a real
clash; absolute symlink instead of copy; and a reap gate that refuses to remove a
tree that is dirty or carries commits existing nowhere else.

**Copy cost:** low individually, moderate as a set — mostly the cost of having hit
each failure once in production.

## 2 · Merge is where a parallel fleet actually loses data

**Looks easy:** run `git merge --squash <branch>`.

**What actually breaks:** that command merges into _whatever the checkout is sitting
on_, which in a repo with a fleet running is frequently not the base you think. When
the local branch trails upstream, a naive squash conflates unrelated commits or lands
on the wrong branch. And the error paths are worse than the happy path: a `reset --hard` on failure destroys any uncommitted work the human had in the main checkout.

So the merge path is a set of **refusals** before it is a merge:

- resolve the base commit explicitly and squash against _that_, not against `HEAD`;
- refuse outright if the main checkout is dirty — preserve the worktree, retry later;
- pick the landing strategy from how the checkout relates to base, including a
  plumbing-only `commit-tree` + `--ff-only` path for the behind-base case;
- refuse when history diverged in both directions rather than guessing, because both
  guesses (lose commits / fabricate history) are unrecoverable;
- distinguish "conflict, needs a resolver" from "could not even start", so a dirty
  tree is not handed to a conflict resolver with an empty conflict list.

**This is the part that is genuinely asymmetric.** A merge bug does not degrade
output quality; it deletes work. Which is also why the merge decision is the human's
— the system's job is to refuse the unsafe cases, not to approve changes.

**Copy cost:** moderate, and the copy is unlikely to be correct on the first pass —
these branches are only reachable by having the divergence happen to you.

## 3 · "Merged" and "done" are different facts

**Looks easy:** PR merged → ticket `DONE`.

**What actually breaks:** code merged is not work finished. Two real tickets in our
own history: a PR merged while the backfill it existed for was never run, and a
change merged while its alerting rules sat awaiting approval. Auto-closing either
would have deleted the only remaining signal that the work was outstanding.

The asymmetry decides the design: a wrong `DONE` silently loses work; a wrong hold
just leaves a ticket visible in `REVIEW`. So closeout is biased toward holding, and
the decision is a pure function over plain data — no network, no git — so every
branch can be pinned by tests instead of only being exercised on a live board.

The non-obvious part is **which text is allowed to trigger a hold**. Ticket bodies
are creation-time specs; nearly every one contains planning language like "approval
required before running". Scanning bodies for that would hold every ticket forever.
So bodies are scanned only for a deliberate opt-in marker, while the ticket's
comment and notes — which track current state — carry the live hold signals.

**Copy cost:** low to build, high to _get right_, because the right rules are
learned from tickets that closed wrongly.

## 4 · Cost attribution breaks in ways that look like data

**Looks easy:** sum the token costs.

**What actually breaks:** every join in this area has a plausible wrong answer.

- The word `model` means the **harness** in one table and the **model** in another.
  Join them naively and you get a clean-looking table that measures nothing.
- A usage row is a **15-second poll delta**, not a turn. Row counts look like turn
  counts and are not.
- Two different id spaces for "user" exist across tables, with an **empty
  intersection**. The ticket id is the only bridge that actually joins. We reported
  a near-zero spend figure off the wrong join once — the rows matched nothing, and
  "no matches" summed to a number rather than to an error.
- The totals are **imputed**: tokens times a local price table, with subscription
  plans not applied, cache rates derived rather than sourced, unmatched model ids
  billing zero, and no idempotency key on the insert — so a reconnect can
  double-count.

The engineering here isn't the arithmetic. It is **knowing which numbers are not
allowed to be added up**, and publishing the defects attached to the metric instead
of quietly dropping it. Every one of those traps is written down in
[the benchmark methodology](../benchmark/methodology.md#column-semantics-that-are-easy-to-get-wrong)
— including the ones that make our own published figures weaker.

**Copy cost:** the code is trivial. The list of traps is the artifact, and it only
comes from having published a wrong number and found out.

## 5 · Every harness has a different contract, and the differences are lethal

**Looks easy:** shell out to a CLI.

**What actually breaks:** each vendor CLI has its own contract for resume, auth, MCP
config, session identity and model pinning, and the mismatches are not graceful
degradations — they are instant process death or silent no-ops. Measured examples,
all from running these in production:

- Resume flags are not interchangeable: one CLI's "new session" flag kills the
  process on a duplicate id, its "resume" flag dies on an id the remote does not
  know, and its "continue" flag dies when there is no session in that cwd. Three
  flags, three different fatal edges.
- A model pin that one harness applies as `--model` must be passed as a config
  override on another, and an unknown flag is an immediate refusal, not a warning.
- Which config format the CLI reads for MCP servers varies by vendor, and pointing
  the wrong one at an isolated home directory yields "zero tools" with no error.
- Token variable names collide across products from the same vendor — a
  subscription key and a metered API key can share a name shape and mean entirely
  different accounts.

And then there is the failure that is worth the whole section: **a partially injected
vendor profile is worse than none.** Injecting a vendor's base URL without its token
leaves the CLI holding _your_ Anthropic credentials while being told to run someone
else's model id. The request succeeds. It bills your quota under another vendor's
model name, and it surfaces to the user as an auth problem. Hence all-or-nothing
injection and a hard spawn refusal when keys are missing.

**Copy cost:** this is the highest-friction item on the page, and the one least
visible from outside. It is also the one we publish most of, because it is more
useful to the ecosystem as documentation than as a secret — the
[Fleet Operations knowledge pack](../../knowledge/fleet-operations/KNOWLEDGE.md)
is exactly this, written for people who are not using Marblo at all.

## 6 · Routing that learns has to be stopped from believing itself

**Looks easy:** track which model does well and prefer it.

**What actually breaks:** spawn outcomes feed the graph that scores the next spawn.
Always picking the historical best accumulates data for one cell and leaves every
other cell at n=0 — permanently cold, therefore permanently unchosen. The system
converges on a preference and then produces the evidence for it. That is a
self-fulfilling prophecy wearing the costume of a metric.

Two counters, both cheap and both deliberate: rotate when candidates are inside a
tie band (they are tied _on the evidence_, so the tie-break may as well fill a
gap), and spend an ε step on the **least-observed** neighbouring rung rather than a
random one — the objective is filling empty cells, not variety.

There is a matching invariant on the other side: **our own benchmark output must not
feed the router.** Otherwise the loop closes — the bench prefers A, the router
spawns more A, the next round eats that data. The reference table of published model
scores is already held to this rule mechanically, by a test that source-scans for
imports from any routing module, and anything we publish ourselves inherits it.

**Copy cost:** low. But it requires deciding that a slightly worse routing decision
today is worth having comparable data at all, which is a choice most systems quietly
decline to make.

---

## What is _not_ a moat, stated plainly

Being specific about the hard parts is only credible if we are equally specific about
the easy ones.

- **The kanban board.** It is a table with five columns. It is the display surface,
  not the product, and we have described it as a differentiator in our own marketing
  before — that was our error, not a reader's misreading.
- **Spawning parallel agents.** Several CLIs run sub-agents in-process today. On the
  single-agent axis — one person, one agent, one repo — the vendors' own tools are
  better resourced than we are, and we are not going to argue otherwise.
- **The terminal UI.** xterm.js and a PTY. Real work went into it; none of it is
  hard to reproduce.
- **A prettier board.** The answer to "the kanban isn't compelling" is not a nicer
  kanban.

What is left, after removing all of that, is one sentence:

> **Several agents from different vendors working one repository at the same time,
> without stepping on each other, and with the result provable afterwards.**

The first clause is isolation, the second is safe merge and closeout, and "provable"
is cost attribution plus a hash-chained ledger. Each individual piece is
implementable by a competent team. What is expensive is the **list of failures that
tells you which pieces are needed** — and most of that list is published, in this
directory and in the [Fleet Operations pack](../../knowledge/fleet-operations/KNOWLEDGE.md),
because a list of failure modes is worth more to the ecosystem as documentation
than it is to us as a secret.

## Where this is measured, and where it isn't

We would rather say "we don't know yet" than assert an advantage we cannot support.

| Claim                                                  | Status                                                                                                                           |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| The isolation and merge refusals do what they say      | **Verifiable today** — reproduce them yourself, see [How it works § Verifying](README.md#verifying-any-of-this)                  |
| A harness changes a model's measured score             | **Established from public sources**, not ours — see [The harness axis](../benchmark/harness-axis.md)                             |
| Cross-vendor review catches defects same-vendor misses | **Not measured.** It is a reasoned practice, not a result we can show you a number for                                           |
| Marblo's fleet outperforms a single agent              | **Not measured, and not claimable from our data** — non-randomized assignment, uncontrolled difficulty, one heavy operator       |
| Any harness or model is best                           | **Never claimable from observational telemetry**, and we have committed to not publishing it — [benchmark README](../benchmark/) |

The experiment that would license the third and fourth rows is designed and
pre-committed, and it has not been run. Its design, and what it is allowed to
conclude, is in [the harness axis](../benchmark/harness-axis.md).

---

Back to **[How Marblo works](README.md)** · The operational reasoning, standalone:
**[Fleet Operations](../../knowledge/fleet-operations/KNOWLEDGE.md)**
