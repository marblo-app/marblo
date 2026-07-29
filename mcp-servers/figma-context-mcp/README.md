# Framelink Figma MCP (referenced)

**Why this one:** it hands the agent the frame's structured layout — hierarchy, spacing, styles — rather than an image, which is the difference between implementing a design and guessing at one.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag, so license, ownership, and maintenance stay with the upstream author.

- **Upstream:** [GLips/Figma-Context-MCP](https://github.com/GLips/Figma-Context-MCP)
- **Pinned at:** `v0.13.2`
- **Measured 2026-07-29 (`gh api`):** 15,521 stars · last push 2026-07-03 · license MIT

## Installing it standalone

Any MCP client works — this is a plain stdio MCP server, nothing Marblo-specific:

```json
{
  "mcpServers": {
    "figma": {
      "command": "npx",
      "args": ["-y", "figma-developer-mcp@0.13.2", "--stdio"],
      "env": { "FIGMA_API_KEY": "..." }
    }
  }
}
```

Package name and version read from `package.json` at the pinned tag. For the current flag set and the token scopes Figma requires, follow **upstream's own README at the pinned ref**.

## Permissions

`network:outbound`, `secrets:read` — calls the Figma API, and reads `FIGMA_API_KEY` from the environment. That key can read every file your Figma account can read, so scope it deliberately.

The manifest uses the flat permission vocabulary `schema_version: 1` defines; scoped forms (`network:outbound:<host>`, `secrets:read:<VAR>`) arrive with the Phase 1a permission gate, so the concrete scope is written out here rather than asserted in a field the schema cannot yet check.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — listed, not one-click-installable. The payload has not been reviewed by Marblo maintainers; see [SECURITY.md](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).
- **License:** MIT (upstream)

Pinning freezes this at one release: upstream fixes, including security fixes, do not reach you until the pin here moves. Of the twelve servers listed in this batch, this one had the oldest last-push at survey time (2026-07-03) — still current, but worth a re-check before promotion.
