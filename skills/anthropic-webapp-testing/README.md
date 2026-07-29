# Webapp Testing (skill · community)

**Why it's here:** an agent that cannot see the page will confidently tell you the fix worked — this skill gives it a browser, a screenshot, and the console log, so "it works" becomes a claim with evidence behind it.

> **Referenced, not vendored.** The files live in [`anthropics/skills`](https://github.com/anthropics/skills), pinned to commit `b29e7cf`. This folder is the manifest and the pointer.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click). Install it yourself with the snippet below.

## Install it standalone (no Marblo required)

`SKILL.md` plus `scripts/` (a server-lifecycle helper) and `examples/`, so pull the folder.

```bash
# Claude Code
SHA=b29e7cf65e5cb78a5ac33d582270551bc74a14eb
mkdir -p ~/.claude/skills && curl -sL "https://codeload.github.com/anthropics/skills/tar.gz/$SHA" \
  | tar -xz -C ~/.claude/skills --strip-components=2 "skills-$SHA/skills/webapp-testing"
```

```bash
# Codex
SHA=b29e7cf65e5cb78a5ac33d582270551bc74a14eb
mkdir -p ~/.codex/skills && curl -sL "https://codeload.github.com/anthropics/skills/tar.gz/$SHA" \
  | tar -xz -C ~/.codex/skills --strip-components=2 "skills-$SHA/skills/webapp-testing"
```

You supply the runtime: it writes **native Python Playwright** scripts, so `pip install playwright && playwright install chromium` has to have happened on the machine.

## Details

- **Upstream:** [anthropics/skills · `skills/webapp-testing`](https://github.com/anthropics/skills/tree/main/skills/webapp-testing) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** `b29e7cf65e5cb78a5ac33d582270551bc74a14eb` (upstream publishes no release tags)
- **Permissions:** `filesystem:read`, `filesystem:write`, `shell:exec`, `network:outbound` — it writes test scripts, starts and stops your dev server, and drives a browser against it.
- **License:** **Apache-2.0**, from `skills/webapp-testing/LICENSE.txt`. The repository root has no `LICENSE` file — GitHub therefore reports the repo as unlicensed — but every skill folder carries its own, and it ships with the install above.
- **Measured at pin (2026-07-29):** 164,888 stars · last commit 2026-07-24 · not archived.
