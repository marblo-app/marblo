# MongoDB MCP (referenced)

**Why this one:** two jobs in one server — the database tools (collections, queries, aggregations, indexes) and the Atlas admin tools (clusters, projects, access lists). The schema questions an agent asks constantly are answered without a round trip through you.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag, so license, ownership, and maintenance stay with MongoDB.

- **Upstream:** [mongodb-js/mongodb-mcp-server](https://github.com/mongodb-js/mongodb-mcp-server)
- **Pinned at:** `v1.14.0` (resolves to commit `b7d2a8ea682f99e794215415c71407ba96114f7d`)
- **Measured 2026-07-29 (`gh api`):** 1,088 stars · last push 2026-07-29 · license Apache-2.0

> **Pin note.** Upstream also carries `v1.15.0-alpha.*` tags. The pin tracks `v1.14.0` — the latest release upstream itself marks as latest — rather than a prerelease.

## Installing it standalone

```json
{
  "mcpServers": {
    "mongodb": {
      "command": "npx",
      "args": ["-y", "mongodb-mcp-server@1.14.0", "--readOnly"],
      "env": { "MDB_MCP_CONNECTION_STRING": "mongodb+srv://..." }
    }
  }
}
```

Upstream's own examples use `@latest`; pinning the version, as above, is the recommendation here — a dist-tag means the code you run tomorrow is not the code you read today.

Atlas API credentials (`MDB_MCP_API_CLIENT_ID` / `MDB_MCP_API_CLIENT_SECRET`), the config-file form, tool-level enable/disable, and the Docker image are in **upstream's own README at the pinned ref**.

## Permissions

`network:outbound`, `secrets:read` — connects to your MongoDB deployment and, if configured, the Atlas Administration API; reads the connection string and Atlas client secret from the environment.

`--readOnly` disables every mutating tool and is worth turning on by default. The stronger control is still the database user's role: a connection string with `readAnyDatabase` cannot be talked into a write, whatever the flag says.

The manifest uses the flat permission vocabulary `schema_version: 1` defines; scoped forms (`network:outbound:<host>`, `secrets:read:<VAR>`) arrive with the Phase 1a permission gate, so the concrete scope is written out here rather than asserted in a field the schema cannot yet check.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — listed, not one-click-installable. The payload has not been reviewed by Marblo maintainers; see [SECURITY.md](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).
- **License:** Apache-2.0 (upstream)

Pinning freezes this at one release: upstream fixes, including security fixes, do not reach you until the pin here moves.
