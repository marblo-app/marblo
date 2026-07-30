# Playbook — Large refactor

**Change one interface that hundreds of call sites depend on, without a single 400-file pull request nobody can review.**

The instinct is to hand the whole thing to your best model in one ticket. That produces exactly one artifact: a diff too large to review, which you then merge on faith. This playbook trades that for a seam and a queue — one hard ticket that changes the interface, many cheap tickets that follow it, and one ticket whose only job is to prove nothing was missed.

|                  |                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Fits**         | API renames, replacing a library, extracting a module, threading a new parameter through a call graph, deleting a deprecated path.    |
| **Doesn't fit**  | Refactors where the _design_ is still open. Decide the target shape first — this playbook mechanizes a decision, it doesn't make one. |
| **Shape**        | inventory → 1 seam ticket (compatible, merges alone) → N batch tickets in parallel → 1 verification ticket → seam cleanup.            |
| **Cost profile** | Most of the tickets should be on your cheapest tier. If they aren't, your batching is wrong.                                          |

---

## 1. Inventory first — the count _is_ the plan

Do not start by asking for a refactor. Start by asking what would have to change. One agent, read-only, no edits:

```
You → Read-only task, no code changes. Inventory every call site of
      `LegacyClient` in this repo. Output a table: file path, call count,
      which of the 4 methods it uses, and whether the file has tests.
      Group the rows by top-level module. Report the table in the ticket.
```

Send this through the Board as a real ticket rather than as chat, for one reason: the table becomes the input to the next step, and you want it attached to something you can re-read next week. A `simple`-complexity agent is fine — this is grep with judgement, not reasoning.

Read the table and decide three things before any code moves:

1. **Is the seam actually one interface?** If the inventory shows callers using it in two incompatible ways, you have two refactors. Split them, or you will discover this halfway through, in a batch ticket, from an agent that decides to "handle both cases."
2. **Which module boundaries make natural batches?** See step 3 — this is the decision the whole run hinges on.
3. **What is untested?** Files with no tests are where a mechanical change silently breaks behavior. Those batches need a different complexity setting, and possibly a test ticket ahead of them.

## 2. The seam ticket: additive, compatible, merges alone

The seam ticket introduces the new interface **without removing the old one**. Both work when it merges. That single property is what allows the batches to run in parallel and merge one at a time over hours instead of all-or-nothing.

```
You → Create the seam ticket, complexity complex, on your strongest reasoning
      model, priority 5:

      Goal: introduce ModernClient alongside LegacyClient. Both work after
      this ticket. No call sites migrated.

      Changes: new ModernClient with the 4 methods; LegacyClient becomes a
      thin deprecated wrapper delegating to it; export both.

      Acceptance: full type check passes; existing test suite passes
      unchanged; a new unit test covers ModernClient's 4 methods directly;
      grep shows zero call-site changes outside the client module.

      Notes: do not migrate callers. Do not delete anything. If a method
      cannot be expressed in the new shape, stop and ask me instead of
      inventing a compatibility escape hatch.
```

That last note matters more than it looks. The single most common way a seam ticket goes wrong is an agent that hits one awkward caller and quietly adds an `options.legacyMode` flag to make it fit — which propagates into every batch and becomes permanent. "Ask me instead" is cheap; a flag you inherit is not.

This is also the right ticket for a **cross-check spawn** if the interface is genuinely load-bearing: `complexity: "complex"` with `mix: "cross-check"` runs a top Claude model and a Codex high-effort model on it and cross-verifies. It doubles the cost of one ticket. On the ticket that every other ticket depends on, that is usually a good trade.

Merge the seam ticket before anything else starts. Same review pass as always ([Review & safe merge](review-and-safe-merge.md)); a good seam diff is small enough to read line by line, and you should.

## 3. Batch by compile boundary, never by count

The batching rule, and the reason this playbook works:

> **Every batch ticket must compile and pass tests on its own, merged alone, with no other batch present.**

That means batching by module boundary, not "50 call sites each." A batch that splits a module in half produces a branch that cannot pass CI until its sibling merges, and now your parallel run is a serial one with extra branches.

```
You → From the inventory table, create one ticket per top-level module,
      all depending on the seam ticket. Modules with fewer than 5 call sites
      get merged into a single "small callers" ticket.

      Each ticket, identically:
        goal:       Migrate <module> from LegacyClient to ModernClient.
        acceptance: - zero LegacyClient references remain under <module>
                    - type check passes
                    - <module>'s tests pass, with the command output in the
                      completion report
        notes:      - Mechanical migration only. No behavior changes, no
                      renames, no drive-by cleanups, no reformatting.
                    - If a call site does not map 1:1, leave it, and list it
                      in the ticket instead of improvising.
        scope:      ["<module path>"]
        role:       backend
        complexity: simple

      Modules the inventory marked as having no tests: complexity standard,
      and add "add a smoke test covering the migrated path" to acceptance.
```

Four details in there that each exist because of a specific failure:

- **"No drive-by cleanups."** Without it you get a mechanical migration plus 300 lines of unrelated tidying, and the review can no longer tell them apart. This is the difference between a batch you skim and a batch you audit.
- **`scope`** pins the paths the ticket owns. It is what keeps two batch agents out of each other's files.
- **"List it instead of improvising."** The call sites that don't map 1:1 are the actual content of this refactor. You want them collected in ticket notes, not solved four different ways by four agents.
- **Command output in the completion report.** "Tests pass" as an assertion is worth much less than the paste of the run.

