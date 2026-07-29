# Linear MCP (referenced)

**Why this one:** Linear's own MCP server is remote-hosted at `mcp.linear.app` — there is no repository behind it, so there is nothing this registry can pin. Among the self-hostable community implementations this is the one still under active development, and it runs locally with your own token.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag, so license, ownership, and maintenance stay with the upstream author.

- **Upstream:** [tacticlaunch/mcp-linear](https://github.com/tacticlaunch/mcp-linear)
- **Pinned at:** `v1.4.1` (commit `fc21df37f3a1e943b828ee64eae6b201ff8d8cc8`, released 2026-07-28)
- **Measured 2026-07-29 (`gh api`):** 143 stars · last push 2026-07-28 · license MIT

`package.json` at the pinned tag reads `@tacticlaunch/mcp-linear@1.4.1`, matching npm's current `latest`.

> **Why not the more-starred one.** `jerhadf/linear-mcp-server` carries 347 stars but its last push was 2025-05-01 — fifteen months stale against an API that moves. Activity was weighted over star count here. Note also that the unscoped npm name `mcp-linear` belongs to a **different** project; the package below is the scoped `@tacticlaunch/mcp-linear`.

## Installing it standalone

Any MCP client works — this is a plain stdio MCP server, nothing Marblo-specific:

```json
{
  "mcpServers": {
    "linear": {
      "command": "npx",
      "args": ["-y", "@tacticlaunch/mcp-linear@1.4.1"],
      "env": {
        "LINEAR_API_TOKEN": "..."
      }
    }
  }
}
```

Upstream's README shows the package unversioned; the pin above is deliberate. Create the token in Linear under Settings → API → Personal API keys.

## No one-click install from the Store

This item carries no `install` block, and that is the schema working rather than an omission: registering an MCP server means a process launches on your machine at the next CLI start, and [`registry/manifest.schema.json`](../../registry/manifest.schema.json) allows that only for `official` and `verified` publishers. `community` items are listed and disclosed — you copy the JSON above yourself.

## Permissions

`network:outbound`, `secrets:read` — calls Linear's GraphQL API; reads `LINEAR_API_TOKEN` from the environment.

This server writes. It creates issues, edits them, moves status, and comments, all with your personal token's authority — a Linear personal key is not scopeable per tool, so the blast radius is your whole workspace access. Issue and comment text it returns is untrusted input landing in the model's context; treat it as data, not instructions.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — external, listed, **not reviewed by Marblo maintainers**. This is the one entry in this collection with no vendor behind it: a single-maintainer project, 143 stars. What was checked is what is written above — repo exists, pin resolves, license is MIT, activity numbers are `gh api` readings on 2026-07-29. Judge it accordingly.
- **License:** MIT (upstream)

Pinning freezes this at one tag: upstream fixes, including security fixes, do not reach you until the pin here moves. Upstream tags releases, so there is a feed to watch.
