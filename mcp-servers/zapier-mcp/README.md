# Zapier MCP (referenced)

**Why this one:** it is the escape hatch for every SaaS tool that has no MCP server of its own. Zapier already speaks to thousands of apps; this connects the agent to that fan-out through one OAuth grant instead of one server per product.

## Referenced, not vendored — and read this before trusting the pin

**No code from this server lives in this repo.** But the more important caveat is upstream's own shape:

**The Zapier MCP server is hosted.** It runs at `https://mcp.zapier.com/api/v1/connect`, operated by Zapier, and its source is not public. There is nothing to pin and nothing to review — what the server does can change tomorrow without any ref moving.

What [`marblo.yaml`](marblo.yaml) pins is Zapier's **official client-side plugin distribution**: the skills, agents, rules, and `gemini-extension.json` that point your CLI at that endpoint. That part is public, MIT, and pinnable.

- **Upstream:** [zapier/zapier-mcp](https://github.com/zapier/zapier-mcp) (Zapier's own org)
- **Pinned at:** `e672a7bd0d4ef125f4b81fde1c4369a95348ba46` (2026-07-28)
- **Measured 2026-07-29 (`gh api`):** 366 stars · 51 forks · last push 2026-07-28 · license MIT

> **Pin note.** Upstream cuts no git tags, so the default branch head commit is pinned (a moving branch name would be rejected by the schema, correctly). The manifest `version` is `1.0.0`, read from `gemini-extension.json` at the pinned commit, not a release tag.

## Installing it standalone

Gemini CLI installs from the repo directly:

```bash
gemini extensions install https://github.com/zapier/zapier-mcp
# then, inside Gemini:  /mcp auth zapier
```

Any MCP client can point at the hosted endpoint itself — it is a remote server over OAuth, so there is no package to run and no API key to place:

```json
{
  "mcpServers": {
    "zapier": {
      "httpUrl": "https://mcp.zapier.com/api/v1/connect",
      "oauth": { "enabled": true }
    }
  }
}
```

Endpoint and OAuth flag read from `gemini-extension.json` at the pinned commit. Client-specific setup is in **upstream's own README at the pinned ref** and at [docs.zapier.com/mcp/clients](https://docs.zapier.com/mcp/clients).

## Installing it from the Marblo Store

Not installable. This is a `community` item: listed and disclosed, no install button. See [CONTRIBUTING.md](../../CONTRIBUTING.md) for why unreviewed items do not get to register a process that launches on your machine.

## Permissions

`network:outbound`, `secrets:read` — OAuth against the hosted endpoint. No API-key environment variable is required, but the negotiated credential is still read from your client's token store.

The disclosure that matters most is not in the permission list:

- **Your data leaves your machine.** Unlike every other item in this batch, the server is not a local process talking to a vendor API on your behalf; it is Zapier's infrastructure sitting between the agent and every app you connect. Requests and responses transit Zapier.
- **The reachable surface is whatever you connect.** One OAuth grant plus a few Zapier connections can mean mail, CRM, and billing in a single tool namespace. Connect deliberately.

The manifest uses the flat permission vocabulary `schema_version: 1` defines; scoped forms (`network:outbound:<host>`, `secrets:read:<VAR>`) arrive with the Phase 1a permission gate, so the concrete scope is written out here rather than asserted in a field the schema cannot yet check.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — external, **not** reviewed by Marblo maintainers. The pin is immutable and the license was checked; the payload was not audited, and the hosted server behind it cannot be.
- **License:** MIT (upstream plugin repo, `LICENSE` present at the pinned ref). The hosted service is governed by Zapier's own terms, not this license.

Pinning freezes the _plugin_ at one commit. It does not freeze the server, because nobody outside Zapier can.
