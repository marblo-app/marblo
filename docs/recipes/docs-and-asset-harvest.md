# Playbook — Docs & asset harvest

**Turn a pile of scattered knowledge into a published, indexed asset set — docs, knowledge packs, registry entries, translations — with several agents writing at once.**

The worked example is **this repository.** The registry, the manifests, the knowledge packs, and the docs you are reading were produced by this flow. So the traps below are not hypothetical; they are the ones that actually cost us time, and two of them are still enforced by CI in this repo because we don't trust ourselves not to repeat them.

Non-code work looks like the easy case for a fleet — no compiler, no tests, no merge conflicts to speak of. It has its own version of every one of those problems, and the failure mode is worse: **wrong docs don't fail, they ship.**

|                  |                                                                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fits**         | Doc sets, runbook collections, knowledge packs, registry/catalog entries, translation and i18n sweeps, changelog and release-note backfills. |
| **Doesn't fit**  | A single document. One document is one agent and a conversation.                                                                             |
| **Shape**        | policy gate → survey → 1 ticket per asset (parallel) → generated index last → link-and-claim check.                                          |
| **Cost profile** | Cheap. Most tickets are `simple`. The expensive part is the survey, and it earns it.                                                         |

---

## 1. The policy gate — decide the rules before you collect anything

**This step is first, it is manual, and skipping it is the single most expensive mistake in this playbook.** Every policy question you leave open becomes a per-ticket judgement call made independently by N agents, and the reconciliation happens after the writing is done.

The gate is four decisions:

**1. Inclusion policy.** What qualifies? Write it as a filter someone else could apply. For this repo's registry the license filter is **OSI-approved licenses only**. That sounds obvious until it isn't: several widely-used, widely-recommended tools ship under _source-available_ licenses (FSL, BSL, SSPL) that are neither OSI-approved nor "non-commercial" — they read permissive and fail the filter. We collected before deciding, and dropped otherwise-excellent entries afterward. AGPL, which _sounds_ like the restrictive one, is OSI-approved and passes.

> Decide the filter first, then collect. Collection is cheap; discovering your filter after collection means throwing away good work.

**2. First-party vs referenced.** For anything you didn't write: do you copy it in, or point at it? This repo's rule is **never vendor third-party content** — reference it by `source.repository` plus a **pinned** `ref` (a release tag or a 40-character commit SHA, never a moving branch; the schema rejects `main`/`master`/`develop`/`HEAD` by pattern). Copying drags the upstream's license, ownership, and maintenance onto you. Pinning leaves all three where they belong.

**3. Trust tiering.** If your asset set is consumed by anyone else, decide up front what "we reviewed this" means and which tier gets that claim. Here, external items merge as `community` — **listed, not installable** — and promotion requires a maintainer reading the payload itself, not just the manifest. An automated validator is a gate, not a trust decision.

**4. The house voice, as a rule you can check.** "Be honest" is not checkable. This is:

> Every claim about what the software does must be true of the shipped build. If a feature is partial, say which part. Never write around a gap.

Put all four in the ticket body of _every_ writing ticket. Not in a style guide you link to — in the body. Agents follow what's in front of them.

## 2. Survey once, with one agent, read-only

The survey produces the ticket list. Give it to one capable agent, not five, and require the output to be a table you can act on — because you're about to turn each row into a ticket.

```
You → Read-only survey ticket, complexity complex, no file changes:

      Goal: inventory candidate assets for <the set>.

      For each candidate, one row: name, source URL, license (SPDX id, and
      whether OSI-approved), last commit date, popularity signal, and a
      one-line "why it belongs here."

      Mark each: FIRST-PARTY (we write it), REFERENCE (pin upstream), or
      EXCLUDE (with the reason — license, staleness, or overlap).

      Report the table as ticket activity. Do not create any files.

      Notes: verify the license from the repository itself, not from a
      directory listing or an aggregator. If a license is source-available
      but not OSI-approved, mark EXCLUDE and name the license.
```

