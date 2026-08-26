---
title: 링크 맵
tags: [meta/linkmap, status/living]
status: active
date: 2026-08-26
links: [[CONVENTION]], [[empty-query-first]], [[verify-result-row]], [[counting-unit-first]], [[decision-sentence-first]], [[routing-label-coverage]], [[wiki-write-at-merge]], [[no-live-gui-verify]], [[do-not-retry]], [[telemetry-identity-axes]], [[post-spawn-telemetry-gap]], [[WIKI-SKIP]], [[overview]], [[architecture]], [[glossary]], [[progress]], [[marblo-bot-messaging]], [[functions-deploy-env-and-bq-views]], [[release-cut-at-build]], [[github-app-install-after-deploy]], [[payment-live-key-pg-env-bundle]], [[ci-empty-steps-is-billing]], [[verify-without-gui]], [[human-only-ops-backlog]]
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
| `wiki-write-at-merge` | `40-methodology/wiki-write-at-merge.md` | methodology | active | adopt |
| `no-live-gui-verify` | `20-constraints/no-live-gui-verify.md` | constraints | verified | adopt |
| `telemetry-identity-axes` | `00-foundations/telemetry-identity-axes.md` | foundations | verified | — |
| `overview` | `00-foundations/overview.md` | foundations | active | — |
| `architecture` | `00-foundations/architecture.md` | foundations | active | — |
| `glossary` | `00-foundations/glossary.md` | foundations | active | — |
| `progress` | `00-foundations/progress.md` | foundations | active | snapshot |
| `post-spawn-telemetry-gap` | `30-investigations/post-spawn-telemetry-gap.md` | investigations | verified | adopt |
| `marblo-bot-messaging` | `10-offerings/marblo-bot-messaging.md` | offerings | draft | — |
| `functions-deploy-env-and-bq-views` | `50-operations/functions-deploy-env-and-bq-views.md` | operations | verified | — |
| `release-cut-at-build` | `50-operations/release-cut-at-build.md` | operations | verified | — |
| `github-app-install-after-deploy` | `50-operations/github-app-install-after-deploy.md` | operations | verified | — |
| `payment-live-key-pg-env-bundle` | `50-operations/payment-live-key-pg-env-bundle.md` | operations | verified | — |
| `ci-empty-steps-is-billing` | `50-operations/ci-empty-steps-is-billing.md` | operations | verified | — |
| `verify-without-gui` | `50-operations/verify-without-gui.md` | operations | verified | — |
| `human-only-ops-backlog` | `50-operations/human-only-ops-backlog.md` | operations | active | — |

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
| `wiki-write-at-merge` | `CONVENTION` |
| `wiki-write-at-merge` | `LINT` |
| `wiki-write-at-merge` | `WIKI-SKIP` |
| `wiki-write-at-merge` | `marblo-bot-messaging` |
| `wiki-write-at-merge` | `decision-sentence-first` |
| `wiki-write-at-merge` | `empty-query-first` |
| `no-live-gui-verify` | `empty-query-first` |
| `no-live-gui-verify` | `do-not-retry` |
| `do-not-retry` | `empty-query-first` |
| `do-not-retry` | `no-live-gui-verify` |
| `telemetry-identity-axes` | `do-not-retry` |
| `telemetry-identity-axes` | `empty-query-first` |
| `telemetry-identity-axes` | `post-spawn-telemetry-gap` |
| `telemetry-identity-axes` | `glossary` |
| `telemetry-identity-axes` | `overview` |
| `overview` | `glossary` |
| `overview` | `architecture` |
| `overview` | `progress` |
| `overview` | `telemetry-identity-axes` |
| `overview` | `do-not-retry` |
| `overview` | `empty-query-first` |
| `overview` | `verify-result-row` |
| `overview` | `counting-unit-first` |
| `overview` | `no-live-gui-verify` |
| `architecture` | `overview` |
| `architecture` | `glossary` |
| `architecture` | `progress` |
| `architecture` | `telemetry-identity-axes` |
| `glossary` | `overview` |
| `glossary` | `architecture` |
| `glossary` | `progress` |
| `glossary` | `telemetry-identity-axes` |
| `glossary` | `counting-unit-first` |
| `glossary` | `do-not-retry` |
| `progress` | `overview` |
| `progress` | `architecture` |
| `progress` | `glossary` |
| `progress` | `do-not-retry` |
| `progress` | `no-live-gui-verify` |
| `post-spawn-telemetry-gap` | `telemetry-identity-axes` |
| `post-spawn-telemetry-gap` | `empty-query-first` |
| `post-spawn-telemetry-gap` | `do-not-retry` |
| `marblo-bot-messaging` | `CONVENTION` |
| `functions-deploy-env-and-bq-views` | `empty-query-first` |
| `functions-deploy-env-and-bq-views` | `no-live-gui-verify` |
| `functions-deploy-env-and-bq-views` | `verify-without-gui` |
| `functions-deploy-env-and-bq-views` | `ci-empty-steps-is-billing` |
| `functions-deploy-env-and-bq-views` | `human-only-ops-backlog` |
| `release-cut-at-build` | `human-only-ops-backlog` |
| `release-cut-at-build` | `ci-empty-steps-is-billing` |
| `release-cut-at-build` | `verify-without-gui` |
| `github-app-install-after-deploy` | `functions-deploy-env-and-bq-views` |
| `github-app-install-after-deploy` | `human-only-ops-backlog` |
| `github-app-install-after-deploy` | `verify-without-gui` |
| `payment-live-key-pg-env-bundle` | `functions-deploy-env-and-bq-views` |
| `payment-live-key-pg-env-bundle` | `human-only-ops-backlog` |
| `payment-live-key-pg-env-bundle` | `verify-without-gui` |
| `ci-empty-steps-is-billing` | `verify-without-gui` |
| `ci-empty-steps-is-billing` | `release-cut-at-build` |
| `ci-empty-steps-is-billing` | `empty-query-first` |
| `ci-empty-steps-is-billing` | `human-only-ops-backlog` |
| `verify-without-gui` | `no-live-gui-verify` |
| `verify-without-gui` | `empty-query-first` |
| `verify-without-gui` | `ci-empty-steps-is-billing` |
| `verify-without-gui` | `functions-deploy-env-and-bq-views` |
| `human-only-ops-backlog` | `github-app-install-after-deploy` |
| `human-only-ops-backlog` | `release-cut-at-build` |
| `human-only-ops-backlog` | `payment-live-key-pg-env-bundle` |
| `human-only-ops-backlog` | `ci-empty-steps-is-billing` |
| `human-only-ops-backlog` | `verify-without-gui` |
| `human-only-ops-backlog` | `functions-deploy-env-and-bq-views` |
| `human-only-ops-backlog` | `no-live-gui-verify` |

