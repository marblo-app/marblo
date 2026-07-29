# Harness Store

The Store is the in-app catalog of ecosystem items, indexed from this repo.

**You do not need it to use anything here.** Every first-party asset is a plain, standards-native file that works standalone — see the install snippets in the [repo README](../../README.md#30-second-install-no-app-required) and in each item's own README. The Store adds one-click install, version tracking, and updates on top of that.

## Categories

Harnesses · Skills · MCP Servers · Agents · Workflows · Knowledge Packs · **Bundles** (install several at once).

## Installing

**Standalone (works today, no app):** copy the asset into the directory your CLI already reads — `~/.claude/skills/<name>/SKILL.md`, `~/.codex/skills/<name>/SKILL.md`, `~/.claude/agents/<name>.md`. Each item's README has the exact command.

**In Marblo (landing in phases):** browse the Store, pick an item, install — the app pins the item's tag or commit SHA and tracks updates. First-party items come from this repo; referenced items are fetched from their upstream at the pinned ref.

> **Status:** registry-driven install is **not shipped yet** — it is Phase 1a, and it starts with two item types (`skill`, `mcp-server`). See [ROADMAP.md](../../ROADMAP.md) §5. Until then, install manually using the snippets above.

## Trust

- `official` and `verified` items will be installable from the Store.
- `community` items are **listings** — discoverable and linked to their source, not one-click-installable — until the app ships a permission-disclosure gate. [Why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).
- Declared permissions are **disclosure, not enforcement.** Marblo shows what an item says it needs; it does not restrict what the item can do once installed.

## Publishing your own

Anyone can contribute. Create `<category>/<id>/` at the repo root with a `marblo.yaml` validated against [`manifest.schema.json`](../../registry/manifest.schema.json), and open a PR — see [CONTRIBUTING.md](../../CONTRIBUTING.md). There is no CI yet; a maintainer reviews the manifest and the payload by hand.
