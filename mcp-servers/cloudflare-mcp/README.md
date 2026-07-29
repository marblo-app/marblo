# Cloudflare MCP Servers (referenced)

**Why this one:** the servers are hosted by Cloudflare, so there is no process to install and no API token to paste — you authorize with OAuth in a browser and the agent gets scoped access to your account's docs, Workers, logs, and analytics.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins an immutable commit, so license, ownership, and maintenance stay with Cloudflare.

- **Upstream:** [cloudflare/mcp-server-cloudflare](https://github.com/cloudflare/mcp-server-cloudflare)
- **Pinned at:** `26c1989472469e79ed31d8e732efd0f2f4841e25` (2026-07-28)
- **Measured 2026-07-29 (`gh api`):** 4,005 stars · last push 2026-07-28 · license Apache-2.0

> **Pin note.** Upstream tags per app — `workers-observability@0.5.2`, `dex-analysis@0.5.2` — never repo-wide. Those literals are not a version-tag shape the registry pin pattern accepts, so the default-branch commit is pinned instead: immutable, and current as of the survey. The manifest `version` is this listing's own; there is no repo-wide upstream release to track.

> **This is a collection.** Seventeen apps live under `apps/` at the pinned commit, each deployed to its own `*.mcp.cloudflare.com` endpoint. You install the endpoints you want, not the repo.

## Installing one standalone

The servers speak Streamable HTTP at `/mcp`. A client that supports remote MCP takes the URL directly:

```json
{
  "mcpServers": {
    "cloudflare-observability": {
      "url": "https://observability.mcp.cloudflare.com/mcp"
    }
  }
}
```

For a client that only speaks stdio, bridge it:

```json
{
  "mcpServers": {
    "cloudflare-observability": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://observability.mcp.cloudflare.com/mcp"
      ]
    }
  }
}
```

The full endpoint table — documentation, Workers bindings, Workers builds, browser rendering, Radar, Logpush, AI Gateway, AutoRAG, audit logs, DNS analytics, DEX, CASB, and the sandbox container — is in **upstream's own README at the pinned ref**.

## Permissions

`network:outbound`, `secrets:read` — the agent talks to `*.mcp.cloudflare.com`; the OAuth flow stores a token your MCP client reads back on later launches.

Worth stating plainly: the OAuth grant is what bounds this, and it is per-server. The sandbox container server runs code on Cloudflare's infrastructure, not on your machine — a different risk from a local `shell:exec`, not a smaller one.

The manifest uses the flat permission vocabulary `schema_version: 1` defines; scoped forms (`network:outbound:<host>`, `secrets:read:<VAR>`) arrive with the Phase 1a permission gate, so the concrete scope is written out here rather than asserted in a field the schema cannot yet check.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — listed, not one-click-installable. The payload has not been reviewed by Marblo maintainers; see [SECURITY.md](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).
- **License:** Apache-2.0 (upstream)

Pinning freezes the _source_ at one commit. Because these servers are hosted, Cloudflare can and does update the running code independently — the pin here documents what was surveyed, it does not freeze what you connect to.
