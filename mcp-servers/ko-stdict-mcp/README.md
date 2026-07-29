# 표준국어대사전 (Standard Korean Dictionary) MCP — referenced

The Standard Korean Dictionary is the reference 국립국어원 maintains and the one Korean editorial work is settled against. This server takes the official "사전 내려받기" JSON dump, normalizes it into SQLite on first run, and answers headword lookups from the local database afterwards — you pick which fields you want back per query. No Open API key is involved, and after the initial download no per-query network call happens either.

한국어 텍스트를 다루는 에이전트에게 사전은 검색 결과가 아니라 정확한 근거가 필요할 때 쓰는 도구다.

## Referenced, not vendored

**No code from this project lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag.

- **Upstream:** [dahlia/ko-stdict-mcp](https://github.com/dahlia/ko-stdict-mcp)
- **Pinned at:** `0.2.0` (resolves to commit `168f902bc8b820f4242812ed0af411a5e8918893`, committed 2026-03-29). Upstream tags without a `v` prefix, matching `deno.json`.

## Why it is listed here

Korean-language work is where a global registry has the least to offer — an English dictionary tool is not a substitute, and neither is a web search. This is also one of the few entries in the Korea set that keeps working with the network off.

**Measured 2026-07-29:** 25 stars · last upstream push 2026-03-29 · latest tag `0.2.0`, which is also the tip of the default branch.

Four months without a commit at the time of measurement. For this particular item that matters less than it usually would: the dependency surface is Deno plus SQLite, and the data is a versioned government dump rather than a live endpoint that can change shape underneath it.

## ⚠️ AGPL-3.0

Unlike everything else in this Korea set, this one is copyleft — GNU Affero GPL v3. Running it locally as your own MCP server is exactly the intended use and carries no obligation. Offering it to others over a network, or building it into something you distribute, brings the AGPL's source-availability requirements with it. Read the license if either applies to you.

## Installing it standalone

Requires Deno 2.0+.

```bash
git clone https://github.com/dahlia/ko-stdict-mcp
git -C ko-stdict-mcp checkout 0.2.0
cd ko-stdict-mcp && deno install && deno task init
```

`deno task init` performs the one-time dump download and SQLite build; `deno task refresh` rebuilds it later. Upstream's README at the pinned tag carries the MCP client config example.

Note that pinning freezes this at one release: upstream fixes do **not** reach you until the pin here moves. See [SECURITY.md](../../SECURITY.md).

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` (external, payload **not** reviewed — listing only, not one-click-installable)
- **Permissions:** `network:outbound` (downloads the official dictionary dump on first run and on refresh), `filesystem:write` (the ZIP cache and the normalized SQLite database), `filesystem:read` (reads them back on later runs). No `secrets:read` — there is no API key.
- **License:** AGPL-3.0 (upstream, verified via the GitHub license API) — see the section above.
