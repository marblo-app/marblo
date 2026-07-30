# Benchmark

How Marblo measures orchestrated coding work, and every number we currently have
from running Marblo on Marblo.

- **[methodology.md](methodology.md)** — the framework: what a ticket-level
  benchmark measures that a model benchmark does not, the harness × model grid,
  the metrics and what each one is allowed to claim, the four evidence tiers, and
  the honesty rules these documents follow.
- **[dogfooding-2026-07.md](dogfooding-2026-07.md)** — the data, snapshot
  2026-07-29. Coverage, the harness × model grid, process reliability, ticket
  outcomes, routing, and our own measurement gaps.
- **[queries/](queries/)** — the SQL behind every figure, plus `run.sh` to
  re-run it.

## What you will not find here

**A claim that Marblo, or any harness or model in it, is best at anything.**

Our telemetry is internal dogfooding data. In the current snapshot, 38 installs
have opened the app, 15 have ever spawned an agent, 3 have completed ten or more
tickets, and one install accounts for 95,103 of 95,107 usage rows. Harness
assignment was never randomized — 90.2% of dispatches had the model named by a
human. Ticket difficulty was not controlled. The heaviest operator is the author
of the tool.

That is a sample that can describe our own usage honestly and cannot rank
anything. So this directory publishes what we measured, what it means, what is
broken in our own pipeline, and what a benchmark that _could_ support comparison
would have to look like — and stops there. A leaderboard built on this sample
would be marketing wearing a lab coat.

## The rules these documents follow

1. Every table prints its n.
2. Every filter appears as a printed funnel step. No silent caps.
3. An unmeasured cell says "not measured", never `0` and never blank.
4. Every figure traces to committed SQL in [`queries/`](queries/).
5. Snapshot windows close on a full day, so re-running reproduces the numbers.
6. Known-defective metrics are published with the defect attached, not dropped.
7. No superlatives from observational data.
8. If one install dominates the sample, that leads the document.

Full statement of each rule and why it exists:
[methodology.md § honesty rules](methodology.md#honesty-rules).

## Status

| Evidence tier | Design                                                         | Status                                      |
| ------------- | -------------------------------------------------------------- | ------------------------------------------- |
| T0            | observational telemetry from real usage                        | running — [snapshot](dogfooding-2026-07.md) |
| T1            | controlled replay, same ticket across harnesses, blind grading | designed, not run                           |
| T2            | public task set reproducible outside our repo                  | not built                                   |
| T3            | multi-org fleets                                               | blocked on adoption                         |

Found a hole in the method or an error in the numbers? Open an issue — see
[CONTRIBUTING.md](../../CONTRIBUTING.md).
