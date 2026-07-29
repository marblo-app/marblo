# Git Workflow (workflow · community)

**Why it's here:** it is the only workflow in this registry that ends by touching a **remote**. Ten steps from review to opened PR, with the two properties that make that survivable: every step writes its output to `.git-workflow/` instead of trusting the context window, and the steps that push and open the PR stop and show you the command first.

> **Referenced, not vendored.** Files live in [`wshobson/agents`](https://github.com/wshobson/agents), pinned to commit `c4b82b0`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

A Claude Code slash command plus the subagent it dispatches. Install both halves or the dispatch will fail.

```bash
SHA=c4b82b0ad771190355eb8e204b1329732a18449a
TMP=$(mktemp -d)
curl -sL "https://codeload.github.com/wshobson/agents/tar.gz/$SHA" \
  | tar -xz -C "$TMP" "agents-$SHA/plugins/git-pr-workflows"
SRC="$TMP/agents-$SHA/plugins/git-pr-workflows"

mkdir -p ~/.claude/commands ~/.claude/agents
cp "$SRC"/commands/*.md ~/.claude/commands/
cp "$SRC"/agents/*.md   ~/.claude/agents/
```

You get `/git-workflow` — the pipeline — plus `/pr-enhance` and `/onboard`, which are standalone prompts rather than parts of it. The pipeline is backed by the `git-pr-workflows-code-reviewer` subagent, which it dispatches by that namespaced frontmatter name; that is why the two `cp` lines go together. Its remaining steps dispatch `general-purpose`, so there are no cross-plugin dependencies.

Upstream also ships a `.codex-plugin/plugin.json` beside `.claude-plugin/`, so the same payload is intended to load in Codex.

## Details

- **Upstream:** [`plugins/git-pr-workflows`](https://github.com/wshobson/agents/tree/main/plugins/git-pr-workflows) · **Manifest:** [`marblo.yaml`](marblo.yaml) · plugin version `1.3.1` at the pin
- **Pinned to:** `c4b82b0ad771190355eb8e204b1329732a18449a` (no release tags upstream)
- **Permissions:** `repository:read`, `repository:write`, `filesystem:write`, `shell:exec`, `network:outbound` — the widest declaration in this registry, and every entry is load-bearing: it commits, pushes a branch, and opens a pull request against your remote.
- **Read this before the first run:** it writes `.git-workflow/` into your working directory — add it to `.gitignore`, or step 6's conventional commit will sweep the pipeline's own scratch files into your PR. `--no-push` and `--draft-pr` exist if you want the pipeline without the remote effects.
- **License:** MIT.
- **Measured at pin (2026-07-29):** 38,347 stars · pinned commit 2026-07-18 · not archived.

Where our own [`review-and-merge`](../review-and-merge/) is Marblo-side (it closes a board ticket), this one is entirely local — useful whether or not you run the app.
