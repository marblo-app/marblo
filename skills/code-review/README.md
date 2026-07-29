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

The manifest carries the [`install` contract](../../registry/README.md#the-install-contract) that makes that click possible, and it is worth reading once because it is the shape every future skill copies:

```yaml
install:
  kind: files
  root: claude-skills # enum key — the app owns the path, the manifest never sees one
  dest: code-review
  files: [SKILL.md, README.md] # allowlist; nothing outside it is written
  integrity: # sha256 of the committed bytes, checked before anything lands
    algorithm: sha256
    files: { SKILL.md: c8b984fb…, README.md: 2b6ae4b1… }
```

So the one-click path is strictly _narrower_ than the `curl` above: it writes two named files into one directory it computed itself, and it refuses to write any of them if the bytes do not hash to what was reviewed here. Uninstall is driven by a ledger the app wrote at install time, not by this manifest — editing this file later cannot redirect a delete.

## Details

- **Skill:** [`SKILL.md`](SKILL.md) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Permissions:** `repository:read` — read-only. It reviews; it does not edit.
- **Works with:** Claude Code, Codex.
- **License:** MIT.

Pairs well with the [`reviewer`](../../agents/reviewer/) agent, which runs this skill as its review pass, and the [`review-and-merge`](../../workflows/review-and-merge/) workflow.
