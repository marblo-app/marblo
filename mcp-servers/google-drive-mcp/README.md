# Google Drive MCP (referenced)

**Why this one:** Drive without the rest of Google. [`google-workspace-mcp`](../google-workspace-mcp/) covers nine products behind one OAuth grant; sometimes you want an agent that can work with files and cannot read your mail. This server is scoped to Drive, Docs, Sheets, and Slides.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag, so license, ownership, and maintenance stay with the upstream author.

- **Upstream:** [piotr-agier/google-drive-mcp](https://github.com/piotr-agier/google-drive-mcp)
- **Pinned at:** `v2.5.0` (released 2026-07-15)
- **Measured 2026-07-29 (`gh api`):** 195 stars · 104 forks · last push 2026-07-29 · license MIT

Smaller than the Workspace server by an order of magnitude in stars, and pushed the day this listing was measured. Judge it on the narrower scope, not the star count.

## Installing it standalone

Node, published to npm as `@piotr-agier/google-drive-mcp`:

```bash
# OAuth client JSON at ~/gcp-oauth.keys.json; a browser opens on first run.
npx @piotr-agier/google-drive-mcp
```

```json
{
  "mcpServers": {
    "google-drive": {
      "command": "npx",
      "args": ["-y", "@piotr-agier/google-drive-mcp"],
      "env": {
        "GOOGLE_DRIVE_OAUTH_CREDENTIALS": "$HOME/gcp-oauth.keys.json",
        "GOOGLE_DRIVE_MCP_TOKEN_PATH": "$HOME/.config/google-drive-mcp/tokens.json"
      }
    }
  }
}
```

Desktop-type OAuth client (client ID only, no secret). Docker usage needs `npx @piotr-agier/google-drive-mcp auth` run once on the host first — containers cannot open a browser. Full setup is in **upstream's own README at the pinned ref**.

## Installing it from the Marblo Store

Not installable. This is a `community` item: listed and disclosed, no install button. See [CONTRIBUTING.md](../../CONTRIBUTING.md) for why unreviewed items do not get to register a process that launches on your machine.

## Permissions

`network:outbound`, `secrets:read`, `filesystem:read`, `filesystem:write` — it reads the OAuth client JSON off disk and writes the refreshed token cache (default `~/.config/google-drive-mcp/tokens.json`). Both paths are configurable via the env vars above.

That token file is a long-lived credential to your Drive. It lives in your home directory in plain JSON; protect it the way you would an SSH key.

The manifest uses the flat permission vocabulary `schema_version: 1` defines; scoped forms (`network:outbound:<host>`, `secrets:read:<VAR>`) arrive with the Phase 1a permission gate, so the concrete scope is written out here rather than asserted in a field the schema cannot yet check.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — external, **not** reviewed by Marblo maintainers. The pin is immutable and the license was checked; the payload was not audited.
- **License:** MIT (upstream, `LICENSE` present at the pinned ref)

Pinning freezes this at one tag: upstream fixes, including security fixes, do not reach you until the pin here moves.
