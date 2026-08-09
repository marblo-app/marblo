# credit-proxy — L2 metering proxy PoC

Minimal byte-exact passthrough proxy for `POST /v1/messages`, built to answer one
question: **does putting our proxy in the path break Anthropic's prompt cache?**

Design: [`v3/docs/onramp-l2-credit-tier-design-2026-08-09.md`](../docs/onramp-l2-credit-tier-design-2026-08-09.md) §5, §11.
PoC report and go/no-go: [`v3/docs/onramp-l2-proxy-cache-poc-2026-08-09.md`](../docs/onramp-l2-proxy-cache-poc-2026-08-09.md).

## Why this is not in `v3/functions`

Our functions package is gen1 (`firebase-functions@^5`), and gen1 cannot stream a
response. `/v1/messages` is SSE. This is a Cloud Run service with its own
`package.json`, so it also cannot pollute the functions Cloud Build `npm ci`.

## The one invariant

The request body is relayed **byte-for-byte**. It is never parsed-and-
reserialized, never normalized, never appended to. The prompt cache is keyed on
the exact input prefix; one changed byte costs ~$53 per ticket (design §4-A).
Our own metadata travels in headers, never in the body.

## Commands

```bash
npm run typecheck        # tsc, src + test
npm test                 # 66 tests: unit + E2E against a mock upstream
npm run probe:mock       # ★ full G-P1/G-P2 measurement, no vendor key needed
npm run build && npm start

# needs a real pay-go ANTHROPIC_API_KEY:
ANTHROPIC_API_KEY=… npm start                 # terminal 1
ANTHROPIC_API_KEY=… npm run probe:cache       # terminal 2 — live G-P1
ANTHROPIC_API_KEY=… npm run probe:toolloop    # live G-P2
```

`npm test` and `npm run probe:mock` run today with no credential. They use
`src/mock/anthropicMock.ts`, which implements a **real** prefix cache (sha256 of
the content up to the last `cache_control` breakpoint, TTL map), so a proxy that
mutated the prefix would fail them.

## Layout

| Path                      | What                                                           |
| ------------------------- | -------------------------------------------------------------- |
| `src/relay.ts`            | the passthrough itself — buffer body, swap credential, tee SSE |
| `src/headers.ts`          | header allow/deny policy in both directions                    |
| `src/sse.ts`              | SSE framing, resilient to any chunk boundary                   |
| `src/usage.ts`            | `usage` extraction (streaming + non-streaming)                 |
| `src/messageAssembler.ts` | rebuilds the assistant message, incl. split `tool_use` inputs  |
| `src/cost.ts`             | cache multipliers; reproduces the §4-A 6.4x                    |
| `src/gate.ts`             | G-P1 / G-P2 verdicts                                           |
| `src/mock/`               | mock upstream with a real prefix cache                         |
| `src/probe/`              | the measurement CLIs                                           |

## Not in scope (P2 — only after G-P1/G-P2 are green live)

Credit-token auth, model allowlist, `hold`→`settle` state machine, the ledger,
top-up wiring, the `spawnNewAgent` balance gate. See design §11 T-6…T-10.
**Do not deploy this publicly with a live key** — it has no authentication.
