# Naver Search MCP (referenced)

Search across Naver — news, blogs, cafés, local listings, encyclopedia — and query DataLab for search-trend and shopping-insight series. For Korean-language content, Naver is where a large share of it is indexed and Google is not a substitute.

네이버 검색 API 와 데이터랩(검색어 트렌드·쇼핑인사이트) 을 MCP 로 노출합니다.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a commit.

- **Upstream:** [isnow890/naver-search-mcp](https://github.com/isnow890/naver-search-mcp)
- **Pinned at:** `d7c7c58cab0de2692336b710727f1ee123270e6c` — upstream publishes no git tags, so this is a full 40-hex commit SHA, which is the other form `source.ref` accepts.

## ⚠️ Naver is migrating these APIs — read before installing

This is upstream's own disclosure, verified on their README on 2026-07-29, and it is the most important thing to know before you wire this in:

| Date           | What happens                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **2026-07-31** | Naver Developers Center stops accepting new key applications. Shopping / Book / Academic search APIs shut down entirely. |
| **2027-06-30** | Developers Center support ends — existing keys stop working.                                                             |

Search, Search Trend, and Shopping Insight are moving to **NAVER API HUB** on NAVER Cloud Platform. Practically: if you are setting up for the first time, get HUB keys, because the Developers Center path closes to new applicants on 2026-07-31. Upstream supports both platforms side by side from one install through the 2027-06-30 cutoff, and removed the three dead tools (`search_shop`, `search_book`, `search_academic`) in 1.0.49.

We list this knowing the deprecation clock exists. The alternative — omitting the one maintained Naver server because its upstream API is in migration — would leave the category empty and tell you less.

## Why it is listed here

**Measured 2026-07-29:** 80 stars · last upstream push 2026-07-26 · npm `@isnow890/naver-search-mcp` at 1.0.50 (MIT). Upstream is handling a disruptive platform migration transparently, which is a maintenance signal in its own right.

## Installing it standalone

```bash
npx -y @isnow890/naver-search-mcp@1.0.50
```

You need one credential pair — either NAVER API HUB (NCP) keys or legacy Developers Center client id/secret. Upstream's README at the pinned commit is authoritative for the exact variable names on each platform.

Note that pinning freezes this at one commit: upstream fixes do **not** reach you until the pin here moves. Given the migration above, expect this pin to need moving. See [SECURITY.md](../../SECURITY.md).

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` (external, payload **not** reviewed — listing only, not one-click-installable)
- **Permissions:** `network:outbound` (calls Naver APIs), `secrets:read` (reads your client credentials from the environment)
- **License:** MIT (upstream, verified via the GitHub license API and the published npm package)
