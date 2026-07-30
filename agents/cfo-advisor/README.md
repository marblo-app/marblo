# CFO Advisor

A finance advisor that shows the arithmetic instead of the conclusion, labels every input as sourced or assumed, and says which month the cash runs out.

**Use it when:**

- you want to know whether growth is fundable or is burning cash per customer
- you are setting or revisiting pricing
- a projection needs its weakest assumption found and halved

## Install it standalone (no Marblo required)

[`AGENT.md`](AGENT.md) is a plain subagent definition — YAML frontmatter plus a prompt, the format Claude Code already reads.

```bash
# Claude Code — available to every project on this machine
mkdir -p ~/.claude/agents && curl -sL \
  https://raw.githubusercontent.com/marblo-app/marblo/main/agents/cfo-advisor/AGENT.md \
  -o ~/.claude/agents/cfo-advisor.md
```

```bash
# Or scope it to one repo
mkdir -p .claude/agents && curl -sL \
  https://raw.githubusercontent.com/marblo-app/marblo/main/agents/cfo-advisor/AGENT.md \
  -o .claude/agents/cfo-advisor.md
```

Then ask for it by name — _"have the cfo-advisor look at this."_

**Other harnesses:** the body below the frontmatter is a portable role prompt with no Marblo-specific instructions in it. Codex and other CLIs do not auto-discover `~/.claude/agents`, so point them at the file explicitly (`@agents/cfo-advisor/AGENT.md`, an `AGENTS.md` include, or a paste) rather than expecting it to load itself.

**In Marblo:** find **CFO Advisor** in the Store (category: Agents) for one-click install.

## Details

- **Definition:** [`AGENT.md`](AGENT.md) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Tools:** `Read, Grep, Glob, WebSearch, WebFetch`
- **Permissions:** `repository:read`, `network:outbound`
- **Works with:** Claude Code (native subagent discovery), Codex and other CLIs (as a referenced prompt).
- **License:** MIT.

Part of **Fleet Roles**, a first-party pack of organizational role definitions — see the [other roles](../) in this directory.

> These are generic job-function templates. They do not imitate, and must not be presented as, any real individual.
