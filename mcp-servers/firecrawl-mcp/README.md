# Firecrawl MCP (referenced)

**Why this one:** most "read this URL" tools return the raw HTML of a JavaScript app; this one renders the page and gives the agent markdown, with crawl and batch modes for when one page is not the job.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag, so license, ownership, and maintenance stay with Firecrawl.

- **Upstream:** [firecrawl/firecrawl-mcp-server](https://github.com/firecrawl/firecrawl-mcp-server) (formerly `mendableai/firecrawl-mcp-server`; GitHub redirects the old path)
- **Pinned at:** `2175de2dfd7e5073e9e743ec31a5e2515fa82df8` (2026-07-27)
- **Measured 2026-07-29 (`gh api`):** 7,073 stars · last push 2026-07-28 · license MIT

> **Pin note — read this one.** Upstream's newest git tag is `v3.2.1`, cut 2025-09-26, but `package.json` at the pinned commit reads `3.22.4`. They kept shipping to npm and stopped tagging. Pinning the tag would have frozen this listing roughly ten months behind the code people actually install, so the commit SHA is pinned instead — immutable, and current as of the survey. The manifest `version` tracks the package version at that commit, not a release tag.

## Installing it standalone

Any MCP client works — this is a plain stdio MCP server, nothing Marblo-specific:

```json
{
  "mcpServers": {
    "firecrawl": {
      "command": "npx",
      "args": ["-y", "firecrawl-mcp@3.22.4"],
      "env": { "FIRECRAWL_API_KEY": "..." }
    }
  }
}
```

Package name and version read from `package.json` at the pinned commit. Self-hosting, retry tuning (`FIRECRAWL_RETRY_*`), and credit-warning thresholds are documented in **upstream's own README at the pinned ref**.

## Permissions

`network:outbound`, `secrets:read` — calls the Firecrawl API (or your self-hosted instance), which in turn fetches whatever URLs the agent asks for; reads `FIRECRAWL_API_KEY` from the environment.

Worth stating plainly: pages fetched this way are untrusted input that lands in the model's context. Treat scraped content as data, not instructions.

The manifest uses the flat permission vocabulary `schema_version: 1` defines; scoped forms (`network:outbound:<host>`, `secrets:read:<VAR>`) arrive with the Phase 1a permission gate, so the concrete scope is written out here rather than asserted in a field the schema cannot yet check.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — listed, not one-click-installable. The payload has not been reviewed by Marblo maintainers; see [SECURITY.md](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).
- **License:** MIT (upstream)

Pinning freezes this at one commit: upstream fixes, including security fixes, do not reach you until the pin here moves. Because upstream is not tagging, there is no release feed to watch — this pin needs a deliberate re-check.
