# Korea Stock MCP — DART · KRX (referenced)

Korean equity data from the two official sources: **DART** (전자공시시스템, the regulatory filing system) for disclosures and XBRL-based financial statements, and **KRX** (한국거래소) for daily KOSPI/KOSDAQ prices and listing metadata.

DART 공시 검색·원본 파싱·XBRL 재무제표와 KRX 일별 시세를 공식 API 로 가져오는 MCP 서버입니다.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag.

- **Upstream:** [jjlabsio/korea-stock-mcp](https://github.com/jjlabsio/korea-stock-mcp)
- **Pinned at:** `v1.4.1` (annotated tag; resolves to commit `9c951ca2d31c8a281a311ef6e76eaad7cd754ed4`)

## Why it is listed here

Global finance MCP servers cover US tickers. Korean filings live in DART, in Korean, in a filing format with its own conventions — an agent doing Korean market work needs the domestic source, not a wrapper over a US data vendor.

**Measured 2026-07-29:** 168 stars · last upstream push 2026-07-28 · npm `korea-stock-mcp` at 1.4.1 (ISC). Actively maintained at the time of listing.

## Installing it standalone

```bash
npx -y korea-stock-mcp@1.4.1
```

You need your own API keys — one from [DART OpenAPI](https://opendart.fss.or.kr/) and one from [KRX Open API](https://openapi.krx.co.kr/). Upstream's instructions at the pinned tag are authoritative for the exact environment variable names.

Note that pinning freezes this at one release: upstream fixes do **not** reach you until the pin here moves. See [SECURITY.md](../../SECURITY.md).

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` (external, payload **not** reviewed — listing only, not one-click-installable)
- **Permissions:** `network:outbound` (calls DART and KRX), `secrets:read` (reads your two API keys from the environment)
- **License:** ISC (upstream, verified via the GitHub license API and the published `package.json`)
- **Caveat:** filings data is not investment advice, and XBRL parsing of a filing is only as good as the filing.
