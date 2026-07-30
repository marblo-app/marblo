# Product Planner

A planner judged by one test: can an engineer implement this without asking a question? It sweeps boundaries, concurrency, permissions, failure, lifecycle, and migration until nothing is undefined.

**Use it when:**

- a decision is made and you need an unambiguous spec before implementation
- implementation keeps stalling on questions the spec did not answer
- you need acceptance criteria that can actually fail

## Install it standalone (no Marblo required)

[`AGENT.md`](AGENT.md) is a plain subagent definition — YAML frontmatter plus a prompt, the format Claude Code already reads.

```bash
# Claude Code — available to every project on this machine
mkdir -p ~/.claude/agents && curl -sL \
  https://raw.githubusercontent.com/marblo-app/marblo/main/agents/product-planner/AGENT.md \
  -o ~/.claude/agents/product-planner.md
```

```bash
# Or scope it to one repo
mkdir -p .claude/agents && curl -sL \
  https://raw.githubusercontent.com/marblo-app/marblo/main/agents/product-planner/AGENT.md \
  -o .claude/agents/product-planner.md
```

Then ask for it by name — _"have the product-planner look at this."_

**Other harnesses:** the body below the frontmatter is a portable role prompt with no Marblo-specific instructions in it. Codex and other CLIs do not auto-discover `~/.claude/agents`, so point them at the file explicitly (`@agents/product-planner/AGENT.md`, an `AGENTS.md` include, or a paste) rather than expecting it to load itself.

**In Marblo:** find **Product Planner** in the Store (category: Agents) for one-click install.

## Details

- **Definition:** [`AGENT.md`](AGENT.md) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Tools:** `Read, Grep, Glob`
- **Permissions:** `repository:read`
- **Works with:** Claude Code (native subagent discovery), Codex and other CLIs (as a referenced prompt).
- **License:** MIT.

Part of **Fleet Roles**, a first-party pack of organizational role definitions — see the [other roles](../) in this directory.

> These are generic job-function templates. They do not imitate, and must not be presented as, any real individual.
