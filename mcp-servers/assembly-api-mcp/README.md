# National Assembly of Korea (열린국회정보) MCP — referenced

Korea's legislature publishes 276 open APIs, and using them raw means learning 276 response shapes. This server collapses them — plus 8 국민참여입법센터 endpoints and 3 국회예산정책처 (NABO) ones, 287 in total — into 6 tools on the Lite profile or 11 on Full: members and party seat counts, bills with their 소관위 → 법사위 → 본회의 → 공포 review path attached, sessions, votes, committees, petitions, legislative notices, minutes from 국정감사 and 인사청문회, and NABO's budget-analysis reports. Four tools take `lang="en"` where the upstream API offers English.

법제처 법령이 아니라 **국회** 쪽 데이터다 — 누가 무슨 법안을 냈고, 어느 위원회에서 어떻게 처리됐고, 표결이 어떻게 갈렸는지.

## Referenced, not vendored

**No code from this project lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a commit.

- **Upstream:** [hollobit/assembly-api-mcp](https://github.com/hollobit/assembly-api-mcp)
- **Pinned at:** `f74c6b452c59d87e2fa7265fd985b90e4057a8ef` — upstream publishes no git tags, so this is a full 40-hex commit SHA. It is the tip of the default branch as of measurement; upstream's own version number there is `0.7.0`.

## Why it is listed here

Legislative process data is the half of Korean law that [`korean-law-mcp`](../korean-law-mcp/) does not cover: that one answers "what does the statute say", this one answers "who moved it, through which committee, and how did the vote go".

**Measured 2026-07-29:** 82 stars · last upstream push 2026-05-02 · no tags · `package.json` version 0.7.0, released 2026-04-12 per upstream's changelog.

Roughly three months without a commit at the time of measurement. Not archived, and the underlying government endpoints are stable, but treat it as a project between bursts rather than one under active weekly development.

## Installing it standalone

Upstream ships an interactive setup wizard that writes the MCP config for your client:

```bash
npx assembly-api-mcp setup
```

Node.js 18+ on macOS, Windows, or Linux. You need a free 열린국회정보 API key from [open.assembly.go.kr](https://open.assembly.go.kr) — the literal key `sample` works for up to 10 records if you just want to try it. The 국민참여입법센터 tools additionally need an OC id, and are simply unavailable without one. Upstream also operates a remote endpoint (`assembly-api-mcp.fly.dev`), which means your key transits their server; the local install above does not.

Note that pinning freezes this at one commit: upstream fixes do **not** reach you until the pin here moves. See [SECURITY.md](../../SECURITY.md).

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` (external, payload **not** reviewed — listing only, not one-click-installable)
- **Permissions:** `network:outbound` (calls open.assembly.go.kr, opinion.lawmaking.go.kr, nabo.go.kr), `secrets:read` (reads `ASSEMBLY_API_KEY` and the optional OC id from the environment)
- **License:** MIT (upstream, verified via the GitHub license API)
- **`version: 0.7.0`** tracks upstream's `package.json`, not a git tag — there are none.
