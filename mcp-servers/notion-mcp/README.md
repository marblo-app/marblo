# Notion MCP Server (referenced)

**Why this one:** it is Notion's own server, and its access model is the useful part — an integration sees only the pages you explicitly share with it, so scope is set in Notion rather than trusted to the agent.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag, so license, ownership, and maintenance stay with Notion.

- **Upstream:** [makenotion/notion-mcp-server](https://github.com/makenotion/notion-mcp-server)
- **Pinned at:** `v2.5.0` (commit `9beb1c35`, 2026-07-24)
- **Measured 2026-07-29 (`gh api`):** 4,558 stars · last push 2026-07-25 · license MIT

> **Pin note.** Upstream's only _published GitHub release_ is `v2.1.0` from 2026-01-31, but their tags run on to `v2.5.0` and `package.json` on the default branch reads `2.5.1`. So `releases/latest` reports something six months stale for this repo; the pin above follows the newest **tag**, verified to exist and to carry `"version": "2.5.0"`.

## Installing it standalone

Any MCP client works — this is a plain stdio MCP server, nothing Marblo-specific:

```json
{
  "mcpServers": {
    "notion": {
      "command": "npx",
      "args": ["-y", "@notionhq/notion-mcp-server@2.5.0"],
      "env": { "NOTION_TOKEN": "ntn_..." }
    }
  }
}
```

Package name and version read from `package.json` at the pinned tag. Upstream also documents a hosted remote server and an `OPENAPI_MCP_HEADERS` form for custom headers — see **upstream's own README at the pinned ref**.

## Permissions

`network:outbound`, `secrets:read` — calls the Notion API, and reads `NOTION_TOKEN` from the environment.

This server can **write** to pages. Before connecting it, share only the pages the agent needs with your integration — that connection step, not this manifest, is where the blast radius is decided.

The manifest uses the flat permission vocabulary `schema_version: 1` defines; scoped forms (`network:outbound:<host>`, `secrets:read:<VAR>`) arrive with the Phase 1a permission gate, so the concrete scope is written out here rather than asserted in a field the schema cannot yet check.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — listed, not one-click-installable. The payload has not been reviewed by Marblo maintainers; see [SECURITY.md](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).
- **License:** MIT (upstream)

Pinning freezes this at one release: upstream fixes, including security fixes, do not reach you until the pin here moves. Watch **tags**, not the releases feed, for this repo.
