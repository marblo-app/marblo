# Exa MCP (referenced)

**Why this one:** search results shaped for a model — full page contents with the query understood semantically — so the agent does not spend a second round trip fetching every link it just found.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins an immutable commit, so license, ownership, and maintenance stay with Exa Labs.

- **Upstream:** [exa-labs/exa-mcp-server](https://github.com/exa-labs/exa-mcp-server)
- **Pinned at:** `b4076055af28698d944b50deade80e541b7788ea` — **upstream publishes no GitHub releases and no tags**, so there is no version tag to pin. This is the default branch's head commit as of 2026-07-24. A branch name would be rejected by the schema, and should be: it is not a pin.
- **Measured 2026-07-29 (`gh api`):** 4,792 stars · last push 2026-07-24 · license MIT

## Installing it standalone

Any MCP client works — this is a plain stdio MCP server, nothing Marblo-specific:

```json
{
  "mcpServers": {
    "exa": {
      "command": "npx",
      "args": ["-y", "exa-mcp-server@3.2.1"],
      "env": { "EXA_API_KEY": "..." }
    }
  }
}
```

The `3.2.1` here is the version declared in `package.json` **at the pinned commit** — because upstream tags nothing, the npm version and this commit are correlated by that file, not by a release. Upstream also documents a hosted remote endpoint; for that, and for the tool-selection flags, follow **upstream's own README at the pinned ref**.

## Permissions

`network:outbound`, `secrets:read` — calls the Exa API, and reads `EXA_API_KEY` from the environment.

As with any web-fetching server: retrieved page content is untrusted input arriving in the model's context. Treat it as data, not instructions.

The manifest uses the flat permission vocabulary `schema_version: 1` defines; scoped forms (`network:outbound:<host>`, `secrets:read:<VAR>`) arrive with the Phase 1a permission gate, so the concrete scope is written out here rather than asserted in a field the schema cannot yet check.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — listed, not one-click-installable. The payload has not been reviewed by Marblo maintainers; see [SECURITY.md](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).
- **License:** MIT (upstream)

Pinning freezes this at one commit: upstream fixes, including security fixes, do not reach you until the pin here moves. With no upstream release cadence to follow, this pin needs a deliberate re-check rather than a "watch for a new tag" habit.
