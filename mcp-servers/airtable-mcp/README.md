# Airtable MCP (referenced)

**Why this one:** it hands the agent the schema first. `list_bases` → `list_tables` → `describe_table` means the model learns your field names and types before it writes a record, instead of guessing them from a table name.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag, so license, ownership, and maintenance stay with the upstream author.

- **Upstream:** [domdomegg/airtable-mcp-server](https://github.com/domdomegg/airtable-mcp-server)
- **Pinned at:** `v1.14.0` (released 2026-07-27)
- **Measured 2026-07-29 (`gh api`):** 455 stars · 135 forks · last push 2026-07-27 · license MIT

## Installing it standalone

Node, published to npm as `airtable-mcp-server`:

```json
{
  "mcpServers": {
    "airtable": {
      "command": "npx",
      "args": ["-y", "airtable-mcp-server"],
      "env": { "AIRTABLE_API_KEY": "pat123.abc123" }
    }
  }
}
```

The token is an Airtable personal access token. **Scope it deliberately** — `schema.bases:read` and `data.records:read` are enough for a read-only agent; add the `:write` scopes only if you want the agent changing records. An HTTP transport mode (`MCP_TRANSPORT=http PORT=3000`) is documented in **upstream's own README at the pinned ref**.

## Installing it from the Marblo Store

Not installable. This is a `community` item: listed and disclosed, no install button. See [CONTRIBUTING.md](../../CONTRIBUTING.md) for why unreviewed items do not get to register a process that launches on your machine.

## Permissions

`network:outbound`, `secrets:read` — calls the Airtable API; reads `AIRTABLE_API_KEY` from the environment.

The permission disclosure cannot express "read-only", but your Airtable token can. The scopes you attach to the token are the real boundary here, and they are enforced by Airtable rather than by Marblo.

The manifest uses the flat permission vocabulary `schema_version: 1` defines; scoped forms (`network:outbound:<host>`, `secrets:read:<VAR>`) arrive with the Phase 1a permission gate, so the concrete scope is written out here rather than asserted in a field the schema cannot yet check.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — external, **not** reviewed by Marblo maintainers. The pin is immutable and the license was checked; the payload was not audited.
- **License:** MIT (upstream, `LICENSE` present at the pinned ref)

Pinning freezes this at one tag: upstream fixes, including security fixes, do not reach you until the pin here moves.
