# The harness axis

**"Model A scores N points higher than model B" is not a claim you can make without
fixing the harness.** This page shows why, using published numbers from the
benchmark owners themselves, and then states what we intend to measure on that axis
— and what we have not measured yet.

This is a companion to [methodology.md](methodology.md), which defines the
framework, and [dogfooding-2026-07.md](dogfooding-2026-07.md), which holds our own
observational data. Nothing here revises either.

---

## 1 · The same model, the same benchmark, two harnesses

These four rows are from the benchmark owner's public leaderboard and the model
vendors' own publications. Each pair is **the same model on the same problem set**,
differing only in the scaffold that drove it.

| Model                     | Benchmark          | Harness                                 | Score     | As of      |
| ------------------------- | ------------------ | --------------------------------------- | --------- | ---------- |
| GLM-4.6                   | SWE-bench Verified | vendor scaffold (Z.ai's own submission) | **68.2**  | 2025-09-30 |
| GLM-4.6                   | SWE-bench Verified | mini-SWE-agent 1.17.1 (T=1, Attempts=1) | **55.4**  | 2025-12-01 |
|                           |                    | _same model, same benchmark_            | **−12.8** |            |
| claude-haiku-4-5-20251001 | SWE-bench Verified | vendor-internal simple scaffold         | **73.3**  | 2025-10-15 |
| claude-haiku-4-5-20251001 | SWE-bench Verified | mini-SWE-agent 2.0.0 (high reasoning)   | **66.6**  | 2026-02-17 |
|                           |                    | _same model, same benchmark_            | **−6.7**  |            |

Sources: the leaderboard rows are from swebench.com's Verified leaderboard; the
vendor-scaffold rows are from Z.ai's own comparison table and Anthropic's Haiku 4.5
announcement (Methodology section). We hold every one of these with its source URL
and an `asOf` date, and a row without a source URL fails to load.

**Read the second column, not just the last one.** A 12.8-point spread produced by
the scaffold alone is larger than most of the gaps that model comparisons are
written about. Two consequences follow immediately:

1. A leaderboard that lists a model once has silently fixed a harness, and the
   choice of harness is doing part of the work being attributed to the model.
2. Any table that collapses harness and model into a single column is measuring a
   confound. In our own schema, `harness` is a first-class field and the comparison
   helper refuses to group rows whose harness keys differ.

## 2 · Two more things the public numbers do not give you

While assembling that reference table we hit two limits worth stating, because both
constrain what anyone — us included — can honestly compare.

**There is no benchmark variant that covers every model.** SWE-bench is not one
benchmark; Verified, Pro, Multilingual and Multimodal are **different problem sets**
and are never comparable to each other. As of our last survey (2026-07-28), GPT-family models did
not publish Verified at all — not in the vendor's own tables, not on the leaderboard
— while Claude-family frontier models published Verified but did not appear on the
public leaderboard's common scaffold. So "put every model on Verified" is not a
choice that is available; the data does not permit it. There _is_ a shared axis
(Pro), and it happens to be cross-checked between competitors: one vendor's table
carried a rival's Pro scores, and they match that rival's own system card exactly.
Numbers that survive that kind of accidental cross-check are the ones worth quoting.

**Scaffold versions move scores.** The same scaffold at 1.17.1 and at 2.0.0 is not
the same harness, which is why our rows carry the scaffold version rather than just
its name.

The practical upshot for a reader comparing agent CLIs: **the vendor's headline
number and the number you will get are separated by your scaffold**, and the size of
that separation is not small.

## 3 · What we can measure on this axis that a vendor cannot

A model vendor sees its own model. A benchmark owner accepts submissions. Neither is
positioned to run **the same task through several vendors' CLIs on identical wiring**
— that requires being the thing that spawns them.

Marblo is that thing incidentally, not by design: to orchestrate a heterogeneous
fleet, it already spawns Claude Code, Codex, Grok and env-swap vendors from one
process with the same ticket context, the same MCP toolset and the same worktree
isolation. Running a controlled comparison across that grid is a use of existing
machinery, not a new system.

Two figures fall out of that position and out of no other:

- **Harness sensitivity measured on identical wiring** — the §1 spread, but on tasks
  and a scaffold that are held constant by construction rather than by hope.
- **Cost per resolved ticket, across vendors.** A vendor prices its own tokens. "The
  same ticket costs $X through A and $Y through B" requires running both, and it is
  the number practitioners actually budget against. (Ours would be an
  [imputed](methodology.md#cost-is-imputed-not-billed) figure and would be labelled
  as one.)

We are being deliberate about the boundary here. Of the standard criticisms of
public coding benchmarks — saturation, memorization, broken tasks, inconsistent
variants, unmeasured harness sensitivity — we can only claim to genuinely address
the last three. Saturation we would only "fix" by making our own tasks harder, which
is self-serving and unfalsifiable. Memorization we would only delay: publishing a
task set starts its contamination clock, and rotation postpones that rather than
preventing it. Listing five advantages when we have three is the fastest way to lose
a technical reader, and the three are enough.

## 4 · The experiment, pre-committed and not yet run

The honest status of this section is **designed, not run**. It is written down first
so that the design cannot be tuned after seeing results — a commitment that is worth
nothing unless it is public before the data exists.

**Shape.** Twelve tasks × three harnesses × one repetition = **36 runs**.

**Tasks.** Drawn only from tickets we actually merged, so a correct solution is known
to exist — which structurally excludes the broken-task problem that audits have found
in public sets. Tasks are rewritten before publication (repository paths, identifiers
and any customer trace removed), and only first-party work is eligible. Tasks without
a machine-checkable acceptance test are dropped rather than escalated to human
grading, because a design that needs 36 human judgements does not survive its second
round.

**Controls.**

| Control                                                                                                             | Removes                                                 |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Assignment and execution order randomized                                                                           | our own preference for "this ticket suits that harness" |
| Identical ticket text, identical base commit, fresh worktree per run                                                | difficulty drift between cells                          |
| Grading rubric, task list, cell layout and n **committed before the run** — the commit hash is the pre-registration | rubric that moves after seeing results                  |
| Diff review blind to which harness produced it                                                                      | reviewer bias, ours included                            |
| Every table keyed on the `(model, harness)` tuple                                                                   | the collapse described in §1                            |

**Scoring is four axes, never summed into one.** Completion (acceptance test passes),
acceptance (blind reviewer accepts the diff), cost (tokens → imputed dollars), and
**no-output** — whether the agent produced any change at all. That last axis is the
one that is missing from vendor benchmarks and the one we most need: our own outcome
labels have recorded "did nothing, reported success" as a success, and without
separating it, "13× cheaper" cannot be distinguished from "did not do the work".

**Why 36 runs beats 95,107 rows.** We have far more observational data than this
experiment will produce, and it supports a _weaker_ claim. Assignment in the
observational data was not randomized — most dispatches had the model named by a
human — difficulty was never matched across harnesses, and one operator dominates the
sample. Those confounds are not fixable by collecting more rows. A small
pre-registered randomized comparison licenses "in this condition, A completed more
often than B"; a large observational table licenses "here is what we did". Randomizing
is cheaper than buying your way out of a confound.

**What it will still not support.** General coding ability. Other repositories. Other
orchestrators. Model ability without our wiring. It measures one thing: _how a
(model, harness) pair handles tickets of the kind that appear on our board, inside our
wiring._ That is narrow — and stating the narrowness first is the condition for the
result being worth anything.

## 5 · Rules this axis inherits, and one it adds

All eight [honesty rules](methodology.md#honesty-rules) carry over unchanged. A
controlled round takes on four more obligations:

1. **Pre-registration.** Task list, cells, rubric and n committed before execution;
   the commit hash is cited in the publication.
2. **Run logs published** — per run: model, harness, versions, exit code, tokens,
   grade. Diffs and prompt text are not published.
3. **Unfavourable rounds are published.** Suppressing one round retroactively
   devalues every other.
4. **We run every cell ourselves; vendor submissions are not accepted.** This is also
   the only contamination defence that actually holds: a vendor can overfit to a
   published task set, but only runs we executed on our own wiring appear in the
   table.

And one invariant this axis adds, which is really a constraint on the product rather
than on the benchmark:

> **Benchmark output must never feed the router.** If our published results became an
> input to model selection, the loop closes — the bench prefers A, the router spawns
> more A, the next round eats that data. The existing table of published third-party
> scores is already held to this rule mechanically, by a test that source-scans for
> imports from any routing module. Anything we publish ourselves inherits the same
> guard. A human updating a constant after reading a result is fine; an automatic
> path is not.

## 6 · Doing this yourself

The most useful thing on this page is not our future numbers — it is that the axis is
cheap for anyone to check, and does not require our tooling:

1. Take one task your team has already solved, so a correct answer is known to exist.
2. Run it through two agent CLIs at the **same model tier**, from the same base
   commit, in separate worktrees.
3. Grade with a test, not an opinion. Record whether each produced any change at all.
4. Compare that spread against the vendor headline numbers you were choosing on.

If your spread is materially smaller than the published 6.7–12.8 point range, that is
a genuinely interesting result and we would like to hear it. The
[`code-review` skill](../../skills/code-review/) and the
[`reviewer` agent](../../agents/reviewer/) in this repository are plain files that run
in the CLI you already have, if a consistent grading pass is useful.

---

## Status

| Item                                                        | Status                                         |
| ----------------------------------------------------------- | ---------------------------------------------- |
| Harness sensitivity from published third-party sources (§1) | **established** — sourced, dated, reproducible |
| Variant-coverage gaps across vendors (§2)                   | **established** — sourced                      |
| Harness sensitivity reproduced on **our** wiring            | **not measured**                               |
| Cost per resolved ticket, cross-vendor                      | **not measured**                               |
| Controlled replay round (§4)                                | **designed, not run**                          |

We are not going to write "we also see this spread" before running it. Until §4
executes, §1 is other people's data and is labelled as such.

---

[← Benchmark index](README.md) · [Methodology](methodology.md) · [Our observational
snapshot](dogfooding-2026-07.md) · [How the fleet actually runs](../how-it-works/)
