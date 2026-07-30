# Dogfooding data — snapshot 2026-07-29

Everything below is measured, from Marblo's own telemetry. Nothing is estimated,
extrapolated, or rounded in our favour. Every table names the query in
[`queries/`](queries/) that produced it, and the metric definitions and caveats
are in [`methodology.md`](methodology.md).

**Window:** 2026-04-18 → 2026-07-29 inclusive (UTC). The window is closed at the
end of a full day, so re-running the queries reproduces these numbers rather than
drifting.

## Read this first: the sample is one person

> This is internal dogfooding data from the team that builds Marblo. It is
> **T0 observational** evidence (see [methodology](methodology.md#evidence-tiers)):
> harness assignment was not randomized, ticket difficulty was not controlled, and
> the heaviest operator is the tool's author. **These numbers cannot rank harnesses
> or models, and no ranking is claimed anywhere in this document.** They describe
> our own usage and the state of our own measurement pipeline. That is all.

Per-install coverage — `09-install-funnel.sql`. The stages are not strictly
nested; see the note below the table.

| Stage                            | Installs |
| -------------------------------- | -------- |
| Opened the app (session started) | 38       |
| Spawned at least one agent       | 15       |
| Produced at least one usage row  | 2        |
| Completed at least one ticket    | 5        |
| Completed at least 10 tickets    | 3        |

Two things this says plainly. First, external usage is negligible: 38 installs
opened the app, 15 ever spawned an agent, and only 3 ever finished ten tickets.
Second, stage 3 sitting below stage 4 is a **coverage defect, not a real drop** —
cost telemetry reaches far fewer installs than ticket telemetry does, which is
why the cost tables further down have an n of 2 while the ticket tables have an
n of 5.

Concentration — `01-concentration.sql`, `01b-concentration-spawns.sql`,
`01c-concentration-rollup.sql`:

| Measure                  | Installs | Total  | Top install | Top 5 |
| ------------------------ | -------- | ------ | ----------- | ----- |
| Usage rows (`cost_logs`) | 2        | 95,107 | 95,103 rows | —     |
| Agent spawns             | 15       | 4,707  | 32.9%       | 97.0% |

The second install in `cost_logs` contributed 4 rows out of 95,107. Spawns are
spread a little wider — 15 installs — but the top five account for 97.0% of them.

## Coverage

`00-coverage.sql`

| Table              | Rows      | Installs | Agents / tickets | First day  | Last day   |
| ------------------ | --------- | -------- | ---------------- | ---------- | ---------- |
| `agent_heartbeats` | 2,780,127 | 13       | 1,352 agents     | 2026-04-19 | 2026-07-29 |
| `events`           | 106,803   | 39       | 2,260 agents     | 2026-04-18 | 2026-07-29 |
| `cost_logs`        | 95,107    | 2        | 1,290 agents     | 2026-04-18 | 2026-07-29 |
| `task_outcomes`    | 436       | 5        | 419 tickets      | 2026-06-15 | 2026-07-29 |
| `flow_executions`  | 0         | 0        | 0                | —          | —          |

`flow_executions` is empty: workflow-level telemetry is defined but nothing has
ever written to it. Every workflow metric in this framework is therefore **not
measured**. `task_outcomes` starts two months after the other tables because
ticket-outcome logging shipped later.

## Harness × model grid

`02-harness-model-grid.sql` — all 33 rows, unfiltered.

A usage row is one 15-second poll that saw activity, **not one API turn**; the
cost column is an imputed list-price equivalent, **not money spent**. Both are
explained under [column semantics](methodology.md#column-semantics-that-are-easy-to-get-wrong)
and neither supports a harness-to-harness comparison.

| Harness     | Model                      | Usage rows | Agents | Installs | Avg input | Avg output | Avg cache read | Cache read share | Imputed cost (USD) |
| ----------- | -------------------------- | ---------: | -----: | -------: | --------: | ---------: | -------------: | ---------------: | -----------------: |
| claude      | claude-opus-4-8            |     52,144 |    581 |        1 |     2,957 |     15,432 |      2,408,046 |            99.9% |          72,582.67 |
| claude      | claude-opus-5              |     18,828 |    192 |        1 |         3 |      1,217 |        185,383 |           100.0% |           2,698.48 |
| gpt         | gpt-5.5                    |     10,051 |    357 |        1 |    19,577 |      2,007 |        360,738 |            94.9% |           3,222.66 |
| claude      | claude-fable-5             |      6,941 |     46 |        1 |        62 |      1,016 |        109,232 |            99.9% |             485.82 |
| claude      | claude-opus-4-1-20250805   |      2,064 |     32 |        1 |         8 |        171 |        353,912 |           100.0% |              30.83 |
| claude      | `claude` (unresolved)      |      1,266 |    691 |        1 |         0 |          0 |              0 |     not measured |               0.00 |
| claude      | `<synthetic>` (unresolved) |      1,021 |     42 |        1 |     5,620 |     35,421 |      7,134,237 |            99.9% |           4,137.74 |
| claude      | claude-sonnet-4-20250514   |        535 |     22 |        1 |        63 |        570 |      1,409,618 |           100.0% |              44.19 |
| claude      | claude-sonnet-5            |        435 |     11 |        1 |         3 |      1,056 |        226,004 |           100.0% |              45.17 |
| claude      | claude-sonnet-4-6          |        429 |      7 |        1 |         1 |        205 |         21,329 |           100.0% |               7.80 |
| gpt         | gpt-5.6-luna               |        207 |      6 |        1 |    11,362 |      1,298 |        437,121 |            97.5% |              13.01 |
| claude      | claude-opus-4-6            |        141 |      7 |        1 |        78 |     25,514 |      6,405,636 |           100.0% |             269.98 |
| gemini      | claude-opus-4-1-20250805   |        133 |      5 |        1 |        14 |        116 |        467,638 |           100.0% |               0.24 |
| antigravity | claude-opus-4-1-20250805   |         84 |      5 |        1 |        10 |        128 |        328,930 |           100.0% |               0.16 |
| claude      | MiniMax-M3                 |         80 |      4 |        1 |     9,036 |        406 |         74,494 |            89.2% |               0.87 |
| gpt         | gpt-5.6-terra              |         68 |      4 |        2 |    23,059 |      4,165 |        448,358 |            95.1% |              15.84 |
| gpt         | claude-opus-4-1-20250805   |         62 |      4 |        1 |        22 |        276 |        861,107 |           100.0% |               0.26 |
| antigravity | gemini-3.5-flash-low       |         43 |      3 |        1 |    38,319 |      2,462 |              0 |             0.0% |               6.53 |
| antigravity | gemini-pro-agent           |         42 |      3 |        1 |    12,457 |      1,261 |              0 |             0.0% |               2.36 |
| gpt         | gpt-5.6-sol                |         39 |      2 |        1 |     6,938 |        463 |         85,346 |            92.5% |               3.44 |
| antigravity | claude-sonnet-4-20250514   |         37 |      1 |        1 |        10 |         84 |        550,901 |           100.0% |               0.05 |
| gemini      | claude-sonnet-4-20250514   |         37 |      1 |        1 |        10 |         84 |        550,901 |           100.0% |               0.05 |
| antigravity | gemini-3-flash-agent       |         28 |      3 |        1 |    32,905 |      1,978 |              0 |             0.0% |               0.17 |
| grok        | grok-4.5-build             |         12 |      4 |        1 |    46,843 |      6,720 |        543,029 |            92.1% |               2.91 |
| custom      | claude-opus-4-1-20250805   |         11 |      2 |        1 |         6 |         63 |         55,974 |           100.0% |               0.01 |
| custom      | claude-sonnet-4-20250514   |          3 |      2 |        1 |        15 |          7 |         34,149 |           100.0% |               0.00 |
| gpt         | claude-sonnet-4-20250514   |          3 |      1 |        1 |        25 |         94 |        186,432 |           100.0% |               0.00 |
| antigravity | gemini-3-flash-a           |          3 |      3 |        1 |    45,068 |        860 |              0 |             0.0% |               0.02 |
| gemini      | `<synthetic>` (unresolved) |          2 |      1 |        1 |       288 |      2,579 |     16,590,459 |           100.0% |               0.08 |
| antigravity | `<synthetic>` (unresolved) |          2 |      1 |        1 |       288 |      2,579 |     16,590,459 |           100.0% |               0.08 |
| claude      | claude-opus-4-7            |          2 |      1 |        1 |     3,885 |    402,329 |     84,706,354 |           100.0% |             418.88 |
| antigravity | gemini-default             |          1 |      1 |        1 |    46,473 |      2,432 |              0 |             0.0% |               0.18 |
| local       | claude-opus-4-1-20250805   |          1 |      1 |        1 |         6 |          2 |              0 |             0.0% |               0.00 |

What the grid actually shows, stated conservatively:

- **Cache reads dominate.** Where a harness reports cache tokens at all, they are
  89–100% of input volume. Orchestrated work is overwhelmingly re-reading context,
  not sending fresh input. This is the most robust pattern in the sample and the
  one we would expect to generalize.
- **Harnesses report tokens very differently.** The `claude` harness reports
  single-digit average input with a huge cache-read figure; `gpt` reports ~20k
  input with no cache _writes_ at all; the Gemini-family rows report no cache
  tokens whatsoever. Rows are not comparable across harnesses even before the
  confounds — the columns do not mean the same thing.
- **Rows are polls, not turns.** `claude-opus-4-7` shows 402,329 average output
  tokens across 2 rows, which is impossible for a single turn. It is a reconnect
  re-reading a session file in one poll. Any per-turn reading of this table is
  wrong.
- **Model attribution leaks across harnesses.** `gemini`, `antigravity`, `gpt`,
  `custom` and `local` rows all show `claude-*` model ids. Those are unresolved
  model ids falling back to a default, not those harnesses running Claude.
- **The `<synthetic>` and bare-`claude` rows are broken, and are shown anyway.**
  2,297 of 95,107 usage rows (2.4%, from the gaps table below) carry an unresolved
  model id. The $4,137.74 against `<synthetic>` is a pricing artifact from a
  since-removed fallback rate, not real work.
- **Two pairs of rows are the same work written twice.** The `gemini` and
  `antigravity` rows for `claude-sonnet-4-20250514` (37 rows each) and for
  `<synthetic>` (2 rows each) are identical down to the token counts and the
  minute. They are two different agent ids carrying one session from 2026-06-02,
  written once under each harness name. See
  [duplicate writes](#duplicate-writes-a-measured-lower-bound) for how far that
  problem extends.

### What the cost column is not

The imputed-cost column sums to a large number. It is not our bill, and we are
not presenting it as one:

- Nearly all of this work ran under flat-fee subscription plans. The pipeline
  prices it at list API rates regardless, so the imputed figure is far above money
  actually spent. It is an "API-equivalent value" only.
- Cache pricing is a 0.1×/1.25× rule of thumb rather than a quoted rate, and with
  cache reads at 90–100% of volume that assumption drives most of the total.
- No idempotency key exists on the insert, so the same delta can be written
  twice. Bounded below at 130 rows and $359.61 — see
  [duplicate writes](#duplicate-writes-a-measured-lower-bound).
- Unpriceable models bill $0, so the total also under-counts wherever model
  resolution failed.

Fixing that column is tracked work. Until it is fixed, **cost per ticket by
harness is not measured** and no such table appears here.

### Duplicate writes: a measured lower bound

`10-duplicate-usage-rows.sql`

| Measure                                           |   Value |
| ------------------------------------------------- | ------: |
| Token-bearing usage rows                          |  48,206 |
| Redundant copies                                  |     130 |
| …of which written under different agent ids       |     115 |
| Imputed cost attributable to the redundant copies | $359.61 |

Rows that are byte-identical on install, receipt timestamp, model and all four
token counts are near-certainly one delta written more than once — the pattern
visible in the `gemini`/`antigravity` pairs above. Excluding zero-token rows (rate
limit emits collide by coincidence and would inflate this roughly tenfold), that
is 0.27% of token-bearing rows.

**This is a lower bound, not the answer.** The other duplication path — a
reconnect re-reading a session file from the start — produces one oversized row
rather than an identical copy, so it is invisible to this query and remains
unquantified. The `claude-opus-4-7` row in the grid above, 402,329 average output
tokens across 2 rows, is what that path looks like.

## Process reliability

`03-harness-reliability.sql`

`agent:crashed` means the CLI child process exited non-zero as our supervisor saw
it — including auth failures, rate-limit exits and some user kills. It measures
how often that CLI fell over _inside Marblo_, which is partly a property of our
own integration. It is not a measure of model quality.

| Harness     | Spawned | Abnormal exit |  Rate | Restarted | Stopped | Installs |
| ----------- | ------: | ------------: | ----: | --------: | ------: | -------: |
| claude      |   2,480 |           419 | 16.9% |       601 |     439 |       11 |
| gpt         |   1,985 |           514 | 25.9% |       529 |     280 |       15 |
| gemini      |     119 |             2 |  1.7% |         3 |      14 |        1 |
| antigravity |      97 |            22 | 22.7% |        27 |      29 |        8 |
| grok        |      21 |             4 | 19.0% |         4 |       6 |        1 |
| custom      |       3 |             0 |  0.0% |         0 |       1 |        1 |
| local       |       1 |             0 |     — |         0 |       1 |        1 |
| codex       |       1 |             0 |     — |         0 |       1 |        1 |

Rates are the two published integers divided; rows with n < 5 show no rate.

`gemini` and `antigravity` are both the Gemini-family CLI under two harness ids —
`gemini` is the older label. At least one session is recorded under both (see the
grid above), so they are not independent and must not be summed. The bottom four
rows are too small to interpret at all.

Roughly one in five agent processes ends abnormally. That is our headline
reliability problem, and it is a Marblo problem as much as a vendor one.

## Ticket outcomes

Attribution funnel — `04-attribution-funnel.sql`. Every drop-off is printed:

| Stage                                  | Tickets |
| -------------------------------------- | ------: |
| Ticket outcome rows recorded           |     436 |
| Linked to at least one agent           |     407 |
| That agent has a resolvable harness    |     378 |
| Worked by exactly one harness (usable) |     362 |

Outcomes by harness — `05-ticket-outcomes-by-harness.sql`:

| Bucket              | Tickets | Self-reported success | Median wall-clock |      Retries |
| ------------------- | ------: | --------------------: | ----------------: | -----------: |
| claude              |     254 |                   245 |          25.4 min | not measured |
| gpt                 |     101 |                    96 |          11.1 min | not measured |
| mixed (2 harnesses) |      15 |                    14 |          64.7 min | not measured |
| grok                |       5 |                     1 |           9.1 min | not measured |
| antigravity         |       2 |                     2 |           0.3 min | not measured |
| mixed (3 harnesses) |       1 |                     1 |         223.7 min | not measured |

Read this table with all three caveats or not at all:

1. **Success is `E0` — the agent's own report.** An agent that misread the ticket
   and submitted a confident wrong diff counts as a success here. A 96% figure is
   what self-grading produces, not a correctness measurement.
2. **Wall-clock is ticket lifetime**, including queueing and overnight idle. It is
   not agent working time and does not say one harness is faster.
3. **The small cells are not results.** grok at 1/5 is five tickets during a
   week when that integration was actively being debugged; it says nothing about
   grok. antigravity at 2/2 says nothing either.

`retriesCount` is present in the schema and is `0` on all 436 rows — nothing ever
writes it. It is a defined-but-dead field, reported as not measured rather than
as zero retries.

Work mix — `06-work-taxonomy.sql`, all 28 rows:

| Task type      | Role     | Tickets | Self-reported success | Median wall-clock |
| -------------- | -------- | ------: | --------------------: | ----------------: |
| bug-fix        | backend  |      84 |                    76 |          17.1 min |
| test           | backend  |      53 |                    52 |          25.4 min |
| bug-fix        | frontend |      43 |                    43 |          23.2 min |
| (unclassified) | backend  |      43 |                    37 |         106.0 min |
| (unclassified) | frontend |      26 |                    25 |         367.4 min |
| bug-fix        | devops   |      18 |                    16 |          18.2 min |
| (unclassified) | devops   |      14 |                    13 |         143.4 min |
| feature        | backend  |      13 |                    13 |          46.3 min |
| refactor       | backend  |      13 |                    13 |          22.9 min |
| test           | devops   |      12 |                    11 |          14.4 min |
| docs           | frontend |      12 |                    11 |          60.4 min |
| docs           | backend  |      12 |                    12 |          18.5 min |
| feature        | frontend |      12 |                    11 |          23.8 min |
| test           | test     |      11 |                    10 |          11.6 min |
| infra          | backend  |      10 |                     8 |          30.4 min |
| infra          | devops   |      10 |                     9 |          13.9 min |
| refactor       | devops   |       9 |                     9 |          11.7 min |
| refactor       | frontend |       9 |                     9 |         822.9 min |
| bug-fix        | test     |       8 |                     7 |           9.5 min |
| test           | frontend |       6 |                     6 |          11.1 min |
| infra          | frontend |       6 |                     5 |          30.4 min |
| feature        | devops   |       3 |                     3 |          21.7 min |
| (unclassified) | test     |       2 |                     2 |         165.0 min |
| docs           | devops   |       2 |                     2 |          13.7 min |
| chore          | frontend |       2 |                     1 |          32.9 min |
| chore          | devops   |       1 |                     1 |           2.7 min |
| refactor       | test     |       1 |                     1 |        3126.4 min |
| chore          | backend  |       1 |                     1 |         621.0 min |

Rolled up across roles — `06b-work-taxonomy-rollup.sql`:

| Task type      | Tickets | Share |
| -------------- | ------: | ----: |
| bug-fix        |     153 | 35.1% |
| (unclassified) |      85 | 19.5% |
| test           |      82 | 18.8% |
| refactor       |      32 |  7.3% |
| feature        |      28 |  6.4% |
| docs           |      26 |  6.0% |
| infra          |      26 |  6.0% |
| chore          |       4 |  0.9% |

The mix matters as much as the outcomes. Over half the sample is `bug-fix` and
`test` work on a single codebase, and 19.5% of tickets were never classified at
all. Only 28 tickets — 6.4% — are `feature` work, so nothing here describes how
Marblo handles greenfield building.

## Routing

`07b-routing-explicit-share.sql`

| Who chose the harness              | Decisions | Share |
| ---------------------------------- | --------: | ----: |
| A human named it in the prompt     |     1,452 | 90.2% |
| The orchestrator's scorer chose it |       158 |  9.8% |

This is the single most important confound in the whole document. In 90.2% of
dispatches the operator named the harness, usually because they already believed
one suited the ticket. Any per-harness outcome difference above is therefore
mostly a measurement of the operator's prior, not of the harness.

It also caps what we can say about routing itself: 158 scored decisions is too
few to evaluate the scorer, so **routing quality is not measured**. The
per-decision breakdown is in `07-routing-decisions.sql`.

## Known measurement gaps

`08-data-quality-gaps.sql` — the pipeline's own defects, measured:

| Gap                                               | Measured | Out of |
| ------------------------------------------------- | -------: | -----: |
| Usage rows with an unresolved model id            |    2,297 | 95,107 |
| Usage rows carrying a pricing snapshot            |        0 | 95,107 |
| Usage rows carrying a `taskId`                    |   24,732 | 95,107 |
| Usage rows carrying a `taskType`                  |        0 | 95,107 |
| Ticket outcomes with a non-zero retry count       |        0 |    436 |
| Ticket outcomes with an error category on failure |       29 |     29 |
| Ticket outcomes with a declared task type         |      351 |    436 |
| Workflow executions recorded                      |        0 |      0 |

Consequences, stated rather than worked around:

- **`taskType` is never written to `cost_logs`** (0 of 95,107). Cost cannot be
  broken down by kind of work at all; it has to be recovered by joining tickets
  on `taskId`, which only 26% of usage rows carry.
- **`pricingSnapshot` is never written** (0 of 95,107), so historical rows cannot
  be re-priced when the rate table changes. This is why the `<synthetic>` rows
  still carry a rate that no longer exists.
- **Failure classification does work** — all 29 failed tickets carry an error
  category. This is the one column in the table that is fully populated.

## What this snapshot does not contain

Listed so that absence is explicit rather than inferred:

- **No comparison result.** No harness or model is ranked, scored, or recommended
  on the basis of this data, because a T0 observational sample from one operator
  cannot support it.
- **No external usage.** 3 installs have ever completed ten tickets. Nothing here
  describes how Marblo behaves in someone else's fleet.
- **No verified correctness.** `E1`–`E3` (reviewer approval, merge, survival) are
  not instrumented. Only self-reported success exists.
- **No cost-per-ticket.** The cost column is defective in four known ways.
- **No workflow metrics.** `flow_executions` has never been written to.
- **No latency of agent work.** Only ticket wall-clock, which is dominated by
  human and queue time.

The next snapshot will be published whether or not the numbers improve.
