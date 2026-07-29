# ClickHouse MCP (referenced)

**Why this one:** it is read-only unless you say otherwise. `CLICKHOUSE_ALLOW_WRITE_ACCESS` defaults off, so pointing an agent at an analytics cluster starts from "it can look" rather than "it can look and also `DROP`".

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag, so license, ownership, and maintenance stay with ClickHouse.

- **Upstream:** [ClickHouse/mcp-clickhouse](https://github.com/ClickHouse/mcp-clickhouse)
- **Pinned at:** `v0.4.1` (resolves to commit `66f0d1b5a4634c1055fd42f3b3d56a902766c918`)
- **Measured 2026-07-29 (`gh api`):** 834 stars · last push 2026-07-23 · license Apache-2.0

## Installing it standalone

```json
{
  "mcpServers": {
    "clickhouse": {
      "command": "uvx",
      "args": ["mcp-clickhouse"],
      "env": {
        "CLICKHOUSE_HOST": "your-host.clickhouse.cloud",
        "CLICKHOUSE_PORT": "8443",
        "CLICKHOUSE_USER": "default",
        "CLICKHOUSE_PASSWORD": "...",
        "CLICKHOUSE_SECURE": "true"
      }
    }
  }
}
```

The full environment surface — timeouts, TLS verification, the `CLICKHOUSE_ALLOW_WRITE_ACCESS` switch, the HTTP transport with `CLICKHOUSE_MCP_AUTH_TOKEN`, and the `chdb` extra — is in **upstream's own README at the pinned ref**.

There is a free ClickHouse SQL playground documented upstream if you want to try the tools before pointing this at your own cluster.

## Permissions

`network:outbound`, `secrets:read`, `filesystem:read` — connects to your ClickHouse instance; reads `CLICKHOUSE_PASSWORD` from the environment; and, in the optional chDB mode, queries data files on local disk in-process. The default ClickHouse-only configuration does not read local files.

The control that matters is the ClickHouse user's grants. Leaving `CLICKHOUSE_ALLOW_WRITE_ACCESS` off is a good default, but a read-only _database_ user is the one that survives a misconfiguration.

The manifest uses the flat permission vocabulary `schema_version: 1` defines; scoped forms (`network:outbound:<host>`, `secrets:read:<VAR>`) arrive with the Phase 1a permission gate, so the concrete scope is written out here rather than asserted in a field the schema cannot yet check.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — listed, not one-click-installable. The payload has not been reviewed by Marblo maintainers; see [SECURITY.md](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).
- **License:** Apache-2.0 (upstream)

Pinning freezes this at one release: upstream fixes, including security fixes, do not reach you until the pin here moves.
