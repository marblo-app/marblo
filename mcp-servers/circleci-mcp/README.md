# CircleCI MCP Server (referenced)

**Why this one:** "CI is red" is a question an agent can only answer by reading the build log, and this is CircleCI's own server for exactly that — fetch the latest failed pipeline's output, list flaky tests, validate a config file — instead of asking you to paste the log in.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins an immutable commit, so license, ownership, and maintenance stay with CircleCI.

- **Upstream:** [CircleCI-Public/mcp-server-circleci](https://github.com/CircleCI-Public/mcp-server-circleci)
- **Pinned at:** `8787136b6c8bf72752ebcffad1520c2a847b5276` (default-branch head, commit date 2026-07-19)
- **Measured 2026-07-29 (`gh api`):** 86 stars · last push 2026-07-28 · license Apache-2.0

Two readings that look contradictory are both true: `pushed_at` is 2026-07-28 because that counts pushes to any branch, while the **default branch** head commit is dated 2026-07-19. The pin is the default-branch head, which is the tree the published package comes from.

> **Pin note.** The repo publishes no git tags and no GitHub releases — `repos/…/tags` and `releases/latest` both come back empty (the latter as a 404). There is no tag to pin, so the 40-hex commit SHA is pinned instead. `package.json` at that commit reads `@circleci/mcp-server-circleci@0.19.0`, matching npm's current `latest`.

> **License note.** GitHub's classifier reports `NOASSERTION` for this repo, which usually reads as "no license". It is not: the `LICENSE` file is the verbatim Apache License 2.0 grant, copyright Circle Internet Services, Inc. The file was read rather than trusting the classifier, and the manifest records `Apache-2.0`.

Star count is low (86) next to the rest of this collection. It is listed on vendor-official grounds, not popularity.

## Installing it standalone

Any MCP client works — this is a plain stdio MCP server, nothing Marblo-specific:

```json
{
  "mcpServers": {
    "circleci-mcp-server": {
      "command": "npx",
      "args": ["-y", "@circleci/mcp-server-circleci@0.19.0"],
      "env": {
        "CIRCLECI_TOKEN": "..."
      }
    }
  }
}
```

Upstream's README documents the package as `@latest`; the pin above is deliberate — a dist-tag is not a pin. `CIRCLECI_BASE_URL` is optional and only needed for on-prem installations; `MAX_MCP_OUTPUT_LENGTH` caps response size (upstream default 50000). Both are documented in upstream's README at the pinned ref.

## No one-click install from the Store

This item carries no `install` block, and that is the schema working rather than an omission: registering an MCP server means a process launches on your machine at the next CLI start, and [`registry/manifest.schema.json`](../../registry/manifest.schema.json) allows that only for `official` and `verified` publishers. `community` items are listed and disclosed — you copy the JSON above yourself.

## Permissions

`network:outbound`, `secrets:read` — calls the CircleCI API; reads `CIRCLECI_TOKEN` from the environment. A CircleCI personal token carries your account's access, so scope it to what you want an agent reading.

Build logs are untrusted input landing in the model's context — a failing test can print anything, including text shaped like an instruction. Treat log output as data.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — external, listed, **not reviewed by Marblo maintainers**. The code is first-party CircleCI; `community` describes Marblo's review process, not the publisher. What was checked: the repo exists, the pin resolves, the LICENSE text is Apache-2.0, and the activity numbers are `gh api` readings on 2026-07-29.
- **License:** Apache-2.0 (upstream)

Pinning freezes this at one commit: upstream fixes, including security fixes, do not reach you until the pin here moves. Because upstream neither tags nor cuts releases, there is no feed to watch — this pin needs a deliberate re-check.
