---
title: 조회가 비면 대상이 아니라 조회를 먼저 의심하라
tags: [domain/methodology, topic/observability, topic/bigquery, topic/identity, verdict/adopt, method/query-audit]
status: verified
date: 2026-08-24
links: [[do-not-retry]], [[no-live-gui-verify]], [[telemetry-identity-axes]], [[post-spawn-telemetry-gap]], [[decision-sentence-first]], [[telemetry-data-model-map]]
---

# 조회가 비면 대상이 아니라 조회를 먼저 의심하라

> **한 줄 판정**: ★채택 — 2026-08-24 하루에만 같은 교훈이 **4번** 재발견됐다. 빈 결과는 "데이터/키가 없다"가 아니라 **프로젝트 · 리전 · 표 · env 이름**이 틀린 경우가 기본값이다.

## 무엇을 물었나

빈 조회를 보고 "대상이 없다"고 결론 내려도 되는가, 아니면 조회 자체를 먼저 검증해야 하는가.

## 무엇을 했나

원본을 복사하지 않고, 하루 안의 네 사건을 같은 패턴으로 묶었다. 각 사건의 수치와 표 이름은 원본에 있고 갈리면 원본이 옳다.

## 결과 (수치)

| # | 사건 | 빈 것처럼 보인 것 | 실제 조회 오류 | 근거 단위 |
| --- | --- | --- | --- | --- |
| 1 | gen1 env | "키 없음" | env 값을 **빈 문자열로 읽음**. 키가 없는 것과 빈 문자열은 다르다 | 당일 문장, 테스트 픽스처 1건 |
| 2 | `analytics_user_install` | 사람 축이 비었다 | 사람 축은 링크표가 아니다. 계정 뷰가 링크표를 읽으면 안 된다. 파생표 4개가 **0행**인 상태에서 링크표를 의심하면 축을 섞는다 | 파생표 0행 · 금지 목록에 데이터셋 이름 등장 |
| 3 | BQ 리전 | 조인 결과가 비었다 | GA4 export = `asia-northeast3`, `marblo_telemetry` = `US`. BQ는 **한 쿼리에서 리전이 다른 데이터셋을 참조하지 못한다**. 권한을 열어도 안 된다 | 리전 2개 · 프로젝트 `marblo-2253d` |
| 4 | 테스트 러너 | 화면/케이스가 안 보인다 | `playwright test` 로 Electron 을 띄우면 사장님 창과 충돌하고, 빈 화면을 "기능 없음"으로 읽게 된다. 증명은 vitest | 2026-08-24 강제 종료 1회 |

보조 수치 (유입 조회 런북, 원본 한 줄):

- 설치 유입 쿼리의 기본 의심 순서: 프로젝트 `marblo-2253d` → 데이터셋 `marblo_telemetry` → 리전 `US` → 날짜 필터.
- `analytics_identity` 스냅샷: 593행 / non-null `ga_key` 550 / distinct `ga_key` **3**. `ga_key` 가 있다고 `joined` 가 아니다 ([[do-not-retry]] DNR-05).

표본: 당일 재발견 **n=4**. 유의성 검정이 아니라 **반복 패턴**이다. 같은 실수가 하루 4번이면 개인 실수가 아니라 방법론 공백이다.

## 왜

빈 결과는 두 가설을 동시에 만족한다. (A) 대상이 없다 (B) 조회가 다른 곳을 본다. (B)의 비용이 훨씬 싼데 (A)로 건너뛰면 없는 기능을 만들거나, 있는 키를 재발급하거나, 사람 축을 링크표로 조인한다.

## 한계 / 정직성

- n=4 는 당일 오케 관측 + 원본 문서 교차다. 전수 조사가 아니다.
- "gen1 env" 의 원 사고 로그는 테스트 픽스처 문장으로만 남았다. 빈 문자열 vs unset 의 런타임 스택 트레이스는 이 노트에 없다.
- 리전 제약과 0행 파생표는 원본 날짜(2026-08-21) 스냅샷이다. **수치가 갈리면 원본이 옳다.**

## 실제 영향

방법론 채택. 코드 무변경. 이후 빈 조회를 보는 에이전트는 (1) 프로젝트 (2) 리전 (3) 표/뷰 이름 (4) 날짜 필터 (5) env 빈 문자열 여부를 원본 경로에서 확인한 뒤에야 "없다"고 쓴다.

## Evidence

- [v3/docs/install-attribution-utm-rate.md](../../../v3/docs/install-attribution-utm-rate.md) — "결과가 비면 대상이 아니라 조회를 먼저 의심한다"
- [v3/docs/ga4-region-bridge-2026-08-21.md](../../../v3/docs/ga4-region-bridge-2026-08-21.md) — 리전 불일치
- [docs/team-usage-overview-design-2026-08-21.md](../../../docs/team-usage-overview-design-2026-08-21.md) — `analytics_user_install` 등장 금지
- [v3/docs/pseudonym-retro-measurement-2026-08-21.md](../../../v3/docs/pseudonym-retro-measurement-2026-08-21.md) — 파생표 0행
- [v3/functions/src/analyticsIdScheme.test.ts](../../../v3/functions/src/analyticsIdScheme.test.ts) — `ga_key` ≠ `joined`
- [v3/tests/unit/work-chain-capture.test.ts](../../../v3/tests/unit/work-chain-capture.test.ts) — gen1 env 빈 문자열 문장(`FALSE_POSITIVES_16` 코퍼스 안의 오케 실제 발화). ★2026-09-04: 이 파일에 워크체인 포착 회귀가 추가되며 크게 늘었지만 이 문장 자체는 그대로다 — 판정도 그대로다
- [AGENTS.md](../../../AGENTS.md) — GUI 검증 금지 (러너 사건)

## Backlinks

- [[do-not-retry]] · [[no-live-gui-verify]] · [[telemetry-identity-axes]] · [[post-spawn-telemetry-gap]] · [[verify-result-row]] · [[counting-unit-first]] · [[decision-sentence-first]] · [[wiki-write-at-merge]] · [[overview]] · [[functions-deploy-env-and-bq-views]] · [[ci-empty-steps-is-billing]] · [[verify-without-gui]]
- [[telemetry-data-model-map]] — 0행이 나오는 링크표·뷰 게이트의 지도
- [[control-must-differ-on-the-tested-axis]] — 같은 계열의 조용한 오독: 무효한 대조를 배제 근거로 읽는다
- [[count-callers-before-closing-a-gate]] — 호출자 census 도 같은 규율이다: 감사·설계 문서의 목록이 완전하다고 가정하지 않는다
- [[name-the-actor-not-just-the-resource]] — 같은 계열: 관측이 자기가 검증할 가정을 이미 전제로 깔고 있으면 답을 줄 수 없다
