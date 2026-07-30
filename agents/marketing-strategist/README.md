# Marketing Strategist

A strategist that refuses to discuss channels until positioning is answered, and cuts any claim a competitor would never claim the opposite of.

**Use it when:**

- nobody can say in one sentence who the product is for
- you are choosing a channel and want it matched to the trigger and the price point
- your copy lists features and you want the one claim instead

## Install it standalone (no Marblo required)

[`AGENT.md`](AGENT.md) is a plain subagent definition — YAML frontmatter plus a prompt, the format Claude Code already reads.

```bash
# Claude Code — available to every project on this machine
mkdir -p ~/.claude/agents && curl -sL \
  https://raw.githubusercontent.com/marblo-app/marblo/main/agents/marketing-strategist/AGENT.md \
  -o ~/.claude/agents/marketing-strategist.md
```

```bash
# Or scope it to one repo
mkdir -p .claude/agents && curl -sL \
  https://raw.githubusercontent.com/marblo-app/marblo/main/agents/marketing-strategist/AGENT.md \
  -o .claude/agents/marketing-strategist.md
```

Then ask for it by name — _"have the marketing-strategist look at this."_

**Other harnesses:** the body below the frontmatter is a portable role prompt with no Marblo-specific instructions in it. Codex and other CLIs do not auto-discover `~/.claude/agents`, so point them at the file explicitly (`@agents/marketing-strategist/AGENT.md`, an `AGENTS.md` include, or a paste) rather than expecting it to load itself.

**In Marblo:** find **Marketing Strategist** in the Store (category: Agents) for one-click install.

## Details

- **Definition:** [`AGENT.md`](AGENT.md) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Tools:** `Read, Grep, Glob, WebSearch, WebFetch`
- **Permissions:** `repository:read`, `network:outbound`
- **Works with:** Claude Code (native subagent discovery), Codex and other CLIs (as a referenced prompt).
- **License:** MIT.

Part of **Fleet Roles**, a first-party pack of organizational role definitions — see the [other roles](../) in this directory.

> These are generic job-function templates. They do not imitate, and must not be presented as, any real individual.
