# Google Cloud Run MCP (referenced)

**Why this one:** it is the shortest path from "the agent wrote a service" to "the service is running on a URL" — deploy the working folder, list what is deployed, read the logs when it fails, without leaving the session.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag, so license, ownership, and maintenance stay with Google Cloud.

- **Upstream:** [GoogleCloudPlatform/cloud-run-mcp](https://github.com/GoogleCloudPlatform/cloud-run-mcp)
- **Pinned at:** `v1.10.0` (resolves to commit `6ce7cbb4100032a53ef4d92701b4e8b58a844729`)
- **Measured 2026-07-29 (`gh api`):** 622 stars · last push 2026-07-27 · license Apache-2.0

> **Scope note — read this one.** Google publishes no single "GCP MCP server". This is the Cloud Run one: deployment and service inspection, not IAM, BigQuery, or GCS. For databases, `googleapis/mcp-toolbox` is already listed here as [`mcp-toolbox-databases`](../mcp-toolbox-databases/). The most-starred third-party repo actually named `gcp-mcp` was last pushed in May 2025 and is not affiliated with Google, so it is not listed.

## Installing it standalone

```json
{
  "mcpServers": {
    "cloud-run": {
      "command": "npx",
      "args": ["-y", "@google-cloud/cloud-run-mcp"]
    }
  }
}
```

Authenticate first with `gcloud auth application-default login`. Pinning the project and region (`GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_REGION`), the remote/SSE mode, and the Docker alternative are in **upstream's own README at the pinned ref**.

## Permissions

`network:outbound`, `secrets:read`, `filesystem:read` — calls Google Cloud APIs; reads Application Default Credentials (or `GOOGLE_APPLICATION_CREDENTIALS`); reads the local source folder it is asked to deploy.

The real control is the IAM role on the credential, not this list. Deploying a service means creating billable infrastructure and, unless you say otherwise, a publicly reachable URL — grant the narrowest project and role you can live with.

The manifest uses the flat permission vocabulary `schema_version: 1` defines; scoped forms (`network:outbound:<host>`, `secrets:read:<VAR>`) arrive with the Phase 1a permission gate, so the concrete scope is written out here rather than asserted in a field the schema cannot yet check.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — listed, not one-click-installable. The payload has not been reviewed by Marblo maintainers; see [SECURITY.md](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).
- **License:** Apache-2.0 (upstream)

Pinning freezes this at one release: upstream fixes, including security fixes, do not reach you until the pin here moves. Note that `v1.10.0` was cut 2026-03-04 while the repo is still active — the tag lags the branch.
