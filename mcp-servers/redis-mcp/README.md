# Redis MCP (referenced)

**Why this one:** it covers the whole type surface, not just `GET`/`SET` — hashes, streams, JSON documents, and vector indexes are all addressable, which is what makes Redis usable as agent working memory rather than only as a cache you debug.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag, so license, ownership, and maintenance stay with Redis.

- **Upstream:** [redis/mcp-redis](https://github.com/redis/mcp-redis)
- **Pinned at:** `0.5.0` (resolves to commit `d82bfe1a2ca1e521d3d2c78ecbdf3d628a97ca19`)
- **Measured 2026-07-29 (`gh api`):** 555 stars · last push 2026-07-28 · license MIT

> **Cadence note.** The tag is from 2026-03-16 while the branch is active as of this survey — the pin trails the code by about four months. That is a deliberate trade: an immutable release pin over a moving branch.

## Installing it standalone

```json
{
  "mcpServers": {
    "redis": {
      "command": "uvx",
      "args": [
        "--from",
        "redis-mcp-server@0.5.0",
        "redis-mcp-server",
        "--url",
        "redis://localhost:6379/0"
      ]
    }
  }
}
```

A single `--url` (or `rediss://` for TLS) replaces the individual host/port/password variables. The environment-variable form, Entra ID authentication for Azure Managed Redis, TLS certificate options, and the Docker image are in **upstream's own README at the pinned ref**.

## Permissions

`network:outbound`, `secrets:read`, `filesystem:read` — connects to your Redis instance; reads `REDIS_PWD` (or the credentials inside the connection URL) from the environment; reads CA and client certificate files from disk when connecting over TLS.

Worth stating plainly: this server writes as well as reads, and there is no read-only switch. A Redis ACL user restricted to the commands and key prefixes you intend is the boundary here — the tool list is not.

The manifest uses the flat permission vocabulary `schema_version: 1` defines; scoped forms (`network:outbound:<host>`, `secrets:read:<VAR>`) arrive with the Phase 1a permission gate, so the concrete scope is written out here rather than asserted in a field the schema cannot yet check.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — listed, not one-click-installable. The payload has not been reviewed by Marblo maintainers; see [SECURITY.md](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).
- **License:** MIT (upstream)

Pinning freezes this at one release: upstream fixes, including security fixes, do not reach you until the pin here moves.
