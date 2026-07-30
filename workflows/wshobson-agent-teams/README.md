# Agent Teams (workflow · community)

**Why it's here:** this registry is for people who run fleets, and this is the only upstream plugin that treats a *team* as the unit of work rather than an agent. `/team-review` fans one diff out to reviewers with separate dimensions — security, performance, architecture — then deduplicates the findings into one report.

> **Referenced, not vendored.** Files live in [`wshobson/agents`](https://github.com/wshobson/agents), pinned to commit `c4b82b0`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

The plugin is seven commands (`team-spawn`, `team-delegate`, `team-feature`, `team-review`, `team-debug`, `team-status`, `team-shutdown`), four agents (`team-lead`, `team-implementer`, `team-reviewer`, `team-debugger`), and six skills covering composition, coordination, messaging, and merge strategy. Install the parts together — the commands dispatch the agents by their namespaced frontmatter names.

```bash
SHA=c4b82b0ad771190355eb8e204b1329732a18449a
TMP=$(mktemp -d)
curl -sL "https://codeload.github.com/wshobson/agents/tar.gz/$SHA" \
  | tar -xz -C "$TMP" "agents-$SHA/plugins/agent-teams"
SRC="$TMP/agents-$SHA/plugins/agent-teams"

mkdir -p ~/.claude/commands ~/.claude/agents
cp "$SRC"/commands/*.md ~/.claude/commands/
cp "$SRC"/agents/*.md   ~/.claude/agents/
mkdir -p ~/.claude/skills
cp -R "$SRC"/skills/*     ~/.claude/skills/
```

## Details

- **Upstream:** [`plugins/agent-teams`](https://github.com/wshobson/agents/tree/main/plugins/agent-teams) · **Manifest:** [`marblo.yaml`](marblo.yaml) · plugin version `1.0.3` at the pin
- **Pinned to:** `c4b82b0ad771190355eb8e204b1329732a18449a` (no release tags upstream)
- **Permissions:** `repository:read`, `filesystem:write`, `shell:exec`, `network:outbound` — it reads diffs (`git diff`, `gh pr diff` — hence the network entry), writes team artefacts and consolidated reports, and shells out throughout.
- **Read this before installing: it needs an experimental flag.** Every command pre-flight-checks `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` and stops if it is unset. Upstream also asks for `"teammateMode": "tmux"` (or `iterm2`) in `~/.claude/settings.json` so each teammate gets its own pane.
- **Claude Code only, despite the packaging.** The plugin ships a `.codex-plugin/plugin.json` like its siblings, but `team-lead` declares `tools: … Agent, TeamCreate, TeamDelete, TaskCreate, TaskList, TaskGet, TaskUpdate, SendMessage` — Claude Code's Agent Teams tools. On another harness the commands load and the tool calls fail, so this manifest declares `claude-code` alone.
- **`team-lead` requests `opus`** and spawns further agents, so cost is a multiple of a normal run, not an increment.
- **License:** MIT.
- **Measured at pin (2026-07-30):** 38,358 stars · pinned commit 2026-07-18 · repo last push 2026-07-22 · not archived.

Marblo's own answer to the same problem is the board — tickets, dispatch, and per-agent worktrees. This is the in-session version, useful whether or not the app is running.
