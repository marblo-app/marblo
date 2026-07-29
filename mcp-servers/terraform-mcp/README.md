# Terraform MCP Server (referenced)

**Why this one:** provider schemas are exactly the thing models get wrong from memory — argument renamed, block moved, attribute now required. This reads them from the registry for the version you actually pinned.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag, so license, ownership, and maintenance stay with HashiCorp.

- **Upstream:** [hashicorp/terraform-mcp-server](https://github.com/hashicorp/terraform-mcp-server)
- **Pinned at:** `v1.1.0`
- **Measured 2026-07-29 (`gh api`):** 1,484 stars · last push 2026-07-28 · license MPL-2.0

## Installing it standalone

It ships as a Go binary (module path and `cmd/` entrypoint read from the repo at the pinned tag); upstream also publishes a Docker image.

```bash
go install github.com/hashicorp/terraform-mcp-server/cmd/terraform-mcp-server@v1.1.0
```

```json
{
  "mcpServers": {
    "terraform": {
      "command": "terraform-mcp-server"
    }
  }
}
```

Public-registry lookups need no credentials. HCP Terraform / Terraform Enterprise use `TFE_ADDRESS` and `TFE_TOKEN`, and there is an HTTP transport mode with its own trusted-proxy settings — all documented in **upstream's own README at the pinned ref**.

## Permissions

`network:outbound`, `secrets:read` — reaches the Terraform Registry, and optionally your HCP Terraform / TFE address; reads `TFE_TOKEN` from the environment **only** if you configure that mode. Registry-only usage reads no secrets at all.

Note the license: **MPL-2.0**, not MIT/Apache like most of this batch. Fine to run; check with whoever owns your license policy before vendoring or modifying it.

The manifest uses the flat permission vocabulary `schema_version: 1` defines; scoped forms (`network:outbound:<host>`, `secrets:read:<VAR>`) arrive with the Phase 1a permission gate, so the concrete scope is written out here rather than asserted in a field the schema cannot yet check.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — listed, not one-click-installable. The payload has not been reviewed by Marblo maintainers; see [SECURITY.md](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).
- **License:** MPL-2.0 (upstream)

Pinning freezes this at one release: upstream fixes, including security fixes, do not reach you until the pin here moves.
