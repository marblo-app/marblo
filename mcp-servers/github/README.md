# GitHub MCP Server (referenced)

Scoped agent access to repositories, issues, and pull requests, via GitHub's official MCP server.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) is a manifest that points at the upstream repository and pins a released tag, so the license, ownership, and maintenance stay with GitHub.

- **Upstream:** [github/github-mcp-server](https://github.com/github/github-mcp-server)
- **Pinned at:** `v1.7.0`

## Installing it standalone

Follow **upstream's own installation instructions at the pinned tag** — they are authoritative and they change between releases, so we do not restate them here where they would go stale. Once the server is registered with your MCP client, any harness that speaks MCP can use it.

Note that pinning freezes this at one release: upstream security fixes do **not** reach you until the pin here moves. See [SECURITY.md](../../SECURITY.md).

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `verified` (external, reviewed, source-pinned)
- **Permissions:** `repository:read`, `repository:write`, `network:outbound`, `secrets:read` — this one is broad. It needs a token, and it can write. Read the disclosure before you install it.
- **License:** MIT (upstream)
