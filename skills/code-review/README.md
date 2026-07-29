# Code Review (skill)

Review agent-generated code for correctness, security, and simplicity before it merges, and report findings ranked by severity — each with a concrete failure scenario, not a vague worry.

## Install it standalone (no Marblo required)

`SKILL.md` is a plain skill file. Drop it in and it works in your next session.

```bash
# Claude Code
mkdir -p ~/.claude/skills/code-review && curl -sL \
  https://raw.githubusercontent.com/marblo-app/marblo/main/skills/code-review/SKILL.md \
  -o ~/.claude/skills/code-review/SKILL.md
```

```bash
# Codex — same file, different directory
mkdir -p ~/.codex/skills/code-review && curl -sL \
  https://raw.githubusercontent.com/marblo-app/marblo/main/skills/code-review/SKILL.md \
  -o ~/.codex/skills/code-review/SKILL.md
```

```bash
# Already cloned the repo? Just copy it.
mkdir -p ~/.claude/skills/code-review && cp skills/code-review/SKILL.md ~/.claude/skills/code-review/
```

To scope it to one project instead of your whole machine, put it under `./.claude/skills/code-review/` inside that repo.

**In Marblo:** find **Code Review** in the Store (category: Skills) — one click, with version tracking. Same file.

## Details

- **Skill:** [`SKILL.md`](SKILL.md) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Permissions:** `repository:read` — read-only. It reviews; it does not edit.
- **Works with:** Claude Code, Codex.
- **License:** MIT.

Pairs well with the [`reviewer`](../../agents/reviewer/) agent, which runs this skill as its review pass, and the [`review-and-merge`](../../workflows/review-and-merge/) workflow.
