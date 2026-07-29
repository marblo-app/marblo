# Discord MCP (referenced)

**Why this one:** it is the leading Discord MCP server that actually has a license. The obvious alternative (`v-3/discordmcp`, 221 stars) ships **no LICENSE file at all**, which makes it unlistable here regardless of popularity.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag, so license, ownership, and maintenance stay with the upstream author.

- **Upstream:** [SaseQ/discord-mcp](https://github.com/SaseQ/discord-mcp)
- **Pinned at:** `v1.0.0` (released 2026-03-16)
- **Measured 2026-07-29 (`gh api`):** 424 stars · 91 forks · last push 2026-04-25 · license MIT

> **Pin note.** The default branch is ahead of `v1.0.0` — last push 2026-04-25, tag cut 2026-03-16. `v1.0.0` is the only tag upstream has ever cut, and it is pinned as the one thing upstream has called a release.

## Installing it standalone

Java and Maven, shipped as a container, so this is not an `npx` or `uvx` install:

```json
{
  "mcpServers": {
    "discord": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "-e",
        "DISCORD_TOKEN=<YOUR_DISCORD_BOT_TOKEN>",
        "-e",
        "DISCORD_GUILD_ID=<OPTIONAL_DEFAULT_SERVER_ID>",
        "saseq/discord-mcp:latest"
      ]
    }
  }
}
```

`saseq/discord-mcp:latest` is a moving tag — pin a digest if you care about reproducibility, the same way this manifest pins a git ref. Building from source with `mvn clean package` is documented in **upstream's own README at the pinned ref**.

## Installing it from the Marblo Store

Not installable. This is a `community` item: listed and disclosed, no install button. See [CONTRIBUTING.md](../../CONTRIBUTING.md) for why unreviewed items do not get to register a process that launches on your machine.

## Permissions

`network:outbound`, `secrets:read` — connects to Discord's gateway and API; reads `DISCORD_TOKEN` from the environment.

Two things worth stating plainly:

- **A bot token is a bot identity, and the agent is driving it.** Whatever roles you grant that bot on the server, the model can exercise: sending messages, managing channels, editing roles. Grant the narrowest role set you can live with, on a server you administer.
- **Discord messages are untrusted input.** Channel content from anyone in the server lands in the model's context. Treat it as data, not instructions.

The manifest uses the flat permission vocabulary `schema_version: 1` defines; scoped forms (`network:outbound:<host>`, `secrets:read:<VAR>`) arrive with the Phase 1a permission gate, so the concrete scope is written out here rather than asserted in a field the schema cannot yet check.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — external, **not** reviewed by Marblo maintainers. The pin is immutable and the license was checked; the payload was not audited.
- **License:** MIT (upstream, `LICENSE` present at the pinned ref)

Pinning freezes this at one tag: upstream fixes, including security fixes, do not reach you until the pin here moves.
