# Korean Patent MCP (KIPRIS) — referenced

특허청's KIPRIS Plus is the authoritative source for Korean industrial property, and its API is a set of differently-shaped SOAP-era operations. This server exposes seven of them as MCP tools: free-text search across patents and utility models (title, abstract, claims, applicant), fielded search combining IPC / 발명명칭 / 초록 / 청구범위 / 출원인 / 발명자, applicant search, right-holder search that reflects assignments, bibliographic detail by application number (inventors, IPC, examiner, claim count, final disposition, registration status), and keyword search over trademarks and designs.

Upstream is the same author as [`korean-law-mcp`](../korean-law-mcp/) and [`kordoc`](../kordoc/), and says it benchmarked this one on the law server's architecture — layered lib/tools, fetch retries with key masking, Zod validation, stateless HTTP, TTL cache, response size limits, and an explicit `[NOT_FOUND]` marker rather than letting a model invent a patent that does not exist.

## Referenced, not vendored

**No code from this project lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a commit.

- **Upstream:** [chrisryugj/korean-patent-mcp](https://github.com/chrisryugj/korean-patent-mcp)
- **Pinned at:** `9686dd8ff102324aed642fefeda3102caccce93c` — upstream publishes no git tags, so this is a full 40-hex commit SHA. Upstream's `package.json` version there is `0.2.1`.

## Why it is listed here

Patent search is a category where the global registry has coverage for USPTO and EPO and nothing for KIPRIS. A Korean filing strategy cannot be checked against the wrong office's data.

**Measured 2026-07-29:** 48 stars · last upstream push 2026-07-03 · no tags.

## Installing it standalone

Clone at the pinned commit and build:

```bash
git clone https://github.com/chrisryugj/korean-patent-mcp
git -C korean-patent-mcp checkout 9686dd8ff102324aed642fefeda3102caccce93c
cd korean-patent-mcp && npm install && npm run build
```

You need a KIPRIS Plus key from [plus.kipris.or.kr](https://plus.kipris.or.kr) — register, then 활용신청 for each service you want (특허·실용 / 상표 / 디자인); one key then covers all of them. Set `KIPRIS_API_KEY` in `.env`.

Upstream also runs a public remote endpoint (`mcp.gomdori.app/patent`) that falls back to a shared server key when you send none. That is convenient and it means your queries — and, if you send one, your key — go through the author's server. The local build above does not.

Note that pinning freezes this at one commit: upstream fixes do **not** reach you until the pin here moves. See [SECURITY.md](../../SECURITY.md).

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` (external, payload **not** reviewed — listing only, not one-click-installable)
- **Permissions:** `network:outbound` (calls the KIPRIS Plus API), `secrets:read` (reads `KIPRIS_API_KEY` from the environment)
- **License:** MIT (upstream, verified via the GitHub license API)
- **`version: 0.2.1`** tracks upstream's `package.json`, not a git tag — there are none.
