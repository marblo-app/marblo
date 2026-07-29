# Korean Law MCP — 법제처 국가법령정보 (referenced)

Korean statutes, case law, administrative rules, local ordinances, treaties, and authoritative interpretations, queried from the 법제처(Ministry of Government Legislation) open APIs. Its distinguishing tool is **citation verification**: given a citation a model produced, it checks that the article exists _and_ that its text matches what was claimed.

한국 법령·판례·행정규칙·자치법규·조약·해석례를 법제처 Open API 에서 조회하는 MCP 서버. LLM 이 지어낸 조문 인용을 실존 여부와 내용까지 대조해 걸러내는 인용 검증 도구가 핵심입니다.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag, so license, ownership, and maintenance stay with the original author.

- **Upstream:** [chrisryugj/korean-law-mcp](https://github.com/chrisryugj/korean-law-mcp)
- **Pinned at:** `v4.9.1` (annotated tag; resolves to commit `860cfcbce9c01c664766ec1badca8d4468b87488`)

## Why it is listed here

Korea coverage is the thing a global registry does not give you. Korean legal text is not in most models' reliable recall, and hallucinated 조문 numbers are the failure mode this server is built against.

**Measured 2026-07-29:** 2,333 stars · last upstream push 2026-07-27 · npm `korean-law-mcp` at 4.9.1 with 24,242 downloads in the last 30 days. Actively maintained at the time of listing.

## Installing it standalone

Follow **upstream's own instructions at the pinned tag** — they are authoritative and they change between releases. The published entry point is the npm package:

```bash
npx -y korean-law-mcp@4.9.1
```

You need a 법제처 Open API account; the server reads it from `LAW_OC` (see upstream's `.env.example`). Register at [open.law.go.kr](https://open.law.go.kr/).

Note that pinning freezes this at one release: upstream fixes do **not** reach you until the pin here moves. See [SECURITY.md](../../SECURITY.md).

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` (external, payload **not** reviewed — listing only, not one-click-installable)
- **Permissions:** `network:outbound` (calls 법제처 APIs), `secrets:read` (reads the `LAW_OC` credential from your environment)
- **License:** MIT (upstream, verified via the GitHub license API)
- **Legal caveat:** this is a retrieval tool, not legal advice. Verified citations are still citations, not counsel.
