# Korean Writing Skills (referenced)

Three prompt-only skills for Korean prose, no scripts:

| Skill             | What it does                                                             |
| ----------------- | ------------------------------------------------------------------------ |
| `humanizer`       | Rewrites text that reads as machine-generated Korean into natural Korean |
| `grammar-checker` | Proofreads against 국립국어원 orthography and grammar rules              |
| `style-guide`     | Applies a consistent Korean writing style                                |

Each ships a `SKILL.md` plus `examples/` and `references/` — the rules are written down rather than left to the model's general sense of Korean.

## How this differs from [`fluent-korean`](../fluent-korean/)

Both fight the same problem — agents writing bad Korean — from opposite ends. `fluent-korean` is an **output style**: it changes how the agent writes, always, for everything it says. These are **skills**: you invoke them on a specific text you already have. Install `fluent-korean` so your agent's own reports read well; install these to clean up a document.

## Referenced, not vendored

**No files from this skill live in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a tag.

- **Upstream:** [DaleSeo/korean-skills](https://github.com/DaleSeo/korean-skills)
- **Pinned at:** tag `v1.0.0` (resolves to `fe6432e95f6675f7e411eacb2e1c36f1de54f962`) · **path:** `skills`

## Why it is listed here

**Measured 2026-07-29:** 120 stars · last upstream push 2026-05-05 · MIT · `v1.0.0` released 2026-05-03. The most-adopted Korean _writing_ skill set we measured, and one of the few Korea items with a tagged release to pin rather than a bare commit.

Three months without a push is worth saying out loud. For a prompt-only skill whose subject — Korean orthography — does not drift, that reads as finished rather than abandoned, but it is a judgement, not a measurement.

## Installing it standalone

```bash
# Upstream's own installer
npx skills add daleseo/korean-skills
npx skills add daleseo/korean-skills@grammar-checker   # or just one

# Or clone at the pinned tag and copy
git clone --branch v1.0.0 https://github.com/DaleSeo/korean-skills /tmp/korean-skills \
  && cp -r /tmp/korean-skills/skills/* ~/.claude/skills/
```

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` (external, payload **not** reviewed — listing only, not one-click-installable)
- **Permissions:** `filesystem:read` only — markdown with no scripts; what it reads is its own bundled examples and references.
- **License:** MIT (upstream, verified via the GitHub license API)
