# Receiving Code Review (skill · community)

**Why it's here:** the standard model failure on review feedback is agreement — "You're absolutely right!" followed by implementing a suggestion that does not fit the codebase. This skill bans that phrase by name and replaces it with a verify-then-respond sequence.

> **Referenced, not vendored.** The files live in [`obra/superpowers`](https://github.com/obra/superpowers), pinned to the release tag `v6.2.0`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click). Install it yourself below.

## Install it standalone (no Marblo required)

The skill is a single `SKILL.md`.

```bash
# Claude Code
mkdir -p ~/.claude/skills && curl -sL "https://codeload.github.com/obra/superpowers/tar.gz/refs/tags/v6.2.0" \
  | tar -xz -C ~/.claude/skills --strip-components=2 "superpowers-6.2.0/skills/receiving-code-review"
```

```bash
# Codex
mkdir -p ~/.codex/skills && curl -sL "https://codeload.github.com/obra/superpowers/tar.gz/refs/tags/v6.2.0" \
  | tar -xz -C ~/.codex/skills --strip-components=2 "superpowers-6.2.0/skills/receiving-code-review"
```

## Details

- **Upstream:** [obra/superpowers · `skills/receiving-code-review`](https://github.com/obra/superpowers/tree/main/skills/receiving-code-review) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** tag `v6.2.0`
- **Permissions:** `repository:read`, `filesystem:write`, `shell:exec` — it verifies each claim against the codebase, then implements accepted items one at a time and tests each.
- **Partial understanding is treated as a stop condition:** if any item in a batch is unclear, it asks before implementing *any* of them, on the grounds that review items are usually related.
- **It distinguishes sources:** feedback from your human partner is trusted after understanding; feedback from an external reviewer gets checked for correctness against this codebase first.
- **License:** MIT.
- **Measured at pin (2026-07-30):** 263,359 stars · tag `v6.2.0` commit 2026-07-24 · repo last push 2026-07-28 · not archived.

Pairs with [`superpowers-requesting-code-review`](../superpowers-requesting-code-review/) — asking for the review, and handling what comes back.