That last note exists because aggregator metadata is wrong often enough to matter, and license mistakes are the kind you find out about from someone else.

Read the table and cut it. This is your one chance to trade breadth for quality cheaply: a set of 20 assets that each earn their place beats 90 where 60 are filler, and after the writing tickets run, cutting costs you real work.

## 3. One ticket per asset, with the seam ticket first

Same seam-first shape as [Large refactor](large-refactor.md) — the seam here is the **schema and the validator**, not an interface.

**Seam ticket (alone, merges first):** the manifest schema or front-matter contract, plus whatever validates it. In this repo that's `registry/manifest.schema.json` and the validator that CI runs on every PR. Get this merged before any asset ticket starts, or you will hand-fix 20 files that were each written against a different mental model of the format.

**Then one ticket per asset, in parallel:**

```
You → One ticket per FIRST-PARTY row, all depending on the schema ticket:

        goal:       Write <asset> — <its one job, from the survey table>.
        changes:    - <category>/<id>/marblo.yaml validating against the schema
                    - <category>/<id>/README.md
                    - the payload file(s) in the format the target CLI reads
        acceptance: - manifest validates against registry/manifest.schema.json
                    - README states what it does and how to use it WITHOUT
                      our app, or says plainly that it can't be
                    - every factual claim traceable to something in the repo
                      or a linked source
                    - declared permissions match what the payload actually
                      needs — not more
        notes:      - <the four policy rules, verbatim>
                    - Do not edit the root README. It is generated.
                    - Do not touch any other asset's directory.
        scope:      ["<category>/<id>/"]
        role:       frontend        # docs/content work
        complexity: simple          # standard for the two or three hard ones
```

Four constraints, four scars:

- **"Do not edit the generated file."** Covered in step 4. It is the most common way this playbook produces a red PR.
- **`scope` per asset directory.** Cheap, and it keeps 20 parallel writers out of each other's files.
- **"Permissions match what it needs — not more."** Over-declaring isn't cautious; it trains readers to ignore the disclosure entirely.
- **"Traceable to something in the repo or a linked source."** The only real defense against confident, fluent, invented detail. Prose has no type checker; this is the substitute.

**Reference-only rows are a different, much cheaper ticket:** manifest with a pinned ref plus a short README, no payload. Batch several per ticket — they're a few lines each.

## 4. Generated indexes: one writer, and a CI gate

Any file assembled from all the others — a catalog table, a docs index, a summary count — must have **exactly one writer: the generator.** In this repo `npm run gen:catalog` regenerates the catalog block in the root README from every manifest, and `npm run check:catalog` fails CI if what you committed differs from what the generator produces.

This is worth the setup cost, because with N parallel agents the alternative is guaranteed: several of them will helpfully hand-add their own row, in slightly different formats, and one will reformat the table while it's there.

Two hard-won details about generated blocks in Markdown:

- **A `prettier-ignore` fence must _wrap_ the region markers, not sit inside them.** Get the nesting wrong — the closing `<!-- prettier-ignore-end -->` placed before the closing region marker instead of after — and the formatter reformats the part of the block that's outside the ignore range. The generator then rewrites it, the formatter reformats it again, and CI fails forever for _formatting_ reasons that have nothing to do with your content. In this repo the fence wraps the markers, in that order, deliberately.
- **No timestamps in generated output.** A "last generated at" line makes every regeneration a diff, so the drift gate fires on runs where nothing actually changed.

The index ticket runs **last**, after the asset tickets merge, and its whole job is `npm install && npm run gen:catalog` plus committing the result. Give it to a cheap model; it's a mechanical step with an exact success condition.

> **Test the drift gate against a commit, not against your working tree.** If you "fix" a drift by editing the file and then run the generator, the generator overwrites your edit and everything looks green — while the committed state is still broken. Verify the way CI does: from what's committed.

## 5. Merge order

