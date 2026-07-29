# Grafana MCP (referenced)

**Why this one:** it closes the loop between "the agent is debugging" and "the metrics that would answer this are in Grafana" — dashboards, Prometheus/Loki queries, incidents, and alert rules, from Grafana Labs directly.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag, so license, ownership, and maintenance stay with Grafana Labs.

- **Upstream:** [grafana/mcp-grafana](https://github.com/grafana/mcp-grafana)
- **Pinned at:** `v1.0.0`
- **Measured 2026-07-29 (`gh api`):** 3,297 stars · last push 2026-07-28 · license Apache-2.0

## Installing it standalone

It ships as a Go binary (module path and `cmd/` entrypoint read from the repo at the pinned tag); upstream also publishes a Docker image.

```bash
go install github.com/grafana/mcp-grafana/cmd/mcp-grafana@v1.0.0
```

```json
{
  "mcpServers": {
    "grafana": {
      "command": "mcp-grafana",
      "env": {
        "GRAFANA_URL": "https://grafana.example.com",
        "GRAFANA_SERVICE_ACCOUNT_TOKEN": "..."
      }
    }
  }
}
```

Tool categories can be enabled and disabled individually, and there is a transport/TLS surface worth reading before you expose it — both are in **upstream's own README at the pinned ref**.

## Permissions

`network:outbound`, `secrets:read` — connects to your Grafana instance (`GRAFANA_URL`) and reads `GRAFANA_SERVICE_ACCOUNT_TOKEN` from the environment.

Give the service account read-only roles unless you specifically want the agent creating or silencing alerts. The token's scope is the real control here.

The manifest uses the flat permission vocabulary `schema_version: 1` defines; scoped forms (`network:outbound:<host>`, `secrets:read:<VAR>`) arrive with the Phase 1a permission gate, so the concrete scope is written out here rather than asserted in a field the schema cannot yet check.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — listed, not one-click-installable. The payload has not been reviewed by Marblo maintainers; see [SECURITY.md](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).
- **License:** Apache-2.0 (upstream)

Pinning freezes this at one release: upstream fixes, including security fixes, do not reach you until the pin here moves.
