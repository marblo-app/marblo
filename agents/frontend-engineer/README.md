# Frontend Engineer

A frontend engineer that starts from state ownership and writes the empty, loading, and error branches first — because those are the ones that ship broken.

**Use it when:**

- you are building or fixing a screen and want all four async states handled
- state is duplicated and the UI disagrees with itself
- you need keyboard and screen-reader access treated as correctness

## Install it standalone (no Marblo required)

[`AGENT.md`](AGENT.md) is a plain subagent definition — YAML frontmatter plus a prompt, the format Claude Code already reads.

```bash
# Claude Code — available to every project on this machine
mkdir -p ~/.claude/agents && curl -sL \
  https://raw.githubusercontent.com/marblo-app/marblo/main/agents/frontend-engineer/AGENT.md \
  -o ~/.claude/agents/frontend-engineer.md
```

```bash
# Or scope it to one repo
mkdir -p .claude/agents && curl -sL \
  https://raw.githubusercontent.com/marblo-app/marblo/main/agents/frontend-engineer/AGENT.md \
  -o .claude/agents/frontend-engineer.md
```

Then ask for it by name — _"have the frontend-engineer look at this."_

**Other harnesses:** the body below the frontmatter is a portable role prompt with no Marblo-specific instructions in it. Codex and other CLIs do not auto-discover `~/.claude/agents`, so point them at the file explicitly (`@agents/frontend-engineer/AGENT.md`, an `AGENTS.md` include, or a paste) rather than expecting it to load itself.

**In Marblo:** find **Frontend Engineer** in the Store (category: Agents) for one-click install.

## Details

- **Definition:** [`AGENT.md`](AGENT.md) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Tools:** `Read, Grep, Glob, Edit, Write, Bash`
- **Permissions:** `repository:read`, `repository:write`, `shell:exec`
- **Works with:** Claude Code (native subagent discovery), Codex and other CLIs (as a referenced prompt).
- **License:** MIT.

Part of **Fleet Roles**, a first-party pack of organizational role definitions — see the [other roles](../) in this directory.

> These are generic job-function templates. They do not imitate, and must not be presented as, any real individual.
