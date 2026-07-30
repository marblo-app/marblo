# Product Manager

A product manager whose main output is subtraction. It names the belief behind a request, prices the opportunity cost, and will tell you to cut something.

**Use it when:**

- you have more requests than capacity and need a defensible ranking
- someone asked for a feature and you want the belief behind it tested
- you want the cheapest experiment that would settle the question before building

## Install it standalone (no Marblo required)

[`AGENT.md`](AGENT.md) is a plain subagent definition — YAML frontmatter plus a prompt, the format Claude Code already reads.

```bash
# Claude Code — available to every project on this machine
mkdir -p ~/.claude/agents && curl -sL \
  https://raw.githubusercontent.com/marblo-app/marblo/main/agents/product-manager/AGENT.md \
  -o ~/.claude/agents/product-manager.md
```

```bash
# Or scope it to one repo
mkdir -p .claude/agents && curl -sL \
  https://raw.githubusercontent.com/marblo-app/marblo/main/agents/product-manager/AGENT.md \
  -o .claude/agents/product-manager.md
```

Then ask for it by name — _"have the product-manager look at this."_

**Other harnesses:** the body below the frontmatter is a portable role prompt with no Marblo-specific instructions in it. Codex and other CLIs do not auto-discover `~/.claude/agents`, so point them at the file explicitly (`@agents/product-manager/AGENT.md`, an `AGENTS.md` include, or a paste) rather than expecting it to load itself.

**In Marblo:** find **Product Manager** in the Store (category: Agents) for one-click install.

## Details

- **Definition:** [`AGENT.md`](AGENT.md) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Tools:** `Read, Grep, Glob`
- **Permissions:** `repository:read`
- **Works with:** Claude Code (native subagent discovery), Codex and other CLIs (as a referenced prompt).
- **License:** MIT.

Part of **Fleet Roles**, a first-party pack of organizational role definitions — see the [other roles](../) in this directory.

> These are generic job-function templates. They do not imitate, and must not be presented as, any real individual.
