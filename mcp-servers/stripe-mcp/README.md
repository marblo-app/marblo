# Stripe MCP (referenced)

**Why this one:** it is Stripe's own, and the permission model is Stripe's, not the server's — what the agent can do is whatever the restricted API key you create allows, revocable from the Stripe dashboard without touching this config.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins an immutable commit, so license, ownership, and maintenance stay with Stripe.

- **Upstream:** [stripe/ai](https://github.com/stripe/ai), path `tools/modelcontextprotocol` (the repo was `stripe/agent-toolkit`; GitHub redirects the old path and the API now returns `stripe/ai`)
- **Pinned at:** `150d4d4ac00b28220b1a31044d21e5970d701dee` (default-branch head, 2026-07-29)
- **Measured 2026-07-29 (`gh api`):** 1,711 stars · last push 2026-07-29 · license MIT

> **Pin note.** This monorepo publishes no git release tags at all — `repos/stripe/ai/tags` is empty. There is nothing to pin a tag to, so the 40-hex commit SHA is pinned instead: immutable, and current as of the survey. `package.json` at the pinned path reads `@stripe/mcp@0.3.3`, which is the version the manifest tracks and the version the snippet below installs.

## Installing it standalone

Any MCP client works — this is a plain stdio MCP server, nothing Marblo-specific:

```json
{
  "mcpServers": {
    "stripe": {
      "command": "npx",
      "args": ["-y", "@stripe/mcp@0.3.3", "--api-key=STRIPE_SECRET_KEY"]
    }
  }
}
```

Replace `STRIPE_SECRET_KEY` with the actual restricted key, or drop the flag and set `STRIPE_SECRET_KEY` in the environment the CLI starts in — upstream supports both. `--stripe-account=<acct_id>` targets a connected account.

Stripe also runs a hosted remote server at `https://mcp.stripe.com`, documented at [docs.stripe.com/mcp](https://docs.stripe.com/mcp); this listing covers the local stdio one, which is the form this registry can pin.

## No one-click install from the Store

This item carries no `install` block, and that is the schema working rather than an omission: registering an MCP server means a process launches on your machine at the next CLI start, and [`registry/manifest.schema.json`](../../registry/manifest.schema.json) allows that only for `official` and `verified` publishers. `community` items are listed and disclosed — you copy the JSON above yourself.

## Permissions

`network:outbound`, `secrets:read` — calls the Stripe API; reads your secret key from the environment (or from the `--api-key` argument, which puts the key in your MCP client's config file — the environment variable is the better habit).

This one moves money. Create a **restricted API key** with only the resources the agent needs, use a test-mode key while you are evaluating it, and remember that tool permissions come from the key, not from anything in this manifest.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — external, listed, **not reviewed by Marblo maintainers**. `community` here is about Marblo's review process, not about Stripe: the code is first-party Stripe, but nobody on this side audited it. What was checked: the repo exists, the pin resolves, the license is MIT, and the activity numbers are `gh api` readings on 2026-07-29.
- **License:** MIT (upstream)

Pinning freezes this at one commit: upstream fixes, including security fixes, do not reach you until the pin here moves. Because upstream is not tagging, there is no release feed to watch — this pin needs a deliberate re-check.
