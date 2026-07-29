# Asana MCP (referenced)

**Why this one:** it is the only Asana MCP server with meaningful adoption and a real license. Search and read tasks, projects, and portfolios; create tasks, post comments, update status — the operations a project actually runs on.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag, so license, ownership, and maintenance stay with the upstream author.

- **Upstream:** [roychri/mcp-server-asana](https://github.com/roychri/mcp-server-asana)
- **Pinned at:** `v1.6.0`
- **Measured 2026-07-29 (`gh api`):** 145 stars · 72 forks · last push 2026-05-10 · license MIT

> **Maintenance note — read this one.** Two and a half months since the last push, and upstream tags releases but publishes **no GitHub Releases**, so there is no release feed to subscribe to. This pin needs a deliberate re-check rather than a notification. The field was thin: the next MIT-licensed Asana servers down the list sit at 3 stars.

## Installing it standalone

Node, published to npm as `@roychri/mcp-server-asana`:

```json
{
  "mcpServers": {
    "asana": {
      "command": "npx",
      "args": ["-y", "@roychri/mcp-server-asana"],
      "env": { "ASANA_ACCESS_TOKEN": "your-asana-access-token" }
    }
  }
}
```

API access depends on your Asana plan — some tiers do not expose it, which surfaces as permission errors rather than a clear message. Details are in **upstream's own README at the pinned ref**.

## Installing it from the Marblo Store

Not installable. This is a `community` item: listed and disclosed, no install button. See [CONTRIBUTING.md](../../CONTRIBUTING.md) for why unreviewed items do not get to register a process that launches on your machine.

## Permissions

`network:outbound`, `secrets:read` — calls the Asana API; reads `ASANA_ACCESS_TOKEN` from the environment.

An Asana personal access token carries everything your account can see. There is no read-only variant, so the blast radius is your whole workspace membership.

The manifest uses the flat permission vocabulary `schema_version: 1` defines; scoped forms (`network:outbound:<host>`, `secrets:read:<VAR>`) arrive with the Phase 1a permission gate, so the concrete scope is written out here rather than asserted in a field the schema cannot yet check.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — external, **not** reviewed by Marblo maintainers. The pin is immutable and the license was checked; the payload was not audited.
- **License:** MIT (upstream, `LICENSE` present at the pinned ref)

Pinning freezes this at one tag: upstream fixes, including security fixes, do not reach you until the pin here moves.
