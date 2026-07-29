# Qdrant MCP (referenced)

**Why this one:** it is deliberately two tools — store and find. The embedding happens inside the server, so "remember this" and "what do we know about X" work without you building an ingestion pipeline first.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag, so license, ownership, and maintenance stay with Qdrant.

- **Upstream:** [qdrant/mcp-server-qdrant](https://github.com/qdrant/mcp-server-qdrant)
- **Pinned at:** `v0.8.1` (resolves to commit `860ab93a96ca9f5e6cf6fe47e2f5b75d36eaac69`)
- **Measured 2026-07-29 (`gh api`):** 1,484 stars · last push 2026-07-24 · license Apache-2.0

> **Cadence note.** The tag is from 2025-12-10 while the branch is active as of this survey — the pin trails the code by roughly seven months. An immutable release pin is still the trade this registry makes over a moving branch.

## Installing it standalone

```json
{
  "mcpServers": {
    "qdrant": {
      "command": "uvx",
      "args": ["mcp-server-qdrant"],
      "env": {
        "QDRANT_URL": "http://localhost:6333",
        "COLLECTION_NAME": "agent-memory",
        "EMBEDDING_MODEL": "sentence-transformers/all-MiniLM-L6-v2"
      }
    }
  }
}
```

`QDRANT_API_KEY` for Qdrant Cloud, `QDRANT_LOCAL_PATH` for a local on-disk store instead of a server, the SSE transport, the Docker image, and the tool-description overrides that let you retarget the server at a specific memory shape are in **upstream's own README at the pinned ref**.

## Permissions

`network:outbound`, `secrets:read`, `filesystem:read`, `filesystem:write` — connects to your Qdrant instance and downloads the embedding model on first run; reads `QDRANT_API_KEY` from the environment; reads and writes an on-disk collection when run in the documented `QDRANT_LOCAL_PATH` mode. The remote-instance configuration does not write to your project.

Worth stating plainly: stored text is retrieved later and lands in the model's context. Whatever gets written here is something a future session will read back as trusted memory — that is the point, and also the risk.

The manifest uses the flat permission vocabulary `schema_version: 1` defines; scoped forms (`network:outbound:<host>`, `secrets:read:<VAR>`) arrive with the Phase 1a permission gate, so the concrete scope is written out here rather than asserted in a field the schema cannot yet check.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — listed, not one-click-installable. The payload has not been reviewed by Marblo maintainers; see [SECURITY.md](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).
- **License:** Apache-2.0 (upstream)

Pinning freezes this at one release: upstream fixes, including security fixes, do not reach you until the pin here moves.
