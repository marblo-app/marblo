# Google Workspace MCP (referenced)

**Why this one:** the Google surface is usually nine separate servers with nine separate OAuth dances. This is one server, one OAuth client, across Gmail, Calendar, Drive, Docs, Sheets, Slides, Forms, Tasks, and Chat — and it authenticates with _your_ GCP project, so credentials never pass through a vendor.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag, so license, ownership, and maintenance stay with the upstream author.

- **Upstream:** [taylorwilsdon/google_workspace_mcp](https://github.com/taylorwilsdon/google_workspace_mcp)
- **Pinned at:** `v1.22.2` (released 2026-07-26)
- **Measured 2026-07-29 (`gh api`):** 2,933 stars · 907 forks · last push 2026-07-28 · license MIT

The most actively maintained item in this batch, and the tag is three days old at the time of listing.

## Installing it standalone

Python, published to PyPI as `workspace-mcp`, so `uvx` is the vendor-documented path:

```bash
export GOOGLE_OAUTH_CLIENT_ID="..."
export GOOGLE_OAUTH_CLIENT_SECRET="..."

uvx workspace-mcp --tool-tier core       # essential tools
uvx workspace-mcp --tool-tier complete   # everything
```

Tool tiers matter here. `complete` exposes a very large tool surface across nine Google products; `core` is the tier to start from. Public PKCE clients (no client secret), OAuth 2.1 mode, and per-service selection (`--tools gmail drive calendar`) are documented in **upstream's own README at the pinned ref**.

## Installing it from the Marblo Store

Not installable. This is a `community` item: listed and disclosed, no install button. See [CONTRIBUTING.md](../../CONTRIBUTING.md) for why unreviewed items do not get to register a process that launches on your machine.

## Permissions

`network:outbound`, `secrets:read`, `filesystem:read`, `filesystem:write` — and the filesystem pair is not boilerplate. This server reads local files to attach them to mail and Drive uploads, and writes downloaded attachments plus the OAuth token store to disk. Upstream defaults local reads to a managed attachment directory and blocks `.env*`, `~/.ssh/`, and `~/.aws/` even when `ALLOWED_FILE_DIRS` is widened; that is upstream's mitigation, disclosed here, not something Marblo enforces.

Scope is the real risk. A `complete`-tier grant on your primary Google account gives an agent your mail, your calendar, and your documents in one step. Use a tool tier and an OAuth client scoped to what you actually want reachable.

The manifest uses the flat permission vocabulary `schema_version: 1` defines; scoped forms (`network:outbound:<host>`, `secrets:read:<VAR>`) arrive with the Phase 1a permission gate, so the concrete scope is written out here rather than asserted in a field the schema cannot yet check.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — external, **not** reviewed by Marblo maintainers. The pin is immutable and the license was checked; the payload was not audited.
- **License:** MIT (upstream, `LICENSE` present at the pinned ref)

Overlap is deliberate: [`google-drive-mcp`](../google-drive-mcp/) covers Drive alone, for teams that do not want a nine-product grant.

Pinning freezes this at one tag: upstream fixes, including security fixes, do not reach you until the pin here moves.
