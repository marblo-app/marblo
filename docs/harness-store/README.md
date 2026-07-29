# Harness Store

The Store is the in-app catalog of installable ecosystem items, indexed from this repo's [`registry/`](../../registry/).

## Categories

Harnesses · Skills · MCP Servers · Agents · Workflows · Knowledge Packs · **Bundles** (install several at once).

## Installing

Browse the Store in Marblo, pick an item, and install — the app pins the item's tag or commit SHA and tracks updates. First-party items come from this repo; referenced items are fetched from their upstream at the pinned ref.

## Publishing your own

Anyone can contribute. Add a `marblo.yaml` under `registry/` (validated against [`manifest.schema.json`](../../registry/manifest.schema.json)) and open a PR — see [CONTRIBUTING.md](../../CONTRIBUTING.md). Merged community items appear as `community` tier and can be promoted to `verified` after review.

> Note: registry-driven install is landing in phases — see [ROADMAP.md](../../ROADMAP.md). Until the in-app UI ships, items can be installed manually from their folder.
