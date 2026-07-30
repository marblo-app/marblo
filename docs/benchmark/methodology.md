# Orchestration benchmark methodology

How Marblo measures orchestrated coding work, and what each number is allowed to
claim. This document defines the framework. The numbers themselves live in
[`dogfooding-2026-07.md`](dogfooding-2026-07.md), and the SQL that produced them
lives in [`queries/`](queries/).

## Why this is not a model benchmark

SWE-bench, Terminal-Bench and friends measure **one model answering one prompt**
in a controlled harness. That is a different object than what Marblo runs.

Marblo's unit of work is a **ticket**: an item on a board that gets assigned a
harness, spawned into an isolated worktree, worked through many turns with tool
access, reviewed, and merged. The variables that dominate the outcome are not
only "how good is the model" but:

- which **harness** (CLI) the model was reached through, and how that CLI handles
  resume, auth, MCP, and long sessions;
- whether the agent process **stayed alive** for the length of the ticket;
- whether the **orchestrator** picked a reasonable model, and whether a human
  overrode it;
- how much **context** the run burned, most of which is cache reads rather than
  fresh input.

A model score cannot answer any of those. So the axes below are ours, and any
existing model leaderboard is a complement to this, not a competitor.

## The axes

Two of these are commonly conflated. They are separate columns and they form a
grid, not a line:

| Axis              | What it is                                      | Example values                                                                 |
| ----------------- | ----------------------------------------------- | ------------------------------------------------------------------------------ |
| **Harness**       | the CLI process Marblo spawned                  | `claude`, `gpt` (Codex), `gemini` / `antigravity`, `grok`, `custom`, `local`   |
| **Model**         | the model id that harness reported for the work | `claude-opus-5`, `gpt-5.5`, `gemini-pro-agent`, `grok-4.5-build`, `MiniMax-M3` |
| **Work shape**    | what kind of ticket it was                      | `taskType` × `role` × declared complexity                                      |
| **Fleet context** | what else was running                           | parallel agent count, reuse vs. fresh spawn                                    |

The same harness runs many models over time, and the same model can be reached
through more than one harness (an env-swap vendor rides the `claude` harness; a
provider profile can point a Gemini-family CLI at something else entirely). Any
table that collapses harness and model into one column is measuring a confound.

## The metrics

### Outcome

**Ship rate.** The share of tickets that ended in a good state. The hard part is
what counts as "good", so outcomes are graded by **evidence tier**:

| Grade | Meaning                                                                                       | Available today                                              |
| ----- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `E0`  | the agent itself reported success (called `submit_for_review` rather than `FAILED`/`BLOCKED`) | yes                                                          |
| `E1`  | a reviewer — human or a review agent — approved the diff                                      | no                                                           |
| `E2`  | the change merged to the default branch                                                       | no (`task:merged` is emitted but not yet joined to outcomes) |
| `E3`  | the change survived N days without a revert or a follow-up fix ticket                         | no                                                           |

Only `E0` is instrumented at the time of writing. **`E0` is the agent grading its
own homework.** An agent that misunderstands a ticket and confidently submits a
wrong diff is recorded as a success. Every `E0` number in this directory is
labelled "self-reported" for that reason, and no claim about correctness is built
on it.

### Cost

**Token economics** — input, output, cache-read and cache-write per usage row.
This is the most trustworthy family of numbers we have, because it is read
directly from the harness's own session log.

