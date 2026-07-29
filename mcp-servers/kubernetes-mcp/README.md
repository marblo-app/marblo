# Kubernetes MCP Server (referenced)

**Why this one:** it does not shell out to `kubectl`. The server speaks to the API server directly using your existing kubeconfig, so an agent can list, inspect, apply, delete, and read pod logs without a shell tool in the loop — and it covers OpenShift resources as well as vanilla Kubernetes.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag, so license, ownership, and maintenance stay with the upstream project.

- **Upstream:** [containers/kubernetes-mcp-server](https://github.com/containers/kubernetes-mcp-server)
- **Pinned at:** `v0.0.65` (commit `56d6dfe9a1b994faca27fa3310cb54e3d3bc42ed`, released 2026-07-14)
- **Measured 2026-07-29 (`gh api`):** 1,860 stars · last push 2026-07-29 · license Apache-2.0

The server is written in Go; npm `kubernetes-mcp-server@0.0.65` is the wrapper that fetches the matching binary, so the pinned tag and the npm version line up.

## Installing it standalone

Any MCP client works — this is a plain stdio MCP server, nothing Marblo-specific:

```json
{
  "mcpServers": {
    "kubernetes": {
      "command": "npx",
      "args": ["-y", "kubernetes-mcp-server@0.0.65"]
    }
  }
}
```

Upstream's README documents `kubernetes-mcp-server@latest`; the pin above is deliberate — a dist-tag is not a pin.

With no arguments the server uses your default kubeconfig and therefore your current context. Pass `--kubeconfig <path>` to point it somewhere else; read-only and toolset-narrowing flags are documented in upstream's README at the pinned ref. Point it at a non-production context first.

## No one-click install from the Store

This item carries no `install` block, and that is the schema working rather than an omission: registering an MCP server means a process launches on your machine at the next CLI start, and [`registry/manifest.schema.json`](../../registry/manifest.schema.json) allows that only for `official` and `verified` publishers. `community` items are listed and disclosed — you copy the JSON above yourself.

## Permissions

`network:outbound`, `filesystem:read`, `secrets:read` — connects to your cluster's API server; reads the kubeconfig file from disk; that file **is** a credential, which is why `secrets:read` is declared even though no `env_required` name appears here.

Worth stating plainly: this server acts with your kubeconfig's full authority. If your current context is production with cluster-admin, so is the agent — deletes included. The permission vocabulary `schema_version: 1` defines has no "mutates cluster state" term, so it is written out here instead of asserted in a field the schema cannot check.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — external, listed, **not reviewed by Marblo maintainers**. What was checked: the repo exists, the pin resolves, the license is Apache-2.0, and the activity numbers are `gh api` readings on 2026-07-29. Nothing here asserts a source audit.
- **License:** Apache-2.0 (upstream)

Pinning freezes this at one tag: upstream fixes, including security fixes, do not reach you until the pin here moves. Upstream cuts releases often, so there is a release feed to watch.
