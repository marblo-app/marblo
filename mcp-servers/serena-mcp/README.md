# Serena (referenced)

**Why this one:** it gives the agent an IDE's primitives — find symbol, find references, replace body — instead of grep and line numbers, which is what stops large-repo edits from turning into whole-file rewrites.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag, so license, ownership, and maintenance stay with Oraios AI.

- **Upstream:** [oraios/serena](https://github.com/oraios/serena)
- **Pinned at:** `v1.6.1`
- **Measured 2026-07-29 (`gh api`):** 27,115 stars · last push 2026-07-28 · license MIT

## Installing it standalone

**Upstream explicitly asks that you not install Serena from a marketplace listing.** Their README at the pinned tag says marketplace entries carry outdated and suboptimal installation commands, and points at their own Quick Start instead. So this listing deliberately restates no install command:

> **Follow the Quick Start in [upstream's README at `v1.6.1`](https://github.com/oraios/serena/blob/v1.6.1/README.md#quick-start).**

Once registered with your MCP client, any harness that speaks MCP can use it.

## Permissions

`repository:read`, `filesystem:read`, `filesystem:write`, `shell:exec`, `network:outbound` — it indexes and edits your working tree, spawns language servers as child processes, and downloads those language servers on first use for a project's language. It needs no API key.

The manifest uses the flat permission vocabulary `schema_version: 1` defines; scoped forms (`network:outbound:<host>`) arrive with the Phase 1a permission gate, so the concrete scope is written out here rather than asserted in a field the schema cannot yet check.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — listed, not one-click-installable. The payload has not been reviewed by Marblo maintainers; see [SECURITY.md](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).
- **License:** MIT (upstream)

Pinning freezes this at one release: upstream fixes, including security fixes, do not reach you until the pin here moves.