**Imputed cost** — token counts multiplied by a local price table. See
[Cost is imputed, not billed](#cost-is-imputed-not-billed) below. It is an
API-list-price equivalent, not money spent, and it is not currently fit for
comparing harnesses.

### Reliability

**Abnormal exit rate** — `agent:crashed` per `agent:spawned`, per harness. Our
supervisor records a crash when the CLI child process exits non-zero. That
covers real crashes, but also auth failures, rate-limit exits, and some
user-initiated kills. It is a measure of _how often that CLI fell over inside
Marblo_, which is a genuine operational property of a harness — it is **not** a
measure of model quality, and it is partly a measure of our own integration.

**Restart and reuse counts** — how often the watchdog had to intervene.

### Latency

**Ticket wall-clock** — `createdAt` → `completedAt` on the ticket. This includes
queueing, human review latency, and overnight idle. It is a property of the
board, not of the agent. Agent working time is not currently separable, so
wall-clock is reported as a median with that caveat attached and never as
"how fast model X is".

### Routing

**Explicit vs. scored dispatch** — whether a human named the harness in the
prompt or the orchestrator's scorer chose it. A dispatch where the human named
the model tells you nothing about routing quality, in either direction, so the
two are always split before any routing claim is made.

## Evidence tiers

The framework distinguishes four tiers of evidence, because they license very
different claims.

| Tier   | Design                                                                            | What it can support                          | Status              |
| ------ | --------------------------------------------------------------------------------- | -------------------------------------------- | ------------------- |
| **T0** | observational telemetry from real usage                                           | descriptive statements about _our own_ usage | running             |
| **T1** | controlled replay — same ticket text, N harnesses, fresh worktrees, blind grading | within-repo comparison                       | not run             |
| **T2** | public task set, reproducible outside our repo                                    | comparison anyone can re-run                 | not built           |
| **T3** | multi-org fleets                                                                  | generalizable comparison                     | blocked on adoption |

**T0 is observational and heavily confounded.** Harness assignment is not
randomized — 90.2% of dispatches in our sample had the model named by a human,
usually because the operator already believed one harness suited the ticket.
Ticket difficulty is not controlled or matched across harnesses. The heaviest
operator is the author of the tool. Any one of those alone is enough to break a
comparison; together they mean **T0 data cannot rank harnesses or models**, and
this directory does not attempt to.

What T0 legitimately supports: sample sizes, work mix, process reliability of a
CLI under our supervisor, token shapes, and honest reporting of what our own
pipeline does and does not capture.

T1 is the next thing to build. Its design is fixed in advance so it cannot be
tuned after seeing results: the same ticket text is dispatched to each harness in
a fresh worktree from the same base commit, order randomized, each result graded
against the ticket's acceptance criteria by a reviewer blind to which harness
produced it, with n per cell and the grading rubric published before the run.

## Honesty rules

These are the rules the documents in this directory follow. They exist because
the party publishing the numbers is also the party the numbers are about.

1. **Every table prints its n.** A percentage without a denominator is not
   published.
2. **No silent caps.** Every filter appears as a printed funnel step. If 436
   ticket outcomes become 362 usable rows, all four drop-offs are shown.
3. **An unmeasured cell says "not measured".** Never `0`, never blank. A zero
   means we measured zero.
4. **Numbers come from committed SQL.** Every figure traces to a file in
   [`queries/`](queries/). Nothing is typed in by hand from a console session.
5. **Snapshot windows are closed.** A snapshot never includes a partial final
   day, so re-running the queries reproduces the same numbers rather than
   drifting upward.
6. **Known-defective metrics are published with the defect**, not quietly
   dropped. Dropping them would hide that we have a gap.
7. **No superlatives from T0.** No "fastest", no "cheapest", no "best". If the
   design cannot support the claim, the claim is not made regardless of what the
   numbers happen to say.
8. **The concentration query runs first.** If one install dominates the sample,
   that fact leads the document rather than sitting in a footnote.

## Column semantics that are easy to get wrong

These are the definitions that make our telemetry readable — and each one is a
place where a naive reading produces a wrong number.

### A `cost_logs` row is a 15-second poll delta, not a turn

Marblo polls each agent's session log every 15 seconds and writes one row per
poll that saw movement. That row holds the **delta** since the previous poll, so
`SUM()` is the correct aggregation and `MAX()` would be wrong — but the row count
is a count of _polls with activity_, not of API turns. One row can cover several
turns, including turns from parallel sub-agents. Rows are therefore labelled
"usage rows" throughout, never "turns", and no per-turn average is derived from
them.

### Cost is imputed, not billed

`totalCost` is computed locally: token deltas multiplied by a price table in the
app. Four consequences, all of which apply to every cost figure published here:

- **Subscription plans are not applied.** Work done under a flat-fee plan is
  still priced at list API rates unless the operator has manually declared the
  plan. Most of our sample was flat-fee work, so the imputed figure is far above
  money actually spent.
- **Cache rates are derived, not sourced** — cache reads are priced at 0.1× and
  cache writes at 1.25× the input rate, as a rule of thumb rather than a quoted
  price. With cache reads at 90–100% of input volume, this assumption dominates
  the total.
- **Unpriceable models bill zero.** A model id the table does not match is
  recorded at $0 rather than guessed at. This is deliberate — a wrong number is
  worse than a visible hole — but it means cost totals under-count wherever model
  resolution failed.
- **There is no idempotency key on the insert.** A reconnect re-reads the session
  file from the start, and two app windows open on one project each write the
  row. Both paths can double-count, and we have not quantified how much of the
  historical total they account for.

Because of the above, cost is reported as _observed pipeline output_ with the
defects attached, and is **not** used for any harness-to-harness comparison.

### `model` means different things in different tables

`events.model` on an `agent:spawned` row is the **harness** id. `cost_logs.model`
is the **model** id. They are joined on `agentId`, and confusing them silently
produces a plausible-looking table that measures nothing.

Two values in the model column mean "unknown" rather than a model:

- **`claude`** (bare, no version) — the harness family name leaked into the model
  column, which happens when an agent emits before its session log has written a
  first assistant turn. These rows carry zero tokens and zero cost.
- **`<synthetic>`** — Claude Code's own placeholder id on API-error lines. Because
  the parser stamps a poll window with the last model it saw, a synthetic error
  line at the end of a window mislabels that window's real tokens.

### Ticket attribution can fan out

A ticket worked by two harnesses would be counted under both if joined naively.
Tickets are therefore bucketed as single-harness or explicitly `mixed`, and only
single-harness tickets are eligible for any per-harness table.

## Reproducing

Everything in [`dogfooding-2026-07.md`](dogfooding-2026-07.md) comes from
[`queries/`](queries/):

```sh
cd docs/benchmark/queries
gcloud auth application-default login   # a principal with BigQuery read
./run.sh                                # all queries, TSV to stdout
./run.sh 02-harness-model-grid.sql      # one query
```

The dataset is Marblo's own and is not publicly readable, so an outside reader
cannot re-run these against our data. What shipping the SQL does buy you: every
published figure can be audited line by line against the query that produced it,
and the metric definitions are concrete enough to port to your own telemetry —
the schema is five tables (`events`, `cost_logs`, `task_outcomes`,
`agent_heartbeats`, `flow_executions`) and the joins are all on `agentId` and
`taskId`.

Aggregates published here are counts, rates and token statistics. No prompts,
diffs, repository contents, or user identifiers are included; installs appear
only as ranks.
