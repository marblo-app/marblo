# MCP Toolbox for Databases (referenced)

**Why this one:** the queries live in a tools file you write, not in the model's output — so "let the agent touch the database" becomes a reviewable allowlist instead of arbitrary SQL from a language model.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag, so license, ownership, and maintenance stay with Google.

- **Upstream:** [googleapis/mcp-toolbox](https://github.com/googleapis/mcp-toolbox) (formerly `googleapis/genai-toolbox`; GitHub redirects the old path)
- **Pinned at:** `v1.8.0`
- **Measured 2026-07-29 (`gh api`):** 16,047 stars · last push 2026-07-29 · license Apache-2.0

## Installing it standalone

It ships as a Go binary (module path read from `go.mod` at the pinned tag), and upstream also publishes npm and PyPI wrappers:

```bash
go install github.com/googleapis/mcp-toolbox@v1.8.0
```

Then register the resulting binary with your MCP client. The tools-file format and the connection flags are the part that matters here, and they change between releases — take them from **upstream's own README and docs at the pinned ref**.

## Permissions

`network:outbound`, `filesystem:read`, `secrets:read` — it connects to whichever database servers your tools file names, reads that tools file from disk, and reads database credentials from the environment. Which credentials depends entirely on the sources you configure.

The manifest uses the flat permission vocabulary `schema_version: 1` defines; scoped forms (`network:outbound:<host>`, `secrets:read:<VAR>`) arrive with the Phase 1a permission gate, so the concrete scope is written out here rather than asserted in a field the schema cannot yet check.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — listed, not one-click-installable. The payload has not been reviewed by Marblo maintainers; see [SECURITY.md](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).
- **License:** Apache-2.0 (upstream)

Pinning freezes this at one release: upstream fixes, including security fixes, do not reach you until the pin here moves.
