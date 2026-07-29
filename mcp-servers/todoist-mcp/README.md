# Todoist MCP (referenced)

**Why this one:** Doist publishes it themselves. Every other Todoist MCP server in the field is a third-party wrapper around the same API; this one is maintained by the people who own the API.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag, so license, ownership, and maintenance stay with the upstream author.

- **Upstream:** [Doist/todoist-mcp](https://github.com/Doist/todoist-mcp)
- **Pinned at:** `v12.1.2` (released 2026-07-27)
- **Measured 2026-07-29 (`gh api`):** 530 stars · 52 forks · last push 2026-07-27 · license MIT

## Installing it standalone

Node, published to npm as `@doist/todoist-mcp`. Local stdio, with your own API token:

```json
{
  "mcpServers": {
    "todoist": {
      "command": "npx",
      "args": ["-y", "@doist/todoist-mcp"],
      "env": { "TODOIST_API_KEY": "..." }
    }
  }
}
```

Doist also runs a **hosted** endpoint at `https://ai.todoist.net/mcp`, reachable through `npx -y mcp-remote https://ai.todoist.net/mcp`. Both are documented in **upstream's own README at the pinned ref**. The local form is shown above because it is the one this pin actually governs — the hosted endpoint is a service, not a ref.

## Installing it from the Marblo Store

Not installable. This is a `community` item: listed and disclosed, no install button. See [CONTRIBUTING.md](../../CONTRIBUTING.md) for why unreviewed items do not get to register a process that launches on your machine.

## Permissions

`network:outbound`, `secrets:read` — calls the Todoist API; reads `TODOIST_API_KEY` from the environment.

A Todoist API token is full account access with no read-only variant, so an agent that can list your tasks can also complete and delete them.

The manifest uses the flat permission vocabulary `schema_version: 1` defines; scoped forms (`network:outbound:<host>`, `secrets:read:<VAR>`) arrive with the Phase 1a permission gate, so the concrete scope is written out here rather than asserted in a field the schema cannot yet check.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — external, **not** reviewed by Marblo maintainers. Vendor-published is a provenance signal, not a Marblo review: the pin is immutable and the license was checked, but the payload was not audited.
- **License:** MIT (upstream, `LICENSE` present at the pinned ref)

Pinning freezes this at one tag: upstream fixes, including security fixes, do not reach you until the pin here moves.
