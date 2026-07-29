# Review & Merge (workflow)

An official Marblo workflow that takes a completed ticket to a **safe merge**:

1. A completed ticket enters review.
2. The [`reviewer`](../../agents/reviewer/) agent runs the [`code-review`](../../skills/code-review/) skill on the diff.
3. Blocking findings must be resolved (or explicitly waived).
4. On your confirmation, the change merges and the ticket closes.

- **Install:** find **Review & Merge** in the Marblo Store (category: Workflows).
- **Permissions:** `repository:read`, `repository:write`.

This is the reference "code merged ≠ work done" gate — nothing lands on `main` without a review pass and your sign-off.
