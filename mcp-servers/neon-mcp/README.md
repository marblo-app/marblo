# Neon MCP (referenced)

**Why this one:** database branching makes migrations reviewable. The agent branches the database, applies the change there, you look at it, and only then does it touch main — the same shape as a pull request, applied to schema.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins an immutable commit, so license, ownership, and maintenance stay with Neon.

- **Upstream:** [neondatabase/mcp-server-neon](https://github.com/neondatabase/mcp-server-neon) (the `neondatabase-labs` path redirects here)
- **Pinned at:** `5de25551d31ddb481a53f48834d0df8059c8de0e` (2026-07-29)
- **Measured 2026-07-29 (`gh api`):** 619 stars · last push 2026-07-29 · license MIT

> **Pin note — read this one.** The only tag upstream carries is `v0.2.0`, and `package.json` at the pinned commit reads `1.0.0`. They stopped tagging and kept shipping, so pinning the tag would freeze this listing several major versions behind the code the hosted server actually runs. The commit SHA is pinned instead — immutable, and current as of the survey. The manifest `version` tracks the package version at that commit, not a release tag.

## Installing it standalone

Neon runs this as a hosted remote server; the repo is its source. A client that supports remote MCP takes the URL:

```json
{
  "mcpServers": {
    "neon": { "url": "https://mcp.neon.tech/mcp" }
  }
}
```

That flow authorizes via OAuth in the browser. For headless or CI use, upstream documents an API-key header form instead — along with the SSE endpoint for clients that do not yet speak Streamable HTTP, and self-hosting from this repo — in **upstream's own README at the pinned ref**.

## Permissions

`network:outbound`, `secrets:read` — talks to `mcp.neon.tech` and the Neon API; the OAuth grant or `NEON_API_KEY` is what it authenticates with.

Worth stating plainly: a Neon API key is account-scoped. The agent can create and delete projects, not just query one — branch-and-review is the workflow that makes that safe, so use it rather than pointing this at production directly.

The manifest uses the flat permission vocabulary `schema_version: 1` defines; scoped forms (`network:outbound:<host>`, `secrets:read:<VAR>`) arrive with the Phase 1a permission gate, so the concrete scope is written out here rather than asserted in a field the schema cannot yet check.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — listed, not one-click-installable. The payload has not been reviewed by Marblo maintainers; see [SECURITY.md](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).
- **License:** MIT (upstream)

Pinning freezes the _source_ at one commit. Because the default deployment is hosted, Neon updates the running server independently — the pin here documents what was surveyed, it does not freeze what you connect to. Self-hosting from the pinned ref is what makes the pin binding.
