# Playwright MCP (referenced)

**Why this one:** browser automation that hands the agent the accessibility tree instead of pixels — deterministic selectors, no vision model in the loop, and it is maintained by the Playwright team itself.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag, so license, ownership, and maintenance stay with Microsoft.

- **Upstream:** [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp)
- **Pinned at:** `v0.0.78`
- **Measured 2026-07-29 (`gh api`):** 35,589 stars · last push 2026-07-25 · license Apache-2.0

## Installing it standalone

Any MCP client works — this is a plain stdio MCP server, nothing Marblo-specific:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@0.0.78"]
    }
  }
}
```

Package name and version read from `package.json` at the pinned tag. Browser channel, headless mode, profile isolation, and the `PLAYWRIGHT_MCP_*` configuration variables are documented in **upstream's own README at the pinned ref**.

## Permissions

`network:outbound`, `filesystem:read`, `filesystem:write`, `shell:exec` — this one is broad, and honestly so: it launches a browser process, that browser reaches whatever host you navigate it to, and it reads and writes a user-data directory plus trace/screenshot output. It needs no API key.

The manifest uses the flat permission vocabulary `schema_version: 1` defines; scoped forms (`network:outbound:<host>`) arrive with the Phase 1a permission gate, and for this server a host allowlist would be meaningless anyway — the whole point is that you choose the target at call time.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — listed, not one-click-installable. The payload has not been reviewed by Marblo maintainers; see [SECURITY.md](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).
- **License:** Apache-2.0 (upstream)

Pinning freezes this at one release: upstream fixes, including security fixes, do not reach you until the pin here moves. Note that upstream is pre-1.0 and moves fast — expect this pin to age quickly.
