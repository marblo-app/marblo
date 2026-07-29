# Korea Investment & Securities (KIS) REST API MCP — referenced

한국투자증권's Open API is how retail algorithmic trading is actually done in Korea, and it is 166 endpoints with TR_ID codes, per-market order variants, and Korean-only parameter documentation. This server exposes them catalog-first: an agent can list the 8 groups, ask what a given API's path, method, TR_ID candidates and parameters are — with Korean labels, input guidance, example values, and the code tables — and then call it. On top of the catalog there are convenience tools for the common paths: domestic quotes, daily/period prices, order book, sector indices; balances, account assets, buying power, sellable quantity; and overseas markets across the US, Japan, China, Hong Kong, and Vietnam with the order TR_ID selected automatically per market and side.

## Referenced, not vendored

**No code from this project lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a commit.

- **Upstream:** [migusdn/KIS_MCP_Server](https://github.com/migusdn/KIS_MCP_Server)
- **Pinned at:** `595d5d1cdbbe6ae706f030cd196cfa1c12f15ca7` — upstream publishes no git tags, so this is a full 40-hex commit SHA. Upstream's `pyproject.toml` version there is `0.1.0`.

## Why it is listed here

This is the brokerage-account side of Korean markets, which is a different thing from market data. [`korea-stock-mcp`](../korea-stock-mcp/) analyses listed companies; this one talks to _your_ account at a specific broker — balance, buying power, order history.

**Measured 2026-07-29:** 25 stars · last upstream push 2026-06-15 · no tags · MIT.

한국투자증권 itself publishes [`koreainvestment/koreainvestment-mcp`](https://github.com/koreainvestment/koreainvestment-mcp) (17 stars, last pushed 2025-08-27). We did **not** list the official one: it ships no LICENSE file at all, which under this registry's rules means there is no grant to rely on. That is a licensing fact, not a quality judgement.

## ⚠️ This one can move money

- Order, amend, and cancel APIs are **blocked by default**. They run only if you explicitly set `KIS_ENABLE_TRADING=true`. Leave it unset for research use.
- `KIS_ACCOUNT_TYPE` selects `REAL` or `VIRTUAL` (모의투자). Start on `VIRTUAL`.
- Unofficial and community-run: upstream states it has no affiliation with, sponsorship from, or approval by 한국투자증권, and that all consequences of use — including trading losses — are the user's.

An agent with this server attached and trading enabled can place orders. Treat that as the security boundary it is.

## Installing it standalone

```bash
pip install uv
git clone https://github.com/migusdn/KIS_MCP_Server
git -C KIS_MCP_Server checkout 595d5d1cdbbe6ae706f030cd196cfa1c12f15ca7
cd KIS_MCP_Server && uv sync && cp .env.example .env && chmod 600 .env
```

Python 3.13+. Set `KIS_APP_KEY`, `KIS_APP_SECRET`, `KIS_CANO`, `KIS_ACNT_PRDT_CD` in `.env`; upstream's `INSTALL.md` at the pinned commit is authoritative and includes registration snippets for Claude Code, Codex CLI, and Claude Desktop. `stdio`, `sse`, and `streamable-http` transports are all supported.

Note that pinning freezes this at one commit: upstream fixes do **not** reach you until the pin here moves. See [SECURITY.md](../../SECURITY.md).

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` (external, payload **not** reviewed — listing only, not one-click-installable)
- **Permissions:** `network:outbound` (calls the KIS REST API), `secrets:read` (app key, secret, and account numbers from the environment), `filesystem:read` / `filesystem:write` (the OAuth token cache, `KIS_TOKEN_FILE`, default `token.json`)
- **License:** MIT (upstream, verified via the GitHub license API)
- **`version: 0.1.0`** tracks upstream's `pyproject.toml`, not a git tag — there are none.
