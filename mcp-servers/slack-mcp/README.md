# Slack MCP Server (referenced)

**Why this one:** most Slack MCP servers need a workspace admin to approve a bot app before you can read a single message. This one also runs in "stealth mode" off the browser session tokens you already have, which is the difference between trying it this afternoon and filing a ticket with IT.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag, so license, ownership, and maintenance stay with the upstream author.

- **Upstream:** [korotovsky/slack-mcp-server](https://github.com/korotovsky/slack-mcp-server)
- **Pinned at:** `v1.3.0` (tag cut 2026-05-14)
- **Measured 2026-07-29 (`gh api`):** 1,759 stars · 345 forks · last push 2026-07-16 · license MIT

> **Pin note.** The default branch has moved on since `v1.3.0` — last push 2026-07-16, about two months past the tag. The tag is pinned anyway: a pin is only worth what it freezes, and `v1.3.0` is the newest thing upstream has actually called a release. Fixes landed after it do not reach you until this pin moves.

## Installing it standalone

Written in Go and shipped as a container, so this is not an `npx` install. Stdio transport, which is what an agent CLI wants:

```bash
export SLACK_MCP_XOXC_TOKEN=xoxc-...
export SLACK_MCP_XOXD_TOKEN=xoxd-...

docker run -i --rm \
  -e SLACK_MCP_XOXC_TOKEN \
  -e SLACK_MCP_XOXD_TOKEN \
  ghcr.io/korotovsky/slack-mcp-server:latest --transport stdio
```

Two token modes: browser-session tokens (`SLACK_MCP_XOXC_TOKEN` + `SLACK_MCP_XOXD_TOKEN`) for stealth mode, or OAuth tokens (`SLACK_MCP_XOXP_TOKEN`, `SLACK_MCP_XOXB_TOKEN`) if your workspace will issue them. Tool-level switches (`SLACK_MCP_ADD_MESSAGE_TOOL`, `--enabled-tools`) and GovSlack support are documented in **upstream's own docs at the pinned ref**.

## Installing it from the Marblo Store

Not installable. This is a `community` item: listed and disclosed, no install button. See [CONTRIBUTING.md](../../CONTRIBUTING.md) for why unreviewed items do not get to register a process that launches on your machine.

## Permissions

`network:outbound`, `secrets:read` — talks to Slack's API; reads Slack tokens from the environment.

Two things worth stating plainly:

- **Stealth mode uses your own session, not a bot's.** Anything the server does is attributable to you and carries your access. Read your workspace's policy before pointing an agent at it — "no admin approval required" is a convenience property, not a permission grant.
- **Slack messages are untrusted input.** Channel content lands in the model's context. Treat it as data, not instructions.

The manifest uses the flat permission vocabulary `schema_version: 1` defines; scoped forms (`network:outbound:<host>`, `secrets:read:<VAR>`) arrive with the Phase 1a permission gate, so the concrete scope is written out here rather than asserted in a field the schema cannot yet check.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — external, **not** reviewed by Marblo maintainers. The pin is immutable and the license was checked; the payload was not audited.
- **License:** MIT (upstream, `LICENSE` present at the pinned ref)

Pinning freezes this at one tag: upstream fixes, including security fixes, do not reach you until the pin here moves.
