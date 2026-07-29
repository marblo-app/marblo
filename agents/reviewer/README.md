# Reviewer Agent

A read-only subagent with one job: **review before merge.** It reviews the diff against its merge base, verifies each candidate finding by constructing the input that triggers it, and returns **BLOCK** or **APPROVE**.

## Install it standalone (no Marblo required)

[`AGENT.md`](AGENT.md) is a plain subagent definition — YAML frontmatter plus a prompt, the format Claude Code already reads.

```bash
# Claude Code — available to every project on this machine
mkdir -p ~/.claude/agents && curl -sL \
  https://raw.githubusercontent.com/marblo-app/marblo/main/agents/reviewer/AGENT.md \
  -o ~/.claude/agents/reviewer.md
```

```bash
# Or scope it to one repo
mkdir -p .claude/agents && curl -sL \
  https://raw.githubusercontent.com/marblo-app/marblo/main/agents/reviewer/AGENT.md \
  -o .claude/agents/reviewer.md
```

Then ask for it by name — _"have the reviewer agent look at this branch."_

**In Marblo:** find **Reviewer** in the Store (category: Agents). Inside the app it also claims review-role tickets from the board and reports blocking findings before the merge gate.

## Details

- **Definition:** [`AGENT.md`](AGENT.md) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Permissions:** `repository:read` — read-only. If a fix is obvious it describes it in one line; it never applies it.
- **Works with:** Claude Code, Codex.
- **License:** MIT.

Uses the same review dimensions as the [`code-review`](../../skills/code-review/) skill; pairs with the [`review-and-merge`](../../workflows/review-and-merge/) workflow.