**Untested modules get a higher tier, not more agents.** A cheap model doing a mechanical edit in a file with no test coverage is where silent breakage comes from.

## 4. Run the queue

Dispatch the batches. They are independent, so they run as wide as your concurrency cap allows and the rest queue behind.

```
You → Dispatch all batch tickets. Keep the untested-module tickets for last —
      I want to be watching when those run.
```

Then mostly leave it alone. Batch tickets are the least interesting agents to babysit; they either satisfy an acceptance list or they don't. What deserves attention:

- **Tickets that ask questions.** In a mechanical run, a question means a call site that doesn't fit — signal, not noise. Answer through the ticket's Q&A channel; the answer is injected into that agent's terminal.
- **Tickets that take much longer than their siblings.** Same instruction, same shape, 5× the time usually means that module wasn't as mechanical as the inventory suggested. Read that diff first.
- **The Stuck lane** for `BLOCKED`/`FAILED` and stale cards. The watchdog nudges and re-dispatches on its own; you intervene when a ticket has burned its respawn budget.

A useful mid-run check that costs nothing and doesn't wake a model:

```
You → get_projection for each batch ticket — just the status and last activity.
      Which ones haven't moved?
```

## 5. The verification ticket

When the batches are merged, one ticket exists to try to prove the refactor is _incomplete_. Give it to a different vendor than the one that did the batches, and frame it adversarially — a verifier told to "confirm the migration" confirms it.

```
You → Verification ticket, role test, complexity standard, different vendor
      from the batch agents:

      Goal: find anything the LegacyClient → ModernClient migration missed.

      Changes: none. This is a read + report ticket.

      Acceptance:
        - grep results for every remaining LegacyClient reference, with a
          verdict per hit: intentional wrapper, missed call site, or dead code
        - dynamic/indirect uses checked too: string-keyed dispatch, DI
          registrations, re-exports, mocks in tests, docs and comments
        - list every call site the batch tickets flagged as not mapping 1:1,
          and whether it is still unresolved
        - full test suite run, output pasted

      Notes: your job is to find what is missing, not to agree that it's done.
      If the migration is genuinely complete, say so with the evidence.
```

Mocks, re-exports, and DI registrations are the three that survive a "clean" migration, because none of them look like a call site.

## 6. Seam cleanup, last

Only after verification comes back clean:

```
You → Cleanup ticket, complexity standard, depends on the verification ticket:
      delete LegacyClient and its wrapper, remove the deprecation shim, update
      docs and comments that still name it. Acceptance: zero references
      outside CHANGELOG; full type check and test suite pass.
```

This is deliberately a separate, final ticket. Deleting the old path inside the last batch ticket is how you end up unable to merge a batch because something outside your inventory still imported it.

## Merge cadence

Batches are independent, so merge them **one at a time, smallest first**, rebasing each onto current base before you judge it. Between merges nothing needs to wait — the other branches are still valid because the seam kept both interfaces alive.

Two traps specific to long refactor queues:

- **A stale branch's three-dot diff lies.** `main...branch` on a branch that is behind base attributes other people's changes to it, and can show enormous deletions the branch never made. Rebase, or compare against the merge base, before reviewing.
- **Close out every merge fully.** `merge_and_close` verifies the merge, flips the ticket to `DONE`, and reaps the worktree. Skip it for twelve batches and you have twelve tickets sitting in `REVIEW` that read as unfinished work and get re-investigated. The four-part discipline is in [Fleet Operations §6.1](../../knowledge/fleet-operations/KNOWLEDGE.md).

## What you end up with

- A stack of small, single-purpose PRs — one interface change, N mechanical migrations, one deletion — that reviews in an afternoon instead of never.
- A verification report you can point at, from a model that had no stake in the migration being complete.
- The list of call sites that did not map cleanly, written down where you'll find it, because those are the real design debt the refactor surfaced.
- A cost that is mostly cheap-tier, with the premium spend concentrated on the seam and the verification.

## Failure modes

**"A batch branch won't pass CI alone."** Your batch straddled a compile boundary. Re-split along module lines; don't paper over it by merging two branches together, or you lose the property that makes the queue safe.

**"An agent refactored beyond its ticket."** The `notes` didn't forbid drive-by changes, or `scope` wasn't set. Ask for the extras to be reverted out into their own ticket rather than reviewing a mixed diff — mixed diffs are how mechanical changes hide behavior changes.

**"Verification says complete, but production broke."** Look for the three the grep misses: string-keyed/dynamic dispatch, DI or plugin registration, and test doubles. If your codebase has a plugin registry, name it explicitly in the verification ticket's acceptance list.

**"The seam ticket grew a compatibility flag."** Revert it and re-run the seam with the awkward caller named explicitly. A permanent flag is a much worse outcome than one hard conversation about one call site.

**"This cost as much as writing it by hand."** Check the concrete model on the batch cards. Batch tickets that ran `standard` because no complexity was set is the usual answer — the tier choice is the entire cost story in this playbook.

---

Next: **[Bug audit → parallel fix](bug-audit-parallel-fix.md)** — same fan-out, but with a verification gate between finding and fixing, because findings are claims.
