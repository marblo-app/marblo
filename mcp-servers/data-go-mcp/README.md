# Korea Public Data (data.go.kr) MCP Servers — referenced

A monorepo of six MCP servers over [data.go.kr](https://www.data.go.kr/), Korea's public data portal. Each is a separately published PyPI package:

| Server                    | What it gives an agent                                        | Package                                 |
| ------------------------- | ------------------------------------------------------------- | --------------------------------------- |
| NPS Business Enrollment   | 국민연금 workplace enrollment — a proxy for company headcount | `data-go-mcp.nps-business-enrollment`   |
| NTS Business Verification | 사업자등록번호 authenticity and status lookup                 | `data-go-mcp.nts-business-verification` |
| PPS Narajangteo           | 나라장터 public procurement bids, awards, contracts           | `data-go-mcp.pps-narajangteo`           |
| FSC Financial Info        | 금융위 corporate financial statements                         | `data-go-mcp.fsc-financial-info`        |
| Presidential Speeches     | 대통령기록관 speech archive                                   | `data-go-mcp.presidential-speeches`     |
| MSDS Chemical Info        | 물질안전보건자료 chemical safety data                         | `data-go-mcp.msds-chemical-info`        |

## Referenced, not vendored

**No code from these servers lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a commit.

- **Upstream:** [Koomook/data-go-mcp-servers](https://github.com/Koomook/data-go-mcp-servers)
- **Pinned at:** `dd27f99490400b31fa14f96045a138fa217580a4` — upstream publishes no git tags, so this is a full 40-hex commit SHA.

## ⚠️ Upstream has been quiet for about a year

**Measured 2026-07-29:** 288 stars · **last upstream push 2025-09-16** · PyPI packages at 0.2.0, **last uploaded 2025-08-28**.

That is roughly eleven months without a commit. It is not archived and the underlying data.go.kr APIs are stable government endpoints, so the servers plausibly still work — but nobody is fixing them if an endpoint changes, and you should treat that as the risk it is. We list it because it is the most-adopted licensed implementation of this category by a wide margin (the alternatives measured in the single digits or shipped no license at all), and saying "the public-data category is covered by a stale project" is more useful than leaving the category blank.

## Installing one standalone

Each server installs independently from PyPI:

```bash
uvx data-go-mcp.nts-business-verification
```

Every server needs a data.go.kr service key, issued per-API from the portal. Upstream's README at the pinned commit is authoritative for per-server configuration.

Note that pinning freezes this at one commit. See [SECURITY.md](../../SECURITY.md).

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` (external, payload **not** reviewed — listing only, not one-click-installable)
- **Permissions:** `network:outbound` (calls data.go.kr APIs), `secrets:read` (reads your service key from the environment)
- **License:** Apache-2.0 (upstream, verified via the GitHub license API and PyPI metadata)
- **`version: 0.2.0`** tracks the published upstream package version, not a git tag — there are none.
