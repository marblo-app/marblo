---
title: 링크 맵
tags: [meta/linkmap, status/living]
status: active
date: 2026-08-25
links: [[CONVENTION]], [[empty-query-first]], [[verify-result-row]], [[counting-unit-first]], [[decision-sentence-first]], [[routing-label-coverage]], [[no-live-gui-verify]], [[do-not-retry]], [[telemetry-identity-axes]], [[post-spawn-telemetry-gap]], [[WIKI-SKIP]]
---

# 링크 맵

새 노트를 만들면 이 표와 폴더 README 를 같은 커밋에서 갱신한다.

## 별칭

| 별칭 | 파일 |
| --- | --- |
| `wiki-home` | `README.md` |

★별칭은 이 한 건이다. 늘리지 않는다.

## 슬러그 등록부

| 슬러그 | 파일 | domain | status | verdict |
| --- | --- | --- | --- | --- |
| `CONVENTION` | `_meta/CONVENTION.md` | meta | active | — |
| `TAXONOMY` | `_meta/TAXONOMY.md` | meta | active | — |
| `LINK-MAP` | `_meta/LINK-MAP.md` | meta | active | — |
| `LINT` | `_meta/LINT.md` | meta | active | — |
| `WIKI-SKIP` | `_meta/WIKI-SKIP.md` | meta | active | skip ledger |
| `do-not-retry` | `_meta/do-not-retry.md` | meta | active | ledger |
| `empty-query-first` | `40-methodology/empty-query-first.md` | methodology | verified | adopt |
| `verify-result-row` | `40-methodology/verify-result-row.md` | methodology | verified | adopt |
| `counting-unit-first` | `40-methodology/counting-unit-first.md` | methodology | verified | adopt |
| `decision-sentence-first` | `40-methodology/decision-sentence-first.md` | methodology | verified | adopt |
| `routing-label-coverage` | `40-methodology/routing-label-coverage.md` | methodology | verified | adopt |
| `no-live-gui-verify` | `20-constraints/no-live-gui-verify.md` | constraints | verified | adopt |
| `telemetry-identity-axes` | `00-foundations/telemetry-identity-axes.md` | foundations | verified | — |
| `post-spawn-telemetry-gap` | `30-investigations/post-spawn-telemetry-gap.md` | investigations | verified | adopt |

## 간선

| from | to |
| --- | --- |
| `empty-query-first` | `do-not-retry` |
| `empty-query-first` | `no-live-gui-verify` |
| `empty-query-first` | `telemetry-identity-axes` |
| `empty-query-first` | `post-spawn-telemetry-gap` |
| `verify-result-row` | `empty-query-first` |
| `verify-result-row` | `counting-unit-first` |
| `verify-result-row` | `telemetry-identity-axes` |
| `verify-result-row` | `do-not-retry` |
| `counting-unit-first` | `verify-result-row` |
| `counting-unit-first` | `empty-query-first` |
| `counting-unit-first` | `telemetry-identity-axes` |
| `counting-unit-first` | `post-spawn-telemetry-gap` |
| `counting-unit-first` | `decision-sentence-first` |
| `counting-unit-first` | `routing-label-coverage` |
| `decision-sentence-first` | `counting-unit-first` |
| `decision-sentence-first` | `verify-result-row` |
| `decision-sentence-first` | `empty-query-first` |
| `routing-label-coverage` | `counting-unit-first` |
| `routing-label-coverage` | `verify-result-row` |
| `routing-label-coverage` | `telemetry-identity-axes` |
| `no-live-gui-verify` | `empty-query-first` |
| `no-live-gui-verify` | `do-not-retry` |
| `do-not-retry` | `empty-query-first` |
| `do-not-retry` | `no-live-gui-verify` |
| `telemetry-identity-axes` | `do-not-retry` |
| `telemetry-identity-axes` | `empty-query-first` |
| `telemetry-identity-axes` | `post-spawn-telemetry-gap` |
| `post-spawn-telemetry-gap` | `telemetry-identity-axes` |
| `post-spawn-telemetry-gap` | `empty-query-first` |
| `post-spawn-telemetry-gap` | `do-not-retry` |

