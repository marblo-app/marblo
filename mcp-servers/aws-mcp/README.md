# AWS MCP Servers (referenced)

**Why this one:** AWS's own answer to "the agent needs to touch AWS" — not one server but roughly sixty, split by service so you install the two you need instead of handing the model the whole account.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag, so license, ownership, and maintenance stay with AWS Labs.

- **Upstream:** [awslabs/mcp](https://github.com/awslabs/mcp)
- **Pinned at:** `2026.07.20260728181317` (resolves to commit `536db49a5a5883ab26f8210af90dfc714fee89e7`)
- **Measured 2026-07-29 (`gh api`):** 9,512 stars · last push 2026-07-29 · license Apache-2.0

> **This is a collection, not a server.** The pin covers the whole monorepo. Under `src/` at the pinned tag there are ~60 servers — `aws-api-mcp-server`, `aws-documentation-mcp-server`, `aws-pricing-mcp-server`, `cloudwatch-mcp-server`, `eks-mcp-server`, `dynamodb-mcp-server`, `postgres-mcp-server`, and so on. Each publishes to PyPI on its own. Upstream versions by release timestamp rather than SemVer, which is why the version here reads the way it does — it is the tag, verbatim.

## Installing one standalone

Each server is a `uvx` package named `awslabs.<server>`:

```json
{
  "mcpServers": {
    "awslabs.aws-documentation-mcp-server": {
      "command": "uvx",
      "args": ["awslabs.aws-documentation-mcp-server@latest"],
      "env": { "AWS_PROFILE": "your-profile", "AWS_REGION": "us-east-1" }
    }
  }
}
```

Pick the server list, per-server environment variables, and the Docker alternative from **upstream's own README at the pinned ref** — they differ per server and there are too many to restate accurately here.

## Permissions

`network:outbound`, `secrets:read`, `filesystem:read`, `filesystem:write`, `shell:exec` — this is the union across the collection's documented modes, not what any single server needs. `aws-api-mcp-server` executes AWS CLI commands; the IaC and serverless servers read and write project files; all of them resolve AWS credentials from the environment or `~/.aws`.

The control that matters is the IAM identity behind the profile you point it at. An agent with an admin role and `aws-api-mcp-server` installed can do anything you can do. Scope the role first, then install.

The manifest uses the flat permission vocabulary `schema_version: 1` defines; scoped forms (`network:outbound:<host>`, `secrets:read:<VAR>`) arrive with the Phase 1a permission gate, so the concrete scope is written out here rather than asserted in a field the schema cannot yet check.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — listed, not one-click-installable. The payload has not been reviewed by Marblo maintainers; see [SECURITY.md](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).
- **License:** Apache-2.0 (upstream)

Pinning freezes this at one release: upstream fixes, including security fixes, do not reach you until the pin here moves.
