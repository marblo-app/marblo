# Legacy Modernization (workflow · community)

**Why it's here:** migrations fail in the middle, and an agent that has forgotten what phase it is in is worse than no agent. `/legacy-modernize` writes every step's output to `.legacy-modernize/` and reads from those files rather than from context, so an interrupted run can be resumed instead of restarted.

> **Referenced, not vendored.** Files live in [`wshobson/agents`](https://github.com/wshobson/agents), pinned to commit `c4b82b0`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

The plugin is three commands (`legacy-modernize`, `code-migrate`, `deps-upgrade`), two agents (`framework-migration-legacy-modernizer`, `framework-migration-architect-review`), and four skills (Angular migration, React modernization, database migration, dependency upgrade). Install the parts together — the commands dispatch the agents by their namespaced frontmatter names.

```bash
SHA=c4b82b0ad771190355eb8e204b1329732a18449a
TMP=$(mktemp -d)
curl -sL "https://codeload.github.com/wshobson/agents/tar.gz/$SHA" \
  | tar -xz -C "$TMP" "agents-$SHA/plugins/framework-migration"
SRC="$TMP/agents-$SHA/plugins/framework-migration"

mkdir -p ~/.claude/commands ~/.claude/agents
cp "$SRC"/commands/*.md ~/.claude/commands/
cp "$SRC"/agents/*.md   ~/.claude/agents/
mkdir -p ~/.claude/skills
cp -R "$SRC"/skills/*     ~/.claude/skills/
```

## Details

- **Upstream:** [`plugins/framework-migration`](https://github.com/wshobson/agents/tree/main/plugins/framework-migration) · **Manifest:** [`marblo.yaml`](marblo.yaml) · plugin version `1.3.2` at the pin
- **Pinned to:** `c4b82b0ad771190355eb8e204b1329732a18449a` (no release tags upstream)
- **Permissions:** `repository:read`, `filesystem:write`, `shell:exec` — it rewrites source, runs the test suite between phases, and persists its own state under `.legacy-modernize/`.
- **It stops on purpose.** The command declares hard behavioural rules: execute steps in order, write each step's file before the next begins, halt on any failure, and pause at every `PHASE CHECKPOINT` for explicit approval via AskUserQuestion. Do not run it expecting an unattended migration.
- **Resumable by design:** on start it looks for `.legacy-modernize/state.json` and offers to continue an in-progress session. Add that directory to `.gitignore` before the first run.
- **No cross-plugin dependencies:** every `subagent_type` it dispatches is either bundled here or `general-purpose`.
- **License:** MIT.
- **Measured at pin (2026-07-30):** 38,358 stars · pinned commit 2026-07-18 · repo last push 2026-07-22 · not archived.

The single-agent version of the same job is [`wshobson-legacy-modernizer`](https://github.com/wshobson/agents/blob/main/plugins/framework-migration/agents/legacy-modernizer.md) upstream; this pins the whole pipeline around it.