## 허브

1판 기대: `do-not-retry` 와 `empty-query-first` 가 인바운드 상위. 허브가 기능 목록이면 구조가 틀린 것이다 — 이 위키의 첫 값은 **재시도하지 말 것과 조회를 의심하는 규칙**이다.

## 외부 앵커

| 위키 노트 | 원본 |
| --- | --- |
| `empty-query-first` | [v3/docs/install-attribution-utm-rate.md](../../../v3/docs/install-attribution-utm-rate.md) · [v3/docs/ga4-region-bridge-2026-08-21.md](../../../v3/docs/ga4-region-bridge-2026-08-21.md) · [docs/team-usage-overview-design-2026-08-21.md](../../team-usage-overview-design-2026-08-21.md) · [v3/functions/src/analyticsIdScheme.test.ts](../../../v3/functions/src/analyticsIdScheme.test.ts) |
| `verify-result-row` | [v3/functions/src/analyticsPurchase.ts](../../../v3/functions/src/analyticsPurchase.ts) · [v3/docs/ga4-ecommerce-unified-2026-08-24.md](../../../v3/docs/ga4-ecommerce-unified-2026-08-24.md) · [v3/docs/install-unified-view-2026-08-24.md](../../../v3/docs/install-unified-view-2026-08-24.md) |
| `counting-unit-first` | [v3/docs/post-spawn-telemetry-gap-2026-08-25.md](../../../v3/docs/post-spawn-telemetry-gap-2026-08-25.md) · [v3/functions/src/telemetryIdentityAxis.ts](../../../v3/functions/src/telemetryIdentityAxis.ts) · [v3/docs/install-unified-view-2026-08-24.md](../../../v3/docs/install-unified-view-2026-08-24.md) |
| `decision-sentence-first` | [v3/docs/admin-analytics-callable-migration-classification-2026-08-25.md](../../../v3/docs/admin-analytics-callable-migration-classification-2026-08-25.md) · [v3/docs/chart-data-integrity-2026-08-25.md](../../../v3/docs/chart-data-integrity-2026-08-25.md) · [v3/docs/admin-analytics-replan-2026-08-24.md](../../../v3/docs/admin-analytics-replan-2026-08-24.md) |
| `routing-label-coverage` | [v3/docs/routing/label-capture-audit-2026-08-10.md](../../../v3/docs/routing/label-capture-audit-2026-08-10.md) · [v3/docs/routing/shadow-serving-stub.md](../../../v3/docs/routing/shadow-serving-stub.md) · [v3/docs/live-orchestration-moat-review-2026-08-23.md](../../../v3/docs/live-orchestration-moat-review-2026-08-23.md) |
| `no-live-gui-verify` | [AGENTS.md](../../../AGENTS.md) |
| `do-not-retry` | [v3/docs/web-app-join-attribution-design-2026-08-09.md](../../../v3/docs/web-app-join-attribution-design-2026-08-09.md) · [v3/docs/pseudonym-retro-measurement-2026-08-21.md](../../../v3/docs/pseudonym-retro-measurement-2026-08-21.md) · [v3/docs/CONTROL-PLANE.md](../../../v3/docs/CONTROL-PLANE.md) |
| `telemetry-identity-axes` | [v3/docs/post-spawn-telemetry-gap-2026-08-25.md](../../../v3/docs/post-spawn-telemetry-gap-2026-08-25.md) · [v3/functions/src/telemetryIdentityAxis.ts](../../../v3/functions/src/telemetryIdentityAxis.ts) |
| `post-spawn-telemetry-gap` | [v3/docs/post-spawn-telemetry-gap-2026-08-25.md](../../../v3/docs/post-spawn-telemetry-gap-2026-08-25.md) · [v3/functions/src/postSpawnTelemetryGuard.ts](../../../v3/functions/src/postSpawnTelemetryGuard.ts) |
