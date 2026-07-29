# Snowflake MCP (referenced)

**Why this one:** the config file is the feature. You declare which SQL statement types the server will execute — read-only, or read plus insert, or whatever line you draw — so "let the agent query the warehouse" does not have to mean "let the agent drop a table".

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins an immutable commit, so license, ownership, and maintenance stay with Snowflake Labs.

- **Upstream:** [Snowflake-Labs/mcp](https://github.com/Snowflake-Labs/mcp)
- **Pinned at:** `662cb486395d79ab1ad0b3538f933fe6a686ce7c` — the commit behind upstream tag `v.1.4.2`
- **Measured 2026-07-29 (`gh api`):** 293 stars · last push 2026-05-15 · license Apache-2.0

> **Pin note.** The upstream tag is `v.1.4.2`, with a dot after the `v`. The registry pin pattern accepts `v1.4.2` but not that, so the tag's commit SHA is pinned instead — same tree, a shape the validator can check. `version` above carries the release number the tag stands for.

> **Cadence note.** Last push 2026-05-15, roughly two and a half months before this survey. Not stale enough to exclude, slower than the rest of this batch.

## Installing it standalone

```json
{
  "mcpServers": {
    "snowflake": {
      "command": "uvx",
      "args": [
        "snowflake-labs-mcp",
        "--service-config-file",
        "/path/to/tools_config.yaml"
      ],
      "env": {
        "SNOWFLAKE_ACCOUNT": "your-account",
        "SNOWFLAKE_USER": "your-user",
        "SNOWFLAKE_PASSWORD": "..."
      }
    }
  }
}
```

Key-pair auth (`SNOWFLAKE_PRIVATE_KEY_FILE`), the `--connection-name` form that reads `~/.snowflake/connections.toml`, the HTTP transport, and — most importantly — the `sql_statement_permissions` block in the service config are in **upstream's own README at the pinned ref**.

## Permissions

`network:outbound`, `secrets:read`, `filesystem:read` — connects to your Snowflake account; reads `SNOWFLAKE_PASSWORD` or a private key from the environment; reads the service-config YAML and, with key-pair auth, the key file off disk.

Two controls matter more than this list: the Snowflake role the connection assumes, and the statement allowlist in the config file. Ship it read-only first and widen deliberately — a warehouse is also a bill, and an agent writing exploratory queries can run up a real one.

The manifest uses the flat permission vocabulary `schema_version: 1` defines; scoped forms (`network:outbound:<host>`, `secrets:read:<VAR>`) arrive with the Phase 1a permission gate, so the concrete scope is written out here rather than asserted in a field the schema cannot yet check.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — listed, not one-click-installable. The payload has not been reviewed by Marblo maintainers; see [SECURITY.md](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).
- **License:** Apache-2.0 (upstream)

Pinning freezes this at one release: upstream fixes, including security fixes, do not reach you until the pin here moves.
