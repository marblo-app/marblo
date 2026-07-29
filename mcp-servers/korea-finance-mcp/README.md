# Korea Finance MCP — ECOS, RTMS, R-ONE, DART, KRX (referenced)

Korean financial questions usually cross agencies: the policy rate is 한국은행's, apartment prices are 국토교통부's, the housing index is 한국부동산원's, filings are DART's, quotes are KRX's. This server puts 19 tools over all five and adds the joins — policy rate against apartment transaction prices with a configurable lag, FX or CPI against KOSPI, a construction firm's share price against a region's housing prices, up to five macro series aligned on one period. Every figure comes back with its source and as-of date attached.

한국은행 ECOS·국토부 RTMS·한국부동산원 R-ONE·DART·KRX 를 한 서버에서 조회하고 지표 간 상관을 계산한다.

## Referenced, not vendored

**No code from this project lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag.

- **Upstream:** [emceeKim/korea-finance-mcp](https://github.com/emceeKim/korea-finance-mcp)
- **Pinned at:** `v1.4.0` (resolves to commit `44d636244abc4e81eb32733b92e07af999202771`, committed 2026-06-11)

## Why it is listed here

The cross-source correlation is the part that does not exist elsewhere. Individual DART or ECOS wrappers are easy to find; a server that will line up 기준금리 against 실거래가 with a lag and hand back a correlation coefficient is not, and it is a specifically Korean question.

**Measured 2026-07-29:** 53 stars · last upstream push 2026-07-04 · latest tag `v1.4.0` (2026-06-11).

Upstream is explicit that the server is data lookup and statistics only, and that it deliberately ships no order execution, no investment advice, and no recommendation surface — its stated reason is Korea's 자본시장법 registration boundary. That is upstream's own legal position, quoted here as context, not as legal advice from us.

## ⚠️ License reads as `NOASSERTION` on GitHub

The `LICENSE` file is the standard MIT license text, followed by an appended Korean disclaimer paragraph about investment risk. Because of that appendix, GitHub's license API classifies the repo as `Other` / `NOASSERTION` rather than `MIT`. We record `license: MIT` in the manifest because the MIT grant itself is verbatim and unmodified, and note the discrepancy here so nobody has to re-derive it. Read the file yourself if redistribution matters to you.

## Installing it standalone

Clone at the pinned tag and configure keys:

```bash
git clone https://github.com/emceeKim/korea-finance-mcp
git -C korea-finance-mcp checkout v1.4.0
cp korea-finance-mcp/.env.example korea-finance-mcp/.env
```

`ECOS_API_KEY` is required; `DATA_GO_KR_API_KEY` and `DART_API_KEY` unlock the RTMS and filings tools. Upstream's README at the pinned tag is authoritative for client setup.

Note that pinning freezes this at one release: upstream fixes do **not** reach you until the pin here moves. See [SECURITY.md](../../SECURITY.md).

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` (external, payload **not** reviewed — listing only, not one-click-installable)
- **Permissions:** `network:outbound` (calls ECOS, data.go.kr/RTMS, R-ONE, DART, KRX), `secrets:read` (reads the three API keys from the environment)
- **License:** MIT text with an appended non-license disclaimer — see the section above.
- **Overlap with [`korea-realestate-mcp`](../korea-realestate-mcp/):** both read RTMS. That one goes deep on housing (every property type, jeonse/monthly rent, 청약); this one carries housing as one input to macro analysis. Install the one that matches your question.
