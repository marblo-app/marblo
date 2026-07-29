# Sequential Thinking MCP (referenced)

**Why this one:** it is the rare MCP server that reaches nothing. No network, no filesystem, no credentials — it gives the model a structured place to put a plan, revise a step it got wrong, and branch an alternative, which is exactly the part of a long task that degrades when the plan lives in loose prose.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag, so license, ownership, and maintenance stay with the Model Context Protocol project.

- **Upstream:** [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers), path `src/sequentialthinking`
- **Pinned at:** `2026.7.4` (commit `6dd0a683e198783e30feabf7abaf42f925bd18b1`, 2026-07-04)
- **Measured 2026-07-29 (`gh api`):** 89,018 stars · last push 2026-07-26 · license: see the note below

> **Version note — read this one.** Three version numbers disagree upstream and only one of them is the thing you install. `package.json` in the server directory still reads `0.6.2`; npm publishes calendar versions and its `latest` is `2026.7.4`; the newest git tag is `2026.7.10`, which was **not** published to npm. The pin is `2026.7.4` — the tag whose tree is the package people actually run — and the manifest `version` tracks that pin rather than the stale in-repo `package.json`.

> **License note.** The repo LICENSE records a transition in progress: new code and specification contributions are Apache-2.0, while contributions from authors who have not consented to relicensing remain MIT. `package.json` says only `SEE LICENSE IN LICENSE`. The manifest therefore records `MIT AND Apache-2.0`, which is what the file actually describes — not a single-identifier guess.

Star count is the whole `modelcontextprotocol/servers` monorepo, not this server alone; there is no per-directory star metric to read.

## Installing it standalone

Any MCP client works — this is a plain stdio MCP server, nothing Marblo-specific:

```json
{
  "mcpServers": {
    "sequential-thinking": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-sequential-thinking@2026.7.4"
      ]
    }
  }
}
```

Upstream's README shows the package unversioned; the pin above is deliberate. On Windows, launch it through `cmd /c npx …` as upstream documents. `DISABLE_THOUGHT_LOGGING=true` silences the stderr trace if you do not want thoughts in your CLI log.

## No one-click install from the Store

This item carries no `install` block, and that is the schema working rather than an omission: registering an MCP server means a process launches on your machine at the next CLI start, and [`registry/manifest.schema.json`](../../registry/manifest.schema.json) allows that only for `official` and `verified` publishers. `community` items are listed and disclosed — you copy the JSON above yourself.

## Permissions

**None** — the manifest declares `permissions: []`, and that is a claim with content: the server holds thought state in memory for the life of the process and writes only to stderr. No outbound calls, no files, no credential names. In this registry an empty list is a real declaration; an omitted list would say nothing at all.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — external, listed, **not reviewed by Marblo maintainers**. What was checked: the repo and path exist, the pin resolves, the LICENSE text says what is quoted above, and the activity numbers are `gh api` readings on 2026-07-29.
- **License:** `MIT AND Apache-2.0` (upstream, relicensing in progress)

Pinning freezes this at one tag. The upstream repo is highly active but this particular server changes rarely, so a stale pin here costs little — re-check it when the npm `latest` moves.
