# Docker MCP Gateway (referenced)

**Why this one:** it is the answer to "my MCP config is now twelve `npx` processes with twelve API keys in plaintext." The gateway runs catalog servers as isolated containers, keeps their secrets in Docker Desktop's secret store instead of your config file, and hands the client a single endpoint with the merged tool set.

It is a gateway, not a leaf server — worth knowing before you install it, because what it exposes depends entirely on which catalog servers you enable.

## Referenced, not vendored

**No code from this project lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a tag, so license, ownership, and maintenance stay with Docker.

- **Upstream:** [docker/mcp-gateway](https://github.com/docker/mcp-gateway)
- **Pinned at:** `v0.43.3` (commit `8b5d526aef123f49aae07fe95036109c315177b3`)
- **Measured 2026-07-29 (`gh api`):** 1,511 stars · last push 2026-07-23 · license MIT

> **Pin note.** Upstream cuts git tags but publishes no GitHub releases — `releases/latest` returns 404 while `refs/tags` lists through `v0.43.3`, the highest version tag as of the survey. The tag is pinned; the manifest `version` tracks it.

## Installing it standalone

This one is not an `npx` package. It is a Go CLI plugin, so the install is a Docker install:

```bash
# Docker Desktop 4.59+ ships the plugin; otherwise build it:
git clone https://github.com/docker/mcp-gateway.git && cd mcp-gateway
git checkout v0.43.3
mkdir -p "$HOME/.docker/cli-plugins/" && make docker-mcp

# then run the gateway
docker mcp gateway run
```

`docker mcp gateway run` speaks stdio; `--port 8080 --transport streaming` serves it over HTTP instead, and `--profile <name>` selects which catalog servers are enabled (the `default` profile is used when the flag is omitted). Client wiring, catalog management, and OAuth flows are documented in upstream's README and `docs/mcp-gateway.md` at the pinned ref.

Prerequisite per upstream: Docker Desktop 4.59+ with the MCP Toolkit feature enabled. Outside Docker Desktop, upstream documents `DOCKER_MCP_IN_CONTAINER=1` to bypass the Desktop backend check.

## No one-click install from the Store

This item carries no `install` block, and here two independent reasons apply. First, [`registry/manifest.schema.json`](../../registry/manifest.schema.json) allows an MCP install contract only for `official` and `verified` publishers, and this is `community`. Second, the install `runner` enum is `npx | uvx` — `docker` and `binary` are explicitly reserved for a later phase and rejected today rather than half-supported. A Docker CLI plugin is not installable through this registry at all yet, in either tier.

## Permissions

`network:outbound`, `filesystem:read`, `filesystem:write`, `shell:exec`, `secrets:read` — the widest declaration in this collection, and it is not padding. The gateway launches containers (`shell:exec`), mounts host paths into them (`filesystem:read`/`filesystem:write`), reads the catalog and Docker Desktop's secret store (`secrets:read`), and carries the traffic of every server it fronts (`network:outbound`).

The security trade is worth stating in both directions. Running each server in a container with minimal host privileges is genuinely stronger isolation than a bare `npx` process on your machine. But the gateway itself is a broadly privileged process, and the tools it exposes are whatever the enabled catalog servers expose — this listing's disclosure covers the gateway, not the servers you enable through it. Review the profile.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — external, listed, **not reviewed by Marblo maintainers**. The code is first-party Docker; `community` describes Marblo's review process, not the publisher. What was checked: the repo exists, the tag resolves, the license is MIT, and the activity numbers are `gh api` readings on 2026-07-29.
- **License:** MIT (upstream)

Pinning freezes this at one tag: upstream fixes, including security fixes, do not reach you until the pin here moves. Upstream tags frequently, so `refs/tags` is the feed to watch — there is no releases feed.
