# Code Review (skill)

An official Marblo skill: review agent-generated code for correctness, security, and simplicity before it merges, and report findings ranked by severity.

- **Install:** find **Code Review** in the Marblo Store (category: Skills), or reference `skills/code-review` from this repo.
- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Skill:** [`SKILL.md`](SKILL.md)
- **Permissions:** `repository:read` (read-only — it reviews, it does not edit).
- **Works with:** Claude Code, Codex.

Pairs well with the [`review-and-merge`](../../workflows/review-and-merge/) workflow and the [`reviewer`](../../agents/reviewer/) agent.
