# Context7 (referenced)

**Why this one:** agents hallucinate APIs because their training data is old — Context7 fetches the docs for the exact library version in your project and puts them in context, which is a narrower and more checkable fix than "search the web."

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins an immutable commit, so license, ownership, and maintenance stay with Upstash.

- **Upstream:** [upstash/context7](https://github.com/upstash/context7) (subpath `packages/mcp`)
- **Pinned at:** `b250c2515694eee4b6df4db82fa056df9ed3e306` — the commit behind release `@upstash/context7-mcp@3.2.5`. The tag itself is monorepo-scoped and does not match the schema's ref pattern, so the SHA is pinned instead.
- **Measured 2026-07-29 (`gh api`):** 59,929 stars · last push 2026-07-28 · license MIT

## Installing it standalone

Any MCP client works — this is a plain stdio MCP server, nothing Marblo-specific:

```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp@3.2.5"],
      "env": { "CONTEXT7_API_KEY": "..." }
    }
  }
}
```

Package name and version read from `packages/mcp/package.json` at the pinned commit. For flags, transports, and whether the API key is optional for your usage tier, follow **upstream's own README at the pinned ref** — it is authoritative and it changes between releases.

## Permissions

`network:outbound`, `secrets:read` — talks to the Context7 documentation service, and reads `CONTEXT7_API_KEY` from the environment.

The manifest uses the flat permission vocabulary `schema_version: 1` defines; scoped forms (`network:outbound:<host>`, `secrets:read:<VAR>`) arrive with the Phase 1a permission gate, so the concrete scope is written out here rather than asserted in a field the schema cannot yet check.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — listed, not one-click-installable. The payload has not been reviewed by Marblo maintainers; see [SECURITY.md](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).
- **License:** MIT (upstream)

Pinning freezes this at one commit: upstream fixes, including security fixes, do not reach you until the pin here moves.
