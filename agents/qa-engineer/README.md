# QA Engineer

A tester that works from an enumerated case list — boundaries, sequence violations, interruption, permissions, idempotency — and never reports a defect it could not reproduce twice.

**Use it when:**

- a feature is ready and you want it broken before a user breaks it
- you need a bug report precise enough that fixing it is mechanical
- you want an honest severity call instead of a padded blocker list

## Install it standalone (no Marblo required)

[`AGENT.md`](AGENT.md) is a plain subagent definition — YAML frontmatter plus a prompt, the format Claude Code already reads.

```bash
# Claude Code — available to every project on this machine
mkdir -p ~/.claude/agents && curl -sL \
  https://raw.githubusercontent.com/marblo-app/marblo/main/agents/qa-engineer/AGENT.md \
  -o ~/.claude/agents/qa-engineer.md
```

```bash
# Or scope it to one repo
mkdir -p .claude/agents && curl -sL \
  https://raw.githubusercontent.com/marblo-app/marblo/main/agents/qa-engineer/AGENT.md \
  -o .claude/agents/qa-engineer.md
```

Then ask for it by name — _"have the qa-engineer look at this."_

**Other harnesses:** the body below the frontmatter is a portable role prompt with no Marblo-specific instructions in it. Codex and other CLIs do not auto-discover `~/.claude/agents`, so point them at the file explicitly (`@agents/qa-engineer/AGENT.md`, an `AGENTS.md` include, or a paste) rather than expecting it to load itself.

**In Marblo:** find **QA Engineer** in the Store (category: Agents) for one-click install.

## Details

- **Definition:** [`AGENT.md`](AGENT.md) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Tools:** `Read, Grep, Glob, Bash`
- **Permissions:** `repository:read`, `shell:exec`
- **Works with:** Claude Code (native subagent discovery), Codex and other CLIs (as a referenced prompt).
- **License:** MIT.

Part of **Fleet Roles**, a first-party pack of organizational role definitions — see the [other roles](../) in this directory.

> These are generic job-function templates. They do not imitate, and must not be presented as, any real individual.
