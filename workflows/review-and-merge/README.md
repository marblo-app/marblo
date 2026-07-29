# Review & Merge (workflow)

Takes a completed ticket to a **safe merge**:

1. A completed ticket enters review.
2. The [`reviewer`](../../agents/reviewer/) agent runs the [`code-review`](../../skills/code-review/) pass on the diff.
3. Blocking findings must be resolved, or explicitly waived.
4. On your confirmation, the change merges and the ticket closes.

This is the reference "code merged ≠ work done" gate — nothing lands on `main` without a review pass and your sign-off.

## This one is not standalone

Being straight about it: a workflow describes **orchestration** — ticket states, agent assignment, a merge gate — and there is no portable, cross-CLI format for that the way there is for skills and agents. **This item needs Marblo.**

What you _can_ take from it without the app: the two pieces it composes are both portable on their own — the [`code-review` skill](../../skills/code-review/#install-it-standalone-no-marblo-required) and the [`reviewer` agent](../../agents/reviewer/#install-it-standalone-no-marblo-required). Wiring them into your own CI or merge script is a reasonable afternoon. The steps above are the design, written down so you can rebuild it elsewhere if you want to.

For the operational discipline this workflow automates — why merging is four actions and not one, and what goes stale when you skip the other three — see [Fleet Operations §6](../../knowledge/fleet-operations/KNOWLEDGE.md).

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Install:** find **Review & Merge** in the Marblo Store (category: Workflows).
- **Permissions:** `repository:read`, `repository:write`.
- **License:** MIT.
