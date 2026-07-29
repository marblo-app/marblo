# Reviewer Agent

An official Marblo agent role focused on one job: **review before merge.** It claims review-role tickets, runs the [`code-review`](../../skills/code-review/) skill on the diff, and reports blocking findings so nothing lands unverified.

- **Install:** find **Reviewer** in the Marblo Store (category: Agents).
- **Role:** `reviewer` · **Permissions:** `repository:read` (read-only).
- **Pairs with:** the [`review-and-merge`](../../workflows/review-and-merge/) workflow.
