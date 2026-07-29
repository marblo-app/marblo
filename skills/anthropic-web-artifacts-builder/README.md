# Web Artifacts Builder (skill · community)

**Why it's here:** the hard part of a single-file HTML deliverable is not writing it — it is developing it like a real app and then collapsing it back into one file. This skill ships both halves as scripts: `init-artifact.sh` scaffolds a Vite/React/Tailwind/shadcn project, `bundle-artifact.sh` inlines it into one HTML file.

> **Referenced, not vendored.** The files live in [`anthropics/skills`](https://github.com/anthropics/skills) and stay there. This folder is a manifest and a pointer, pinned to commit `b29e7cf`.
>
> **Tier `community` = listed, not installable.** Marblo will show it in the Store and link it; it will not one-click-install it until the app ships a permission gate — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click). The snippet below is how you install it yourself, today.

## Install it standalone (no Marblo required)

`SKILL.md` plus a `scripts/` directory that includes a vendored shadcn tarball — so pull the whole folder, not one file.

```bash
# Claude Code
SHA=b29e7cf65e5cb78a5ac33d582270551bc74a14eb
mkdir -p ~/.claude/skills && curl -sL "https://codeload.github.com/anthropics/skills/tar.gz/$SHA" \
  | tar -xz -C ~/.claude/skills --strip-components=2 "skills-$SHA/skills/web-artifacts-builder"
chmod +x ~/.claude/skills/web-artifacts-builder/scripts/*.sh
```

```bash
# Codex — same payload, different directory
SHA=b29e7cf65e5cb78a5ac33d582270551bc74a14eb
mkdir -p ~/.codex/skills && curl -sL "https://codeload.github.com/anthropics/skills/tar.gz/$SHA" \
  | tar -xz -C ~/.codex/skills --strip-components=2 "skills-$SHA/skills/web-artifacts-builder"
chmod +x ~/.codex/skills/web-artifacts-builder/scripts/*.sh
```

Scope it to one project instead by extracting into `./.claude/skills/` inside that repo.

## Details

- **Upstream:** [anthropics/skills · `skills/web-artifacts-builder`](https://github.com/anthropics/skills/tree/main/skills/web-artifacts-builder) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** `b29e7cf65e5cb78a5ac33d582270551bc74a14eb` (no release tags exist upstream, so the pin is a SHA)
- **Permissions:** `filesystem:read`, `filesystem:write`, `shell:exec`, `network:outbound` — the widest declaration of the three Anthropic skills here, and it earns every one: `init-artifact.sh` runs `pnpm create vite` and `pnpm install`, and installs pnpm globally via `npm install -g pnpm` if it is missing.
- **Two honest caveats:** (1) that global `npm install -g pnpm` happens without asking — install pnpm yourself first if you would rather it not. (2) The skill targets **claude.ai artifacts**; the bundle it produces is a standalone HTML file, so it is useful anywhere, but the framing and component set are written for that surface.
- **License:** **Apache-2.0.** The repository root ships no `LICENSE` file, so the GitHub API reports the repo as unlicensed — the license is per-skill, and `skills/web-artifacts-builder/LICENSE.txt` is Apache-2.0. Not every skill in that repo is: `docx`, `pdf`, `pptx`, and `xlsx` carry Anthropic's proprietary terms instead, which is why they are absent from this registry.
- **Measured at pin (2026-07-29):** 164,954 stars · last commit 2026-07-24 · not archived.

Pairs with [`anthropic-frontend-design`](../anthropic-frontend-design/) for the look, and [`anthropic-webapp-testing`](../anthropic-webapp-testing/) for driving the result in a browser.
