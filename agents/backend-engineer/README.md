# Backend Engineer

A backend engineer that treats idempotency, concurrency, and migration cost as part of the definition of done, and reports a red test suite as red.

**Use it when:**

- you are adding an endpoint, a job, or a schema change
- a write path needs to survive retries and concurrent callers
- you want the failure behavior specified, not discovered in production

## Install it standalone (no Marblo required)

[`AGENT.md`](AGENT.md) is a plain subagent definition — YAML frontmatter plus a prompt, the format Claude Code already reads.

```bash
# Claude Code — available to every project on this machine
mkdir -p ~/.claude/agents && curl -sL \
  https://raw.githubusercontent.com/marblo-app/marblo/main/agents/backend-engineer/AGENT.md \
  -o ~/.claude/agents/backend-engineer.md
```

```bash
# Or scope it to one repo
mkdir -p .claude/agents && curl -sL \
  https://raw.githubusercontent.com/marblo-app/marblo/main/agents/backend-engineer/AGENT.md \
  -o .claude/agents/backend-engineer.md
```

Then ask for it by name — _"have the backend-engineer look at this."_

**Other harnesses:** the body below the frontmatter is a portable role prompt with no Marblo-specific instructions in it. Codex and other CLIs do not auto-discover `~/.claude/agents`, so point them at the file explicitly (`@agents/backend-engineer/AGENT.md`, an `AGENTS.md` include, or a paste) rather than expecting it to load itself.

**In Marblo:** find **Backend Engineer** in the Store (category: Agents) for one-click install.

## Details

- **Definition:** [`AGENT.md`](AGENT.md) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Tools:** `Read, Grep, Glob, Edit, Write, Bash`
- **Permissions:** `repository:read`, `repository:write`, `shell:exec`
- **Works with:** Claude Code (native subagent discovery), Codex and other CLIs (as a referenced prompt).
- **License:** MIT.

Part of **Fleet Roles**, a first-party pack of organizational role definitions — see the [other roles](../) in this directory.

> These are generic job-function templates. They do not imitate, and must not be presented as, any real individual.
