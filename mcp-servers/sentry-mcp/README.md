# Sentry MCP (referenced)

**Why this one:** the stack trace the agent needs is in Sentry, not in the terminal. This is Sentry's own server for reaching it — issues, events, full traces, search across releases — so debugging a production error stops depending on someone pasting an excerpt.

**Read the two caveats below before installing this one.** They are the reason it is the most conditional entry in this collection.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag, so license, ownership, and maintenance stay with Sentry.

- **Upstream:** [getsentry/sentry-mcp](https://github.com/getsentry/sentry-mcp)
- **Pinned at:** `0.37.0` (commit `d79490aee755875aef74a9e2647858fde3fd8587`, released 2026-07-02)
- **Measured 2026-07-29 (`gh api`):** 798 stars · last push 2026-07-28 · license FSL-1.1-ALv2 (see below)

## Caveat 1 — the license is not open source

GitHub reports `NOASSERTION`, which usually means "no license file". Here it means the opposite: `LICENSE.md` is a full, deliberate license — the **Functional Source License, Version 1.1, Apache 2.0 Future License** (`FSL-1.1-ALv2`, the identifier npm also carries). The file was read rather than trusting the classifier.

What that means in practice, from the license text itself: you may use, copy, modify, and redistribute the software for **any permitted purpose**, which excludes competing with Sentry's own products; and each version converts to Apache-2.0 two years after its release date. It is source-available, not OSI open source.

Every other referenced item in this registry carries an OSI license (MIT, Apache-2.0). This one does not, and that difference is recorded here rather than smoothed over. Ordinary use — pointing an agent at your own Sentry org — is squarely within the grant. If your organization has a policy against non-OSI dependencies, this is the entry that policy applies to.

## Caveat 2 — some tools want an LLM provider key

Upstream's AI-powered search tools ask for `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENROUTER_API_KEY` in the server's environment, selected by `EMBEDDED_AGENT_PROVIDER`.

Those exact names are on this registry's [install-contract denylist](../../packages/registry-validator/bin/validate-registry.js) — a third-party server never receives the harness's own model credentials through a Marblo install. This item has no install contract at all (see below), so nothing here can hand them over. If you configure those keys yourself, you are giving a third-party process a model credential that bills you; consider a separate key with its own budget, or skip the AI search tools and use the rest of the server, which works without them.

## Installing it standalone

Any MCP client works — this is a plain stdio MCP server, nothing Marblo-specific:

```json
{
  "mcpServers": {
    "sentry": {
      "command": "npx",
      "args": ["-y", "@sentry/mcp-server@0.37.0"],
      "env": {
        "SENTRY_ACCESS_TOKEN": "..."
      }
    }
  }
}
```

Upstream's README documents `@latest` and an `--access-token=` flag; the pin above is deliberate, and the environment variable keeps the token out of your MCP config file. Self-hosted Sentry: add `SENTRY_HOST` (or `--host=sentry.example.com`), plus `--insecure-http` for internal deployments without TLS. `--disable-skills=seer` turns off features a self-hosted instance may not have.

## No one-click install from the Store

This item carries no `install` block, and that is the schema working rather than an omission: registering an MCP server means a process launches on your machine at the next CLI start, and [`registry/manifest.schema.json`](../../registry/manifest.schema.json) allows that only for `official` and `verified` publishers. `community` items are listed and disclosed — you copy the JSON above yourself.

## Permissions

`network:outbound`, `secrets:read` — calls the Sentry API (SaaS or your self-hosted host); reads `SENTRY_ACCESS_TOKEN` from the environment, and any LLM provider key you set per Caveat 2.

Error messages, breadcrumbs, and event payloads are untrusted input landing in the model's context, and they routinely contain user-supplied strings. Treat them as data, not instructions.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — external, listed, **not reviewed by Marblo maintainers**. The code is first-party Sentry; `community` describes Marblo's review process, not the publisher. What was checked: the repo exists, the pin resolves, `LICENSE.md` says what is quoted above, and the activity numbers are `gh api` readings on 2026-07-29.
- **License:** `FSL-1.1-ALv2` (upstream) — source-available, converts to Apache-2.0 two years after each release.

Pinning freezes this at one tag: upstream fixes, including security fixes, do not reach you until the pin here moves. Upstream tags releases, so there is a feed to watch.
