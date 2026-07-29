# Daiso MCP — Korean retail, convenience stores, and cinemas (referenced)

"Which Daiso near me has this in stock, and what does the same thing cost at GS25?" is a question a global retail MCP cannot answer, because none of these chains publish to anything an English-language server indexes. This one covers 다이소, 올리브영, 롯데마트, GS25, CU, 세븐일레븐, 이마트24 for products, stores and stock; Opinet for fuel prices and the cheapest nearby station; Naver local search for restaurants and cafés; and 메가박스, 롯데시네마, CGV for movies, showtimes and seats.

한국 로컬 리테일·생활 정보·영화관 조회를 MCP·CLI·Codex Skill 로 붙이는 도구. 사용자가 발급받을 API 키가 없다.

## Referenced, not vendored

**No code from this project lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag.

- **Upstream:** [hmmhmmhm/daiso-mcp](https://github.com/hmmhmmhm/daiso-mcp)
- **Pinned at:** `v1.0.10` (resolves to commit `cccd54a81d0ca4aab3d359934c309706f5aa0d64`, committed 2026-07-14)

## Why it is listed here

Korean local commerce is the clearest example of data that simply is not in the global agent ecosystem — the sources are Korean-language storefront APIs with no English surface at all.

**Measured 2026-07-29:** 314 stars · last upstream push 2026-07-28 · latest tag `v1.0.10` · npm package `daiso` at 1.0.10.

## ⚠️ This is a hosted server, not a local one

The MCP surface is a remote endpoint the upstream author operates on Cloudflare Workers (`https://mcp.aka.page`). That is why you need no API key — the operator holds the upstream credentials. It also means **your queries go to a third party's server**, and availability is theirs, not yours. Upstream publishes a public status page. Decide with that in mind; the `npx daiso` CLI from the same package is the local alternative for one-off lookups.

## Installing it standalone

As a remote MCP server in Claude Code:

```bash
claude mcp add daiso-mcp https://mcp.aka.page --transport http
```

Or as a CLI, no config at all:

```bash
npx daiso
```

Upstream's README at the pinned tag is authoritative for other clients (claude.ai connectors, ChatGPT, Home Assistant).

Note that pinning freezes the _manifest_ at one release — but because the tool surface is served remotely, upstream can change the deployed behaviour without the pin here moving. See [SECURITY.md](../../SECURITY.md).

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` (external, payload **not** reviewed — listing only, not one-click-installable)
- **Permissions:** `network:outbound` — the client talks to the hosted endpoint, which then calls the retail, Opinet, Naver, and cinema APIs. No `secrets:read`: you supply no key.
- **License:** MIT (upstream, verified via the GitHub license API)
