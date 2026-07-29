# DuckDB / MotherDuck MCP (referenced)

**Why this one:** `--db-path :memory:` and the agent can query the CSV or Parquet file sitting in the repo, with real SQL, with no server and no ingest step. The same server points at MotherDuck when the data outgrows the laptop.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag, so license, ownership, and maintenance stay with MotherDuck.

- **Upstream:** [motherduckdb/mcp-server-motherduck](https://github.com/motherduckdb/mcp-server-motherduck)
- **Pinned at:** `v1.0.7` (resolves to commit `dc170206665971d70010af10cd6ecd5cd4880ee7`)
- **Measured 2026-07-29 (`gh api`):** 504 stars · last push 2026-07-27 · license MIT

> **Selection note.** This is listed as the DuckDB entry rather than the third-party `mcp-server-duckdb`, which was last pushed in May 2025. This one is the vendor's own, covers plain local DuckDB as well as MotherDuck, and is actively maintained.

## Installing it standalone

Local DuckDB, in memory:

```json
{
  "mcpServers": {
    "duckdb": {
      "command": "uvx",
      "args": ["mcp-server-motherduck", "--db-path", ":memory:"]
    }
  }
}
```

Add `--read-write` to let it create tables, or point `--db-path` at a `.duckdb` file to persist. The MotherDuck cloud form (`--db-path md:` plus a `motherduck_token`) and the per-harness `claude mcp add` / `codex mcp add` one-liners are in **upstream's own README at the pinned ref**.

## Permissions

`network:outbound`, `secrets:read`, `filesystem:read`, `filesystem:write` — reads local CSV, Parquet, and `.duckdb` files; writes the database file when `--read-write` is set; reaches MotherDuck, and DuckDB's own extensions can read from S3 and HTTP endpoints; reads `motherduck_token` from the environment.

Worth stating plainly: DuckDB's file access is as broad as the process's. `--db-path` scopes the _database_, not what a query can `read_csv()`. Leave `--read-write` off unless the task actually needs to write, and do not run this in a directory holding things you would not want read.

The manifest uses the flat permission vocabulary `schema_version: 1` defines; scoped forms (`network:outbound:<host>`, `secrets:read:<VAR>`) arrive with the Phase 1a permission gate, so the concrete scope is written out here rather than asserted in a field the schema cannot yet check.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — listed, not one-click-installable. The payload has not been reviewed by Marblo maintainers; see [SECURITY.md](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).
- **License:** MIT (upstream)

Pinning freezes this at one release: upstream fixes, including security fixes, do not reach you until the pin here moves.