## 허브

1판 기대: `do-not-retry` 와 `empty-query-first` 가 인바운드 상위. 2026-08-26 입구 4장(`overview` · `architecture` · `glossary` · `progress`)이 기반 허브로 추가됐다. 허브가 기능 목록이면 구조가 틀린 것이다 — 이 위키의 첫 값은 **재시도하지 말 것, 조회를 의심하는 규칙, 같은 말을 가르는 글로서리**다.

## 외부 앵커

| 위키 노트 | 원본 |
| --- | --- |
| `empty-query-first` | [v3/docs/install-attribution-utm-rate.md](../../../v3/docs/install-attribution-utm-rate.md) · [v3/docs/ga4-region-bridge-2026-08-21.md](../../../v3/docs/ga4-region-bridge-2026-08-21.md) · [docs/team-usage-overview-design-2026-08-21.md](../../team-usage-overview-design-2026-08-21.md) · [v3/functions/src/analyticsIdScheme.test.ts](../../../v3/functions/src/analyticsIdScheme.test.ts) |
| `verify-result-row` | [v3/functions/src/analyticsPurchase.ts](../../../v3/functions/src/analyticsPurchase.ts) · [v3/docs/ga4-ecommerce-unified-2026-08-24.md](../../../v3/docs/ga4-ecommerce-unified-2026-08-24.md) · [v3/docs/install-unified-view-2026-08-24.md](../../../v3/docs/install-unified-view-2026-08-24.md) |
| `counting-unit-first` | [v3/docs/post-spawn-telemetry-gap-2026-08-25.md](../../../v3/docs/post-spawn-telemetry-gap-2026-08-25.md) · [v3/functions/src/telemetryIdentityAxis.ts](../../../v3/functions/src/telemetryIdentityAxis.ts) · [v3/docs/install-unified-view-2026-08-24.md](../../../v3/docs/install-unified-view-2026-08-24.md) |
| `decision-sentence-first` | [v3/docs/admin-analytics-callable-migration-classification-2026-08-25.md](../../../v3/docs/admin-analytics-callable-migration-classification-2026-08-25.md) · [v3/docs/chart-data-integrity-2026-08-25.md](../../../v3/docs/chart-data-integrity-2026-08-25.md) · [v3/docs/admin-analytics-replan-2026-08-24.md](../../../v3/docs/admin-analytics-replan-2026-08-24.md) |
| `routing-label-coverage` | [v3/docs/routing/label-capture-audit-2026-08-10.md](../../../v3/docs/routing/label-capture-audit-2026-08-10.md) · [v3/docs/routing/shadow-serving-stub.md](../../../v3/docs/routing/shadow-serving-stub.md) · [v3/docs/live-orchestration-moat-review-2026-08-23.md](../../../v3/docs/live-orchestration-moat-review-2026-08-23.md) |
| `wiki-write-at-merge` | [docs/wiki/_meta/check_wiki_freshness.py](check_wiki_freshness.py) · [docs/wiki/_meta/lint_wiki.py](lint_wiki.py) · [docs/WIKI_system/WIKI-SKills.md](../../WIKI_system/WIKI-SKills.md) · [v3/electron/mcp-server/wiki-maintenance.ts](../../../v3/electron/mcp-server/wiki-maintenance.ts) · [v3/src/lib/botDefinition.ts](../../../v3/src/lib/botDefinition.ts) |
| `no-live-gui-verify` | [AGENTS.md](../../../AGENTS.md) |
| `do-not-retry` | [v3/docs/web-app-join-attribution-design-2026-08-09.md](../../../v3/docs/web-app-join-attribution-design-2026-08-09.md) · [v3/docs/pseudonym-retro-measurement-2026-08-21.md](../../../v3/docs/pseudonym-retro-measurement-2026-08-21.md) · [v3/docs/CONTROL-PLANE.md](../../../v3/docs/CONTROL-PLANE.md) |
| `telemetry-identity-axes` | [v3/docs/post-spawn-telemetry-gap-2026-08-25.md](../../../v3/docs/post-spawn-telemetry-gap-2026-08-25.md) · [v3/functions/src/telemetryIdentityAxis.ts](../../../v3/functions/src/telemetryIdentityAxis.ts) |
| `overview` | [v3/docs/CONTROL-PLANE.md](../../../v3/docs/CONTROL-PLANE.md) · [v3/docs/COMMUNICATION-ARCHITECTURE.md](../../../v3/docs/COMMUNICATION-ARCHITECTURE.md) |
| `architecture` | [v3/docs/COMMUNICATION-ARCHITECTURE.md](../../../v3/docs/COMMUNICATION-ARCHITECTURE.md) · [v3/electron/bridge-server.ts](../../../v3/electron/bridge-server.ts) · [docs/supported-harnesses-and-architecture.md](../../supported-harnesses-and-architecture.md) |
| `glossary` | [docs/payment/toss-teardown-prerequisites.md](../../payment/toss-teardown-prerequisites.md) · [v3/functions/src/telemetryIdentityAxis.ts](../../../v3/functions/src/telemetryIdentityAxis.ts) · [v3/electron/model-registry.ts](../../../v3/electron/model-registry.ts) |
| `progress` | [v3/docs/CONTROL-PLANE.md](../../../v3/docs/CONTROL-PLANE.md) · [marblo-web/src/lib/paymentProvider.ts](../../../marblo-web/src/lib/paymentProvider.ts) |
| `post-spawn-telemetry-gap` | [v3/docs/post-spawn-telemetry-gap-2026-08-25.md](../../../v3/docs/post-spawn-telemetry-gap-2026-08-25.md) · [v3/functions/src/postSpawnTelemetryGuard.ts](../../../v3/functions/src/postSpawnTelemetryGuard.ts) |
| `marblo-bot-messaging` | [v3/src/lib/botDefinition.ts](../../../v3/src/lib/botDefinition.ts) · [v3/src/services/botDefinitionService.ts](../../../v3/src/services/botDefinitionService.ts) · [v3/src/components/agents/MarbloBotGallery.tsx](../../../v3/src/components/agents/MarbloBotGallery.tsx) · [v3/electron/assistant-triggers.ts](../../../v3/electron/assistant-triggers.ts) · [v3/docs/assistant-tab-design-2026-08-24.md](../../../v3/docs/assistant-tab-design-2026-08-24.md) · [marblo-web/docs/beta-launch/YOUTUBE-SCRIPT.md](../../../marblo-web/docs/beta-launch/YOUTUBE-SCRIPT.md) |
| `functions-deploy-env-and-bq-views` | [v3/functions/scripts/check-deploy-env.mjs](../../../v3/functions/scripts/check-deploy-env.mjs) · [v3/docs/install-unified-view-2026-08-24.md](../../../v3/docs/install-unified-view-2026-08-24.md) |
| `release-cut-at-build` | [v3/docs/electron_updater_runbook.md](../../../v3/docs/electron_updater_runbook.md) · [v3/docs/signing_runbook.md](../../../v3/docs/signing_runbook.md) |
| `github-app-install-after-deploy` | [v3/docs/github-app-registration-values-2026-08-21.md](../../../v3/docs/github-app-registration-values-2026-08-21.md) |
| `payment-live-key-pg-env-bundle` | [docs/payment/portone-v2-phase1-checklist.md](../../payment/portone-v2-phase1-checklist.md) · [v3/functions/src/billing.ts](../../../v3/functions/src/billing.ts) |
| `ci-empty-steps-is-billing` | [v3/docs/github-org-migration-plan.md](../../../v3/docs/github-org-migration-plan.md) |
| `verify-without-gui` | [AGENTS.md](../../../AGENTS.md) · [v3/functions/package.json](../../../v3/functions/package.json) · [marblo-web/package.json](../../../marblo-web/package.json) |
| `human-only-ops-backlog` | [v3/docs/github-app-registration-values-2026-08-21.md](../../../v3/docs/github-app-registration-values-2026-08-21.md) · [AGENTS.md](../../../AGENTS.md) |
