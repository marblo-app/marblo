# Chroma MCP (referenced)

**Why this one:** it runs with no infrastructure. `--client-type ephemeral` gives the agent a working vector store in the same process, and the same tools point at a persistent directory or Chroma Cloud when the experiment turns into something.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag, so license, ownership, and maintenance stay with Chroma.

- **Upstream:** [chroma-core/chroma-mcp](https://github.com/chroma-core/chroma-mcp)
- **Pinned at:** `v0.2.6` (resolves to commit `e19e4b3b9cca00faa0658d765bbbb51fa4a2e099`)
- **Measured 2026-07-29 (`gh api`):** 579 stars · last push 2025-09-17 · license Apache-2.0

> **Staleness disclosure — read this one.** This is the oldest listing in this batch by a wide margin: the release is from 2025-08-14 and upstream has not pushed since 2025-09-17, roughly ten months before this survey. The repository is **not** archived and Chroma publishes no successor MCP server, so it is listed rather than dropped — but "official and unmaintained" is the honest reading, and a vector store that stops getting dependency updates is a real consideration. Verify it still works against your Chroma version before relying on it.

## Installing it standalone

```json
{
  "mcpServers": {
    "chroma": {
      "command": "uvx",
      "args": [
        "chroma-mcp",
        "--client-type",
        "persistent",
        "--data-dir",
        "/path/to/chroma-data"
      ]
    }
  }
}
```

The four client types (`ephemeral`, `persistent`, `http`, `cloud`), the matching `CHROMA_*` environment variables, and `--dotenv-path` for keeping credentials out of the argument list are in **upstream's own README at the pinned ref**.

## Permissions

`network:outbound`, `secrets:read`, `filesystem:read`, `filesystem:write` — reaches a Chroma server or Chroma Cloud in `http`/`cloud` mode; reads `CHROMA_API_KEY` and the optional dotenv file; reads and writes the local collection directory in `persistent` mode. The `ephemeral` mode touches neither network nor disk.

Worth stating plainly: documents stored here are retrieved into the model's context later. Treat retrieved text as data, not instructions.

The manifest uses the flat permission vocabulary `schema_version: 1` defines; scoped forms (`network:outbound:<host>`, `secrets:read:<VAR>`) arrive with the Phase 1a permission gate, so the concrete scope is written out here rather than asserted in a field the schema cannot yet check.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — listed, not one-click-installable. The payload has not been reviewed by Marblo maintainers; see [SECURITY.md](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).
- **License:** Apache-2.0 (upstream)

Pinning freezes this at one release. Here that matters more than usual: with upstream inactive, there is nothing upstream to un-freeze — this pin needs a deliberate re-check rather than a release feed to watch.
