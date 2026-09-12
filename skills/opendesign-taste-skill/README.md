# Taste Skill by Leonxlnx — OpenDesign bundle (skill · community)

**Why it's here:** agent-built marketing pages converge on the same hero, the same three feature cards, the same gradient. This skill makes the agent state a one-line design read and set three dials (variance, motion, density) before writing any markup. It then holds that output to a pre-flight list of banned "AI tells".

> **Referenced, not vendored.** The two files live in [`nexu-io/open-design`](https://github.com/nexu-io/open-design/tree/73953213a6fec2c8092e8e77d229a3074aa828a9/skills/taste-skill), pinned to commit `7395321` (the `open-design-v0.22.2` release). Nothing is copied into this repo.
>
> **Tier `community` = unreviewed, consent-gated.** Marblo installs it only after you acknowledge the "unreviewed content" warning, and it checks both files against the sha256 digests in [`marblo.yaml`](marblo.yaml) before anything lands on disk — [why](../../SECURITY.md).

## Who made it, and why the pin points at OpenDesign

- **Author:** [Leonxlnx](https://github.com/Leonxlnx/taste-skill), under the **MIT** license (`Copyright (c) 2026 Leonxlnx`).
- **Bundle source:** [OpenDesign](https://github.com/nexu-io/open-design) (Apache-2.0 app) ships a copy of the skill at `skills/taste-skill/`. That copy has the author's MIT `LICENSE` next to `SKILL.md`, and the file is byte-identical to the original repo's root `LICENSE`.
- **Why not pin the original repo:** Leonxlnx/taste-skill keeps `LICENSE` at the repo root and `SKILL.md` under `skills/taste-skill/`. An install copies files from one directory, so it can't carry both. The OpenDesign copy can, so every installed copy includes the copyright and permission notice, as MIT requires.
- **What differs from the original** ([`ccbc156`](https://github.com/Leonxlnx/taste-skill/tree/ccbc15639c97057cbfcf32ecebc38ef716e4bb37/skills/taste-skill)): only the frontmatter, plus one blank line. OpenDesign adds a `triggers:` list and an `od:` block (preview, design-system, and craft hints for its own runtime), which Claude Code ignores. The body text is otherwise identical. The skill body does not depend on OpenDesign, its daemon, or its desktop app. Installing this item installs **none of those**.

## What gets installed, and where

|                           |                                                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Harness                   | **Claude Code** only (the Marblo app installs `files` items into the Claude skills root)                                           |
| Path                      | `~/.claude/skills/opendesign-taste-skill/`                                                                                         |
| Files                     | `LICENSE` (1,065 B) · `SKILL.md` (87,915 B) — nothing else, no scripts                                                             |
| Skill name in Claude Code | `design-taste-frontend` (from the frontmatter; the folder name is the Store id)                                                    |
| Removal                   | The Store's uninstall deletes exactly those two files, and the folder only if it is then empty. Anything you added yourself stays. |
| Update                    | Reinstalling over an existing install replaces the whole folder, so keep your own notes outside it.                                |

## Cost

- **License:** none. The skill is MIT and this item needs no OpenDesign account, subscription, or API key.
- **Model usage: yes.** A skill is instructions your agent reads, so every run spends your own Claude Code usage (subscription quota or API billing, whichever you already use). `SKILL.md` is about 88 KB and long for a skill, so loading it takes a noticeable share of context.
- OpenDesign's paid Cloud and Go Plan belong to the OpenDesign app. They are not involved here.

## Before you install it

- **Scope:** landing pages, portfolios, and redesigns. The skill itself says it is **not** for dashboards, data tables, multi-step forms, or native mobile.
- **It suggests dependencies.** Its stack defaults are React/Next.js, Tailwind v4, and Motion. It requires the agent to _output_ an install command before importing a missing package, and its appendix lists install commands for Material, Fluent, Carbon, shadcn/ui, and other design systems. The skill runs nothing itself, but following it can add packages to your project. Your agent's normal permission prompts still apply.
- **Don't install it twice.** If you already have Leonxlnx's or OpenDesign's copy under another folder name, Claude Code will see two skills named `design-taste-frontend`. Keep one.

## How to install it

Install it from the **Marblo Store**: Skills → this item → acknowledge the "unreviewed content" warning. The app then does the following:

- It downloads both files at the pin into a staging folder.
- It checks each file against the sha256 digests in [`marblo.yaml`](marblo.yaml) and moves the folder into place only if every check passes. A failed download or a mismatch leaves nothing behind.
- If `~/.claude/skills/opendesign-taste-skill/` already exists and Marblo didn't install it, the app refuses and leaves the folder untouched.

This README has no copy-paste shell install on purpose. A hand-written script that writes straight into `~/.claude/skills/` can overwrite a folder you already have, or leave a half-downloaded skill that your agent loads anyway. Without Marblo, the pinned file list and digests are in [`marblo.yaml`](marblo.yaml). Verify both files before they reach your skills directory, and don't place them over an existing folder.

## Details

- **Upstream (pinned):** [nexu-io/open-design · `skills/taste-skill` @ `7395321`](https://github.com/nexu-io/open-design/tree/73953213a6fec2c8092e8e77d229a3074aa828a9/skills/taste-skill) · **Original:** [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** `73953213a6fec2c8092e8e77d229a3074aa828a9`, the target of release tag `open-design-v0.22.2`, published 2026-09-10. The tag name doesn't fit the registry's ref pattern, so the pin is the SHA.
- **Permissions:** `filesystem:read`, `filesystem:write`. The skill is prose, not tooling: it reads the UI you have and shapes the UI you write. No scripts, no shell, no network of its own.
- **License:** **MIT** (Leonxlnx). The OpenDesign repository as a whole is Apache-2.0, but the installed files are the author's MIT skill and its MIT license.
- **Measured at pin (2026-09-12):** original repo 86,376 stars, last push 2026-08-24; OpenDesign 95,671 stars, last push 2026-09-12. Neither is archived.
