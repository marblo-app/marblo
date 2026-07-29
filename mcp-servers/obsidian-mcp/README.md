# Obsidian MCP (referenced)

**Why this one:** it reaches your vault through Obsidian's Local REST API plugin rather than the vault directory. The agent gets search and note editing; it does not get a filesystem handle on your notes. That distinction is the whole design, and it is why this manifest declares no `filesystem:*` permission.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins an immutable commit, so license, ownership, and maintenance stay with the upstream author.

- **Upstream:** [MarkusPfundstein/mcp-obsidian](https://github.com/MarkusPfundstein/mcp-obsidian)
- **Pinned at:** `32285e9ac07049a8a23ea7d7903603a3e48a1bf7` (2026-05-15)
- **Measured 2026-07-29 (`gh api`):** 4,224 stars · 489 forks · last push 2026-05-15 · license MIT

> **Pin note.** Upstream cuts **no git tags and no GitHub releases**, so there is nothing to pin but the default branch head — and a moving branch name is rejected by the schema, correctly. The manifest `version` is `0.2.2`, read from `pyproject.toml` at the pinned commit, not a release tag. No release feed exists to watch, so this pin needs a deliberate re-check.

Most-starred item in this batch by a wide margin, and also the quietest: no push since 2026-05-15.

## Installing it standalone

Python, published to PyPI as `mcp-obsidian`:

```json
{
  "mcpServers": {
    "mcp-obsidian": {
      "command": "uvx",
      "args": ["mcp-obsidian"],
      "env": {
        "OBSIDIAN_API_KEY": "<YOUR_OBSIDIAN_API_KEY>",
        "OBSIDIAN_HOST": "<your_obsidian_host>",
        "OBSIDIAN_PORT": "<your_obsidian_port>"
      }
    }
  }
}
```

**Prerequisite the snippet does not show:** Obsidian must be running with the [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) community plugin enabled, and `OBSIDIAN_API_KEY` is that plugin's key. No Obsidian, no server. Setup is in **upstream's own README at the pinned ref**.

## Installing it from the Marblo Store

Not installable. This is a `community` item: listed and disclosed, no install button. See [CONTRIBUTING.md](../../CONTRIBUTING.md) for why unreviewed items do not get to register a process that launches on your machine.

## Permissions

`network:outbound`, `secrets:read` — and the absence of `filesystem:read` / `filesystem:write` is the honest declaration, not an oversight. Every vault read and write is an HTTP call to the Local REST API plugin on localhost; the server never opens the vault directory.

Two consequences worth stating plainly:

- **`network:outbound` here usually means localhost.** The flat vocabulary cannot say that; scoped forms (`network:outbound:127.0.0.1`) arrive with the Phase 1a permission gate.
- **Your notes become model context.** Anything the agent searches lands in the prompt. Treat note content as data, not instructions — a note containing "ignore previous instructions" is exactly as untrusted as a scraped web page.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — external, **not** reviewed by Marblo maintainers. The pin is immutable and the license was checked; the payload was not audited.
- **License:** MIT (upstream, `LICENSE` present at the pinned ref)

Pinning freezes this at one commit: upstream fixes, including security fixes, do not reach you until the pin here moves.
