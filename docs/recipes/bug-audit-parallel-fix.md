# Playbook — Bug audit → parallel fix

**Point several agents at a subsystem, collect what they claim is broken, kill the claims that don't survive scrutiny, then fix the survivors in parallel.**

The reason this is a two-phase playbook with a gate in the middle: **an audit finding is a claim, not a fact.** Agents are good at producing plausible defects and quite bad at knowing which of theirs are real. Skip the verification phase and you spend your fix budget on code that was never broken — and worse, you "fix" correct code, which is how an audit makes a codebase less stable than it was.

|                 |                                                                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fits**        | A subsystem you inherited or don't trust; a pre-release sweep; recurring incidents with no single reproducer; hardening a path that handles money, auth, or user data. |
| **Doesn't fit** | A specific known bug — that's one ticket and a debugger, not a fleet. Don't audit to avoid debugging.                                                                  |
| **Shape**       | read-only audit by dimension → cross-vendor verification per finding → dedup → 1 ticket per confirmed bug → merge smallest-first.                                      |
| **Expect**      | A large share of first-pass findings not to survive verification. That's the system working, not failing.                                                              |

---

## 1. Audit by dimension, not by file

Splitting an audit by file gives every agent the same lens and the same blind spots, N times over. Split by **failure mode** instead: each agent reads the whole subsystem through one specific kind of question, and they find different things because they're looking for different things.

Dimensions that consistently earn their spawn:

| Dimension               | The question the agent holds                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| **Error paths**         | What happens on the failure branch — is it swallowed, mis-typed, does it leave state half-written? |
| **Boundaries**          | Empty, null, zero, one, maximum, unicode, negative, duplicate, concurrent-identical.               |
| **Resource lifecycle**  | Who closes it, who cancels it, what happens on early return or throw?                              |
| **State & concurrency** | Two of these at once; retries; a partial write followed by a crash.                                |
| **Trust boundary**      | What comes from outside and is treated as if it came from inside.                                  |

Create them as one batch, all read-only, all with the same hard constraint:

```
You → Create 5 audit tickets over src/payments/, one per dimension:
      error-paths, boundaries, resource-lifecycle, state-concurrency,
      trust-boundary.

      Identical for each:
        goal:       Find real defects in src/payments/ through the <dimension> lens.
        changes:    []   — READ ONLY. No code changes, no test changes, no PR.
        acceptance: - each finding: file:line, what breaks, and a concrete
                      failure scenario (inputs/state → wrong output or crash)
                    - each finding rated blocking / non-blocking, with why
                    - findings reported as ticket activity, not as a diff
        notes:      - Do not fix anything. A fix in this ticket is a failure
                      of this ticket.
                    - No stylistic or "consider refactoring" findings. Only
                      things that produce wrong behavior.
                    - If a finding needs a fact you can't check from the code,
                      say what fact and mark it unverified.

      Spread these across different vendors — I don't want five instances of
      one model. complexity standard, role backend.
```

Three lines in there do most of the work:

- **`changes: []` plus "a fix here is a failure of this ticket."** Without it you get fixes mixed into the audit, and then there's no gate left — you're merging unreviewed changes to code you asked someone to be suspicious about.
- **"A concrete failure scenario."** This is the single best filter available. Requiring _inputs → wrong output_ forces the agent past "this looks fragile." Most unreal findings die right here, before you spend anything on verification, because the agent cannot construct the scenario.
- **"No stylistic findings."** Otherwise the report is 40% naming preferences and the real defects are buried in it.

**Different vendors across dimensions is the point.** Vendors have genuinely different blind spots. Five spawns of one model is roughly one audit with extra billing.

## 2. Verify every finding — adversarially, by someone else

This is the gate, and it is the reason this playbook exists. Each finding goes to a **different** vendor than the one that raised it, and the verifier's job is to **refute** it, not to assess it.

```
You → For every finding from the audit tickets, create a verification ticket
      on a different vendor than the finder:

        goal:  Refute this finding: "<finding text, verbatim, with file:line>"
        changes: []  — read only
        acceptance:
          - verdict: REAL or NOT-REAL, one of them, no "possibly"
          - if REAL: the exact inputs/state that trigger it, and the observable
            wrong behavior
          - if NOT-REAL: which specific line, guard, caller contract, or type
            makes it impossible
        notes:
          - Your job is to break this claim. Default to NOT-REAL when you
            cannot construct the failing scenario yourself.
          - Do not trust the finder's reasoning. Re-derive it from the code.
          - "Real but unreachable in practice" is NOT-REAL. Say why it's
            unreachable.

      Batch these — they're small and independent. complexity simple unless
      the finding involves concurrency, then standard.
```

Why each rule is there:

- **"Default to NOT-REAL when uncertain."** A verifier without a default drifts to agreement. This is asymmetric on purpose: killing a real bug costs you one bug that was already there; approving a fake one costs you a change to working code plus the review time.
- **A different vendor.** Non-negotiable. A model verifying its own family's finding is the whole failure this step exists to prevent.
- **"Re-derive from the code."** Otherwise the verifier grades the finder's prose, which is always more coherent than the code it describes.
- **For findings that could be wrong in several ways** — a concurrency bug that's also a permissions question — give each verifier a distinct lens rather than running three identical refuters. Diverse lenses catch what redundancy can't.

