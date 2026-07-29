# Korea Real Estate MCP — MOLIT transaction prices (referenced)

Korean apartment prices are public data, but they arrive as eleven separate 국토교통부 (MOLIT) endpoints, each with its own region-code convention and its own XML quirks. This server puts all of them behind 14+ MCP tools: 매매 and 전월세 for apartments, officetels, 연립다세대, 단독/다가구, plus 상업업무용 trades, 청약홈 subscription notices and results, and a region-code lookup so an agent can go from "강남구" to the code the API actually wants.

국토교통부 실거래가 공개 API 를 MCP 도구로 묶은 서버. 아파트·오피스텔·빌라·단독주택·상가의 매매/전월세 실거래가와 청약 정보를 조회한다.

## Referenced, not vendored

**No code from this project lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag.

- **Upstream:** [tae0y/real-estate-mcp](https://github.com/tae0y/real-estate-mcp)
- **Pinned at:** `v0.1.0` (resolves to commit `65137a0f21ecf80b30390d6f07de4d54acff01f4`, committed 2026-07-18)

## Why it is listed here

Housing transactions are the single most-asked-about public dataset in Korea, and no global registry carries a server for it — the data only exists behind a Korean-language government portal.

**Measured 2026-07-29:** 366 stars · last upstream push 2026-07-18 · one release tag (`v0.1.0`), cut the same day as the most recent push.

Note that `v0.1.0` is the only tag upstream has cut, and commits have landed on the default branch since. The pin is the tag, so what this listing points at is a release, not a moving branch — but it is an early one, and upstream's version number says so.

## Installing it standalone

Upstream runs on [uv](https://docs.astral.sh/uv/) and is configured as a stdio server in your harness's MCP config. It needs a 공공데이터포털 service key, applied for per-API (the eleven MOLIT/한국부동산원 services are listed in upstream's README). Clone at the pinned tag and follow upstream's instructions, which are authoritative:

```bash
git clone https://github.com/tae0y/real-estate-mcp
git -C real-estate-mcp checkout v0.1.0
```

Note that pinning freezes this at one release: upstream fixes do **not** reach you until the pin here moves. See [SECURITY.md](../../SECURITY.md).

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` (external, payload **not** reviewed — listing only, not one-click-installable)
- **Permissions:** `network:outbound` (calls data.go.kr APIs), `secrets:read` (reads your service key from the environment)
- **License:** MIT (upstream, verified via the GitHub license API)
