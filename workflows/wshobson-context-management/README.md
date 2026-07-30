# Context Save & Restore (workflow · community)

**Why it's here:** long tasks outlive a context window, and the usual recovery — re-reading the repo and guessing — loses every decision that was never written down. These two commands make the handoff an artefact instead of an act of memory.

> **Referenced, not vendored.** Files live in [`wshobson/agents`](https://github.com/wshobson/agents), pinned to commit `c4b82b0`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

The plugin is two commands (`context-save`, `context-restore`) and the `context-management-context-manager` agent they lean on. Install the parts together — the commands dispatch the agents by their namespaced frontmatter names.

```bash
SHA=c4b82b0ad771190355eb8e204b1329732a18449a
TMP=$(mktemp -d)
curl -sL "https://codeload.github.com/wshobson/agents/tar.gz/$SHA" \
  | tar -xz -C "$TMP" "agents-$SHA/plugins/context-management"
SRC="$TMP/agents-$SHA/plugins/context-management"

mkdir -p ~/.claude/commands ~/.claude/agents
cp "$SRC"/commands/*.md ~/.claude/commands/
cp "$SRC"/agents/*.md   ~/.claude/agents/
```

## Details

- **Upstream:** [`plugins/context-management`](https://github.com/wshobson/agents/tree/main/plugins/context-management) · **Manifest:** [`marblo.yaml`](marblo.yaml) · plugin version `1.2.1` at the pin
- **Pinned to:** `c4b82b0ad771190355eb8e204b1329732a18449a` (no release tags upstream)
- **Permissions:** `repository:read`, `filesystem:write`, `shell:exec` — capture walks the project and writes a context artefact; restore reads it back. Neither touches a remote.
- **Both command files ship without YAML frontmatter.** They load and run, but they contribute no `description` to the slash-command list — so `/context-save` will look bare next to commands from other plugins. Cosmetic, but surprising if you are hunting for a typo.
- **Parameterised by convention, not by flags:** the prompts read `$PROJECT_ROOT`, `$CONTEXT_TYPE` (minimal / standard / comprehensive), `$STORAGE_FORMAT`, and `$TAGS` from what you type, rather than parsing declared arguments.
- **License:** MIT.
- **Measured at pin (2026-07-30):** 38,358 stars · pinned commit 2026-07-18 · repo last push 2026-07-22 · not archived.

The agent-side equivalent from the other collection is [`voltagent-context-manager`](../../agents/voltagent-context-manager/) — an agent to query, versus commands you invoke.