For the small number of findings where the stakes are high and the answer is genuinely unclear, the `complex` + `mix: "cross-check"` path spawns a top Claude model and a Codex high-effort model on the same question and cross-verifies. Two independent derivations, 2× the cost of one ticket. Worth it on a money path; wasteful as a default.

## 3. Dedup and triage — this part is yours

Now you read. This step is manual and short, and delegating it is a mistake: it's where you decide what your codebase's problems actually are.

1. **Collapse duplicates.** Five dimensions on one subsystem will surface the same defect from three angles. Same root cause = one fix ticket, listing all the symptoms.
2. **Look at the NOT-REAL pile before you throw it out.** A finding that three agents raised and a verifier correctly refuted usually means the code is _confusing_, not broken. That's a comment or a rename ticket, at low priority — cheap, and it stops the next audit re-finding it.
3. **Order by blast radius, not by count.** One trust-boundary hole outranks nine boundary-condition nits.
4. **Decide what you're not fixing, explicitly.** An audit produces more true findings than you will fix. Write the deferred ones down as low-priority tickets so the decision is recorded, rather than letting them evaporate.

```
You → Here's my triage. Create fix tickets for findings 2, 4, 7, 9 and 11.
      Findings 3 and 8 are the same root cause — one ticket, both symptoms
      in the goal. Findings 1, 5, 6 were refuted; make one low-priority
      ticket to add clarifying comments where they kept getting misread.
      Findings 10 and 12 are real and deferred — priority 1 tickets, no
      dispatch, tagged deferred-audit.
```

## 4. Fix in parallel — one ticket per bug, each with a failing test first

Every fix ticket carries the same non-negotiable structure. The test that fails before the fix is what distinguishes a fix from a plausible edit.

```
You → For each confirmed finding, a fix ticket:

        goal:       Fix <finding>: <one line on the wrong behavior>
        changes:    - the minimal fix
                    - a regression test that fails before it and passes after
        acceptance: - the new test fails on current main (paste the failure)
                    - the new test passes with the fix (paste the pass)
                    - full test suite for this module passes
                    - diff touches only what the fix requires
        notes:      - Write the failing test first. If you can't make a test
                      fail, the finding may be wrong — stop and report that
                      instead of fixing.
                    - No refactoring. No adjacent cleanups. Minimal diff.
        scope:      [<the one or two files involved>]
        complexity: simple, or standard if the fix crosses module boundaries
        role:       backend (test, if the fix is test-only)
```

**"If you can't make a test fail, stop and report."** This is the last line of defense, and it catches findings that survived verification by being _articulate_. An agent that can't produce a red test for a claimed bug has just given you the most useful result in the whole run.

**Small scope, small models.** Most confirmed bug fixes are a few lines. `simple` is right for the majority, and if you find yourself putting everything on `complex`, either your fixes aren't minimal or your triage let architecture work in wearing a bug's clothes.

Fixes are independent, so they fan out to your concurrency cap. Watch for the fix ticket whose diff comes back much larger than its siblings' — that's a fix that turned into a redesign, and it belongs in its own conversation, not in this batch.

## 5. Merge smallest first, and re-run the suite each time

Fix PRs are independent but they land in the same files often enough to matter. **Smallest diff first**, rebase each onto current base, re-run the suite.

For each: review ([Review & safe merge](review-and-safe-merge.md)) with one extra check specific to this playbook — **read the test, not just the fix**. A regression test that passes both before and after the change is worse than no test, because it certifies the bug as fixed forever. If the ticket pasted a real red-then-green pair, you have that for free; if it didn't, check by hand before merging.

Then `merge_and_close` per ticket: it verifies the merge, flips to `DONE`, reaps the worktree, and refuses if the PR isn't actually merged.

## What you end up with

- A set of small fix PRs, each carrying its own failing-then-passing test — the highest-confidence diffs an agent fleet produces.
- A written verdict on every finding, including the refuted ones and _why_ they were refuted. This is the artifact that stops the next audit from re-finding the same nine non-bugs.
- Deferred-but-real findings on the board at low priority, as a decision rather than an omission.
- A clear read on which dimension actually pays off in your codebase. If four of five real bugs came from error paths, that's a fact about your code worth carrying into the next audit.

## Failure modes

**"Almost everything got refuted."** Most likely working as intended, and cheap — read-only audit tickets and small verification tickets are the least expensive things in this playbook. If it happens twice on the same subsystem, tighten the audit ticket: demand the failure scenario _and_ the specific line, and drop dimensions that produced nothing.

**"An audit agent opened a PR."** The `changes: []` and the "a fix here is a failure of this ticket" note weren't in the ticket. Close the PR, keep the findings, re-run the phase properly. Do not merge it because it looks fine — it bypassed the gate.

**"Verifiers agree with everything."** Check two things: are verifiers on a different vendor than finders, and does the ticket contain the explicit _default to NOT-REAL_ instruction? Without the default, verification degrades to paraphrase.

**"A fix broke something else."** The fix wasn't minimal, or it landed without a full module suite run. Both are acceptance-list failures, not agent failures — the ticket let it through.

**"The audit found nothing but the bugs are still there."** Your dimensions didn't match your failure mode. Reach for the actual incident history: take your last five production incidents, name the class each belonged to, and make those the dimensions.

---

Next: **[Docs & asset harvest](docs-and-asset-harvest.md)** — the same orchestration applied to work that isn't code, using this repository as the worked example.
