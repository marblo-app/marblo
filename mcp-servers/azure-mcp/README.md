# Azure MCP Server (referenced)

**Why this one:** it reuses the sign-in you already have. If `az login` works, the agent can read your storage accounts, Cosmos containers, Key Vault entries, AKS clusters, and Monitor queries without a separate credential to mint and rotate.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins an immutable commit, so license, ownership, and maintenance stay with Microsoft.

- **Upstream:** [microsoft/mcp](https://github.com/microsoft/mcp), at `servers/Azure.Mcp.Server`
- **Pinned at:** `bd96686782eb9b62c47662b941de4c4b9eb0aaf7` — the commit behind upstream tag `Azure.Mcp.Server-3.0.0-beta.30`
- **Measured 2026-07-29 (`gh api`):** 3,512 stars · last push 2026-07-29 · license MIT

> **Repo-move note — read this one.** The standalone `Azure/azure-mcp` repo is **archived** (last push 2026-02-06). Development moved into `microsoft/mcp`, a catalog repo that also hosts `Fabric.Mcp.Server`. The star count above is the catalog's, not this server's — GitHub does not count stars per subdirectory, and inflating one into the other would be a measurement this listing cannot back. A pin at the archived repo would have frozen this five months behind.

> **Pin note.** Upstream tags read `Azure.Mcp.Server-3.0.0-beta.30`; that literal is not a version-tag shape the registry pin pattern accepts, so the tag's commit SHA is pinned instead and `version` carries the SemVer part. The current release line is a beta — that is upstream's own labelling, not a downgrade applied here.

## Installing it standalone

Ships for three runtimes at the pinned ref. The Node path is the shortest:

```json
{
  "mcpServers": {
    "azure": {
      "command": "npx",
      "args": ["-y", "@azure/mcp@latest", "server", "start"]
    }
  }
}
```

The .NET (`dnx` / `dotnet tool install Azure.Mcp`) and Python (`uvx`) entrypoints, plus namespace/tool filtering so the agent sees a smaller surface, are in **upstream's own README at the pinned ref**.

## Permissions

`network:outbound`, `secrets:read`, `filesystem:read` — calls Azure Resource Manager and per-service endpoints; resolves credentials through the Azure Identity chain, which reads the local `az` CLI token cache and developer credential files.

Two things worth stating plainly. This server inherits _your_ Azure permissions, so the RBAC role on the signed-in identity is the actual boundary — not this list. And Key Vault tooling means secret values can land in the model's context; scope the role so it cannot read vaults you would not paste into a chat.

The manifest uses the flat permission vocabulary `schema_version: 1` defines; scoped forms (`network:outbound:<host>`, `secrets:read:<VAR>`) arrive with the Phase 1a permission gate, so the concrete scope is written out here rather than asserted in a field the schema cannot yet check.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — listed, not one-click-installable. The payload has not been reviewed by Marblo maintainers; see [SECURITY.md](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).
- **License:** MIT (upstream)

Pinning freezes this at one commit: upstream fixes, including security fixes, do not reach you until the pin here moves.
