# Supabase MCP (referenced)

**Why this one:** it ships the two flags that make "agent with database access" a defensible idea rather than a scary one — `--read-only` and `--project-ref` — instead of leaving scope up to the prompt.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins an immutable commit, so license, ownership, and maintenance stay with Supabase.

- **Upstream:** [supabase/mcp](https://github.com/supabase/mcp) (subpath `packages/mcp-server-supabase`; formerly `supabase-community/supabase-mcp`, GitHub redirects the old path)
- **Pinned at:** `4690aa917f14553d8c4d5f7039ac894c3abf176a` — the commit behind release `mcp-server-supabase-v0.9.0`. The tag is monorepo-scoped and does not match the schema's ref pattern, so the SHA is pinned instead.
- **Measured 2026-07-29 (`gh api`):** 2,839 stars · last push 2026-07-27 · license Apache-2.0

## Installing it standalone

Any MCP client works — this is a plain stdio MCP server, nothing Marblo-specific:

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": [
        "-y",
        "@supabase/mcp-server-supabase@0.9.0",
        "--read-only",
        "--project-ref=<your-project-ref>"
      ],
      "env": { "SUPABASE_ACCESS_TOKEN": "..." }
    }
  }
}
```

Package name and version read from `packages/mcp-server-supabase/package.json` at the pinned commit. The personal-access-token variable name, feature-group flags, and the exact set of write tools are documented in **upstream's own README at the pinned ref** — take them from there rather than from this snippet.

## Permissions

`network:outbound`, `secrets:read` — calls the Supabase management API and your project, and reads a Supabase personal access token from the environment.

Without `--read-only` this server can modify schemas and data. Point it at a development project, not production, and keep the flag on unless you have a specific reason not to.

The manifest uses the flat permission vocabulary `schema_version: 1` defines; scoped forms (`network:outbound:<host>`, `secrets:read:<VAR>`) arrive with the Phase 1a permission gate, so the concrete scope is written out here rather than asserted in a field the schema cannot yet check.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — listed, not one-click-installable. The payload has not been reviewed by Marblo maintainers; see [SECURITY.md](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).
- **License:** Apache-2.0 (upstream)

Pinning freezes this at one commit: upstream fixes, including security fixes, do not reach you until the pin here moves.
