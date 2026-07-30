# Playbook — Review & safe merge

**Take a ticket from "the agent says it's done" to merged, closed out, and clean — without letting anything onto `main` that nobody read.**

Every other playbook in this directory ends here. It is also the step people quietly skip when six tickets land at once, which is precisely when it matters: the failure mode of an agent fleet is not bad code, it is _plausible_ code arriving faster than anyone can read it.

Two claims this playbook is built on:

- **`REVIEW` is not `DONE`.** Submitting for review moves a ticket to `REVIEW`. Nothing about that merged anything, and nothing about a merge automatically closes the ticket. The two are connected by you.
- **An agent reviewing its own family's code is not a review.** Cross-vendor is the cheapest quality lever available in the whole system.

|           |                                                                                                     |
| --------- | --------------------------------------------------------------------------------------------------- |
| **Fits**  | Every agent-authored change, always.                                                                |
| **Shape** | independent review → resolve or explicitly waive → merge → four-part closeout.                      |
| **Cost**  | A review ticket is small and cheap. It is the highest return per token anywhere in these playbooks. |

---

## 1. Read the completion report before the diff

When a ticket hits `REVIEW` it should carry a completion report: what the problem was, what changed, and how it was verified. Read that first, and check it against the ticket's own acceptance criteria — which you wrote before the work started, and which the agent didn't get to edit.

Three cheap disqualifications, before any code:

- **The acceptance list isn't satisfied.** Send it back. Don't review a partial change into a complete one via review comments; that turns your review into the implementation plan.
- **"Verified" with no evidence.** A claim that tests pass, with no command output, is not verification. Ask for the paste.
- **The diff is much larger than the ticket.** Something extra came along. Ask for it to be split out before you read further — mixed diffs are how behavior changes hide inside mechanical ones.

## 2. Independent review — different vendor, adversarial framing

Dispatch a review ticket on a **different vendor** than the one that wrote the code. The [`reviewer` agent](../../agents/reviewer/) and the [`code-review` skill](../../skills/code-review/) in this repo are exactly this pass, written down; both are plain files that work in the CLI you already run, with or without Marblo.

```
You → Review ticket for <ticket>, role test, complexity standard, on a
      different vendor than the author, using the code-review skill:

      Goal: find defects in the diff for <ticket> before it merges.

      Acceptance:
        - findings ranked most-severe first; each one file:line, a
          one-sentence defect, and the concrete inputs/state that trigger it
        - each finding labelled BLOCKING or NON-BLOCKING with why
        - explicit verdict on whether the diff does what the ticket asked,
          and ONLY what the ticket asked
        - explicit check: does the change ship a test that would fail
          without it?
        - a clean review is a valid result — say so plainly rather than
          padding with style nits

      Notes: assume the author's reasoning is wrong until you've re-derived
      it from the diff. Verify each finding by constructing the failing
      scenario; if you can't construct it, drop it or mark it low confidence.
```

Passing `skills: ["code-review"]` on the dispatch routes the ticket to a vendor that actually has that skill installed and injects its usage contract — and if the skill name is missing or misspelled, the dispatch errors immediately with a suggestion rather than silently spawning an agent without it.

**Why "a clean review is a valid result" is in the acceptance list:** a reviewer that believes it must produce findings will produce findings. You want a reviewer that can come back empty, or you've just built a machine for generating style nits.

## 3. Read the diff yourself — these five things

Delegate the sweep, not the judgement. There is a short list an agent reviewer is structurally bad at, because each item requires knowing things that aren't in the diff:

| Check                   | Why an agent misses it                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Secrets & config**    | A plausible-looking key or a logged config value reads as normal code. Redaction is a house rule, not a pattern. |
| **Permissions & authz** | Whether _this_ caller should be able to do _that_ is product knowledge.                                          |
| **Data migrations**     | Reversibility and blast radius on real data live outside the repo.                                               |
| **Deletions**           | An agent cannot know that the "dead" code you removed is called by a cron job in another repo.                   |
| **Dependencies added**  | A new package for one format call is a supply-chain decision wearing a convenience mask.                         |

The Board's diff view is the fast path for this. Open the ticket, read the diff, and where something's wrong, drag-select the lines and right-click → **Comment to orchestrator**. The comment carries the file and line range, and the orchestrator routes it to the agent that wrote the code — it lands as a specific instruction about specific lines rather than a paragraph of prose the agent has to re-locate.

```
You → (line comment on api/routes/savedSearch.ts:42-48)
      This trusts req.body.userId. Take the id from the session, and add a
      test that a request claiming another user's id gets 403.
```

## 4. Resolve or waive — explicitly, on the record

Blocking findings have two legitimate outcomes, and "we'll get to it" is neither.

**Resolve:** back to the author agent, with the finding verbatim.

```
You → Send findings 1 and 3 back to the author. Both blocking. Finding 1
      needs a regression test with it. Re-run the review pass after the fix —
      same reviewer, so it's checking its own findings, not re-deriving them.
```