Docs merges are low-risk, which makes it tempting to merge them in whatever order they finish. Two rules keep that from biting:

1. **Schema/validator first, generated index last.** Everything else is genuinely independent and can merge as it's ready.
2. **Re-generate after the last asset merges.** An index generated when 18 of 20 assets had landed is a wrong index, and it's wrong in the quietest possible way — it looks complete.

Then close out per ticket with `merge_and_close` (verifies the merge, flips to `DONE`, reaps the worktree). Doc tickets are the ones people most often leave sitting in `REVIEW`, which later reads as unfinished work.

## 6. The claim check — the step that makes this playbook honest

One final read-only ticket, on a **different vendor** than the writers, with one job: find the sentences that aren't true.

```
You → Final verification ticket, read-only, different vendor from the writers:

      Goal: find every claim in the new docs that is false, unverifiable, or
      overstates what ships.

      Acceptance:
        - every internal link resolves (file exists, anchor exists)
        - every external link resolves and points at the pinned ref
        - every "you can X" claim checked against the actual code or asset in
          this repo; list each with a verdict and evidence
        - every claim about a partial feature states which part is partial
        - list any place where two docs contradict each other

      Notes: your job is to find overstatement, not to confirm the docs read
      well. Docs that promise more than the software does are the specific
      defect you are looking for.
```

Broken links are the cheap half. The valuable half is the overstatement pass — a fluent writing agent will describe the feature it _expects_ to exist. In this repo the honest phrasings you'll see (registry install is Phase 1a; `community` items are listings, not installs; a workflow item that says outright it needs the app) all exist because this check produced them.

## Applying it to translation / i18n sweeps

Same shape, different seam:

- **The seam is a glossary ticket** — the 30 terms that must be translated identically everywhere, decided once, merged before any locale ticket starts. Without it, five locale agents produce five translations of your product's core nouns.
- **One ticket per locale namespace**, not per locale. A whole locale is too big to review; a namespace is one sitting.
- **The check is mechanical, so make it a compile error.** Type the locale tables so a key present in the base locale and missing in a translation fails the build. Then key parity is CI's problem, and human review is only about the wording. (This repo's app does exactly that: each English namespace is typed against its Korean counterpart, so a missing key is a compile error in that namespace alone.)
- **Partial is a valid state — design for it.** This repo's manifest `i18n` overlay falls back to the English base **field by field**, so a half-translated entry displays correctly rather than breaking. Build that fallback before the translation tickets run, not after.

## What you end up with

- An asset set where every entry passes the same declared filter, in a format a validator can check.
- A generated index with exactly one writer and a CI gate that catches drift.
- A verification report naming the claims that were cut for overstating — which is the artifact that makes the rest of the docs credible.
- Excluded candidates recorded with reasons, so the next harvest doesn't re-litigate them.
- A per-asset git history: who wrote what, on which model, against which ticket.

## Failure modes

**"CI fails on the generated file and I can't see why."** Two candidates, in order: an agent hand-edited the generated region (regenerate and commit), or the ignore fence doesn't wrap the markers (fix the nesting once and it stops forever). Diagnose from the committed state, not the working tree.

**"Two docs contradict each other."** Nobody owned the seam. A shared claim — what a tier means, what's shipped — needs one canonical location, and every other doc links to it instead of restating it.

**"The docs read beautifully and describe a product we don't have."** The writing tickets didn't carry the traceability rule, or the claim-check pass was skipped. This is the characteristic failure of agent-written docs and the only reliable defense is an adversarial reader on a different vendor.

**"We had to drop a third of what we collected."** The policy gate came after collection. That's step 1 for exactly this reason.

**"Reference pins broke."** Someone pinned a moving branch. Release tag or full SHA; this repo's schema rejects the moving names by pattern precisely because the mistake is so easy.

---

Next: **[Review & safe merge](review-and-safe-merge.md)** — the gate every one of these playbooks ends with.
