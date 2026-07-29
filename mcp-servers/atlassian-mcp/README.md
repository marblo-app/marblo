# MCP Atlassian (referenced)

**Why this one:** it covers Jira and Confluence together, and it supports Server/Data Center as well as Cloud — which is the deployment most of the alternatives quietly skip.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag, so license, ownership, and maintenance stay with the upstream author.

- **Upstream:** [sooperset/mcp-atlassian](https://github.com/sooperset/mcp-atlassian)
- **Pinned at:** `v0.23.0`
- **Measured 2026-07-29 (`gh api`):** 5,653 stars · last push 2026-07-28 · license MIT

## Installing it standalone

Any MCP client works — this is a plain stdio MCP server, nothing Marblo-specific. It is a Python package (`mcp-atlassian`, console script of the same name, read from `pyproject.toml` at the pinned tag):

```json
{
  "mcpServers": {
    "atlassian": {
      "command": "uvx",
      "args": ["mcp-atlassian"],
      "env": {
        "JIRA_URL": "https://your-org.atlassian.net",
        "JIRA_USERNAME": "you@example.com",
        "JIRA_API_TOKEN": "...",
        "CONFLUENCE_URL": "https://your-org.atlassian.net/wiki",
        "CONFLUENCE_USERNAME": "you@example.com",
        "CONFLUENCE_API_TOKEN": "..."
      }
    }
  }
}
```

Upstream derives its package version dynamically, so the snippet is unpinned while the manifest pins tag `v0.23.0`; pin the PyPI version yourself if you need the two to match exactly. Server/Data Center uses `JIRA_PERSONAL_TOKEN` instead, and upstream also ships a Docker image — both are documented in **upstream's own README at the pinned ref**.

## Permissions

`network:outbound`, `secrets:read` — connects to your Atlassian host, and reads the URL/username/API-token variables above from the environment.

This server can **write**: create and transition issues, edit pages. The credentials you give it carry your own permissions, so scope the Atlassian token rather than the server.

The manifest uses the flat permission vocabulary `schema_version: 1` defines; scoped forms (`network:outbound:<host>`, `secrets:read:<VAR>`) arrive with the Phase 1a permission gate, so the concrete scope is written out here rather than asserted in a field the schema cannot yet check.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — listed, not one-click-installable. The payload has not been reviewed by Marblo maintainers; see [SECURITY.md](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).
- **License:** MIT (upstream)

Pinning freezes this at one release: upstream fixes, including security fixes, do not reach you until the pin here moves.