**Waive:** record the reason on the ticket. A waiver in chat is a waiver that never happened.

```
You → Finding 2 is a real edge case but that path is behind a flag that's off
      in production. Waive it, note the reason on the ticket, and create a
      priority 1 ticket to fix it before the flag flips.
```

Then re-review after the fix. A fix for a blocking finding is new, unreviewed code — the most common place unreviewed code enters `main` is the second commit on a branch that was already reviewed once.

## 5. Merge

Order first, when several PRs are ready: **dependency order, then smallest diff first.** Then, per PR:

1. **Rebase onto current base and re-run the tests.** Every time, including the third PR in a row. A branch that's behind base also makes a three-dot diff (`main...branch`) attribute other changes to it, so review _after_ the rebase, not before.
2. **On conflicts, use a resolver.** The orchestrator can put an agent into that worktree with a deterministic job: rebase onto base, resolve conflicts preserving both sides' intent, `git add` and `git rebase --continue` until clean, verify with `git status` — and if it can't, `git rebase --abort` and report why. Conflict resolution is the one place where an agent improvising is genuinely dangerous, which is why the flow is spelled out rather than left to judgement.
3. **Merge the PR** — you, or the orchestrator on your instruction. This is the authority step; nothing in Marblo lands code on `main` without it.

## 6. Close out — four actions, not one

Merging leaves three other pieces of state stale. `merge_and_close` does all four atomically:

```
Orchestrator → merge_and_close(task_id, dry_run: true)   # verdict, no writes
Orchestrator → merge_and_close(task_id)
```

What it actually does, and what it refuses to do:

- **Verifies the PR really is merged.** If it's still open or conflicting, it changes nothing and tells you. This is not a merge tool — it's the closeout for a merge that already happened.
- **Flips the ticket to `DONE`** through the normal state machine, not by writing the field directly.
- **Reaps the now-stale worktree.** Git's registration metadata survives a deleted directory, so this is a real step and not a cosmetic one.
- **Holds the ticket at `REVIEW`, with a reason, when the ticket says follow-up work is outstanding.** Code merged is not work done — a change can be live while the backfill still needs credentials or a dashboard rule awaits approval. Flipping those to `DONE` because the PR merged is how remaining work disappears.

That last behavior is the one worth internalizing: when `merge_and_close` declines to close a ticket, it is usually right, and the fix is to state the residual work explicitly rather than to force the flip.

Then confirm the ledger matches reality:

```
You → Which tickets are sitting in REVIEW right now, and for each, is its PR
      merged, open, or nonexistent?
```

Tickets in `REVIEW` whose PRs merged days ago are the characteristic residue of a busy day. They read as "needs merging" later and get re-investigated by someone — sometimes by an agent, which is worse.

The **Worktrees** tab is the visual version of the same audit: worktrees are categorized _In development_ / _Merge needed_ / _Cleanup · merged_ / _Cleanup · stale_, with merge history and links to GitHub. Anything sitting in _Cleanup · merged_ is a closeout you skipped.

> One safety rule: **never auto-remove a worktree with uncommitted changes.** Agents leave build artifacts there, but they also leave real work that isn't committed yet. Look before removing.

## What you end up with

- A merge history where every change was read by something that didn't write it, and by you for the five things agents can't judge.
- Waivers on the record with reasons and follow-up tickets, instead of findings that quietly evaporated.
- Tickets at `DONE` matching PRs that are actually merged, and worktrees reaped — a board you can trust at a glance, which is the entire point of having one.
- Review findings on the ticket timeline, which over a few weeks tells you which vendor writes what kind of bug in your codebase.

## Failure modes

**"The reviewer approved everything."** Check the vendor. If the reviewer is the same family as the author, you don't have a review. If it's a different vendor and still rubber-stamping, the framing is missing — the reviewer must be told to assume the author is wrong and to verify each finding by constructing the failure.

**"The reviewer found 30 style nits and no bugs."** The acceptance list didn't say a clean review is valid, or didn't rank by severity. Both are ticket defects.

**"We merged and the ticket still says IN_PROGRESS."** Closeout skipped. `merge_and_close` per merge, right after the merge, while you still remember which ticket it was.

**"`merge_and_close` refuses to close a ticket."** It's telling you one of two true things: the PR isn't merged, or the ticket itself says work remains. Read the reason before overriding — the override is the wrong move in most cases.

**"CI passed on the branch but broke on main."** The branch wasn't rebased before merge, so it was tested against a base that no longer existed. Rebase-then-test is not a formality in a parallel run; it's the only thing that makes several merges in a day safe.

**"An agent merged something I didn't approve."** Marblo's merge step is yours. If this happened, an agent ran `gh` directly with your credentials — worth checking, because it means the boundary you thought existed is convention rather than enforcement.

---

Back to the **[recipe index](README.md)** · The operational reasoning behind these rules: [Fleet Operations](../../knowledge/fleet-operations/KNOWLEDGE.md)
