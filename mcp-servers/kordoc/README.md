# kordoc — HWP/HWPX & Korean office documents (referenced)

HWP is the word processor Korean government and enterprise paperwork actually uses, and almost nothing in the global agent tooling ecosystem reads it. kordoc parses HWP 3.x/5.x, HWPX, HWPML, PDF, XLS, XLSX, DOCX, and images into Markdown an agent can work with, and can compare and generate documents in the same formats. Ships as a CLI **and** an MCP server from one package.

한글(HWP/HWPX) 을 비롯해 관공서 문서를 파싱·비교·생성하는 CLI + MCP 서버. 상위 문서지옥을 7년 버틴 공무원이 만들었다고 upstream README 가 밝히고 있습니다.

## Referenced, not vendored

**No code from this project lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag.

- **Upstream:** [chrisryugj/kordoc](https://github.com/chrisryugj/kordoc)
- **Pinned at:** `v4.2.9` (annotated tag; resolves to commit `e4878dd12e2d769361157cbf49520f2777b186f8`)

## Why it is listed here

This is the clearest case of Korea coverage being a capability gap rather than a preference. An agent that cannot open an `.hwp` cannot do Korean office work at all.

**Measured 2026-07-29:** 1,561 stars · last upstream push 2026-07-26 · npm `kordoc` at 4.2.9 with **49,771 downloads in the last 30 days** — the highest real usage of anything in this Korea set.

## Installing it standalone

Upstream ships an interactive setup wizard that writes the MCP config for your client:

```bash
npx -y kordoc setup
```

Node.js 18+ on macOS, Linux, or Windows. Upstream's instructions at the pinned tag are authoritative; the two binaries the package exposes are `kordoc` (CLI) and `kordoc-mcp` (MCP server).

Note that pinning freezes this at one release: upstream fixes do **not** reach you until the pin here moves. See [SECURITY.md](../../SECURITY.md).

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` (external, payload **not** reviewed — listing only, not one-click-installable)
- **Permissions:** `filesystem:read` and `filesystem:write` — it reads your documents and writes converted output. `network:outbound` is declared because the package contains fetch paths (`src/watch.ts`, `src/pdf/formula/models.ts`); the core conversion itself runs locally, with no HTTP client in its runtime dependencies (`@xmldom/xmldom`, `cfb`, `jszip`, `markdown-it`, `zod`).
- **License:** MIT (upstream, verified via the GitHub license API). Upstream also ships `NOTICE` and `THIRD_PARTY` — read them if you redistribute.
