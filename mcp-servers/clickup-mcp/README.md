# ClickUp MCP (referenced)

**Why this one:** it ships a read-only mode. `CLICKUP_MCP_MODE=read` means you can point an agent at a live workspace to answer questions about it without giving it the ability to reorganise anyone's sprint.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag, so license, ownership, and maintenance stay with the upstream author.

- **Upstream:** [hauptsacheNet/clickup-mcp](https://github.com/hauptsacheNet/clickup-mcp)
- **Pinned at:** `v1.6.2` (released 2026-04-17)
- **Measured 2026-07-29 (`gh api`):** 45 stars · 20 forks · last push 2026-05-12 · license MIT

> **Why not the popular one — read this.** The most-starred ClickUp MCP server (`taazkareem/clickup-mcp-server`, 49 stars, pushed 2026-07-29) is **not open source**. Its `LICENSE` reads _"All Rights Reserved… Unauthorized copying, modification, distribution, or use is strictly prohibited"_ and points at a paid checkout. GitHub renders that as license "Other", which is easy to skim past. It was excluded on that basis, and this MIT-licensed server was listed instead even though it is smaller.
>
> **Version note.** `package.json` at `v1.6.2` still reads `1.6.1` — upstream tagged without bumping. The manifest `version` tracks the pinned ref, which is what installs.

45 stars is the smallest item in this batch. It is here because it is the strongest _licensable_ option in its category, not because it is popular.

## Installing it standalone

Node, published to npm as `@hauptsache.net/clickup-mcp`:

```json
{
  "mcpServers": {
    "clickup": {
      "command": "npx",
      "args": ["-y", "@hauptsache.net/clickup-mcp@1.6.1"],
      "env": {
        "CLICKUP_API_KEY": "your_api_key",
        "CLICKUP_TEAM_ID": "your_team_id",
        "CLICKUP_MCP_MODE": "read"
      }
    }
  }
}
```

Upstream's own snippet uses `@latest`; the exact version is pinned above instead, matching the source pin. `CLICKUP_MCP_MODE` and `CLICKUP_PRIMARY_LANGUAGE` are documented in **upstream's own README at the pinned ref**.

## Installing it from the Marblo Store

Not installable. This is a `community` item: listed and disclosed, no install button. See [CONTRIBUTING.md](../../CONTRIBUTING.md) for why unreviewed items do not get to register a process that launches on your machine.

## Permissions

`network:outbound`, `secrets:read` — calls the ClickUp API; reads `CLICKUP_API_KEY` from the environment.

`CLICKUP_MCP_MODE=read` is upstream's own switch, disclosed here because it is the most useful thing to know about this server. It is enforced by the server, not by Marblo — the permission fields above cannot express it, and a manifest cannot make it true.

The manifest uses the flat permission vocabulary `schema_version: 1` defines; scoped forms (`network:outbound:<host>`, `secrets:read:<VAR>`) arrive with the Phase 1a permission gate, so the concrete scope is written out here rather than asserted in a field the schema cannot yet check.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — external, **not** reviewed by Marblo maintainers. The pin is immutable and the license was checked; the payload was not audited.
- **License:** MIT (upstream, `LICENSE` present at the pinned ref)

Pinning freezes this at one tag: upstream fixes, including security fixes, do not reach you until the pin here moves.
