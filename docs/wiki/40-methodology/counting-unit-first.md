---
title: 세는 단위를 먼저 적어라
tags: [domain/methodology, topic/observability, topic/identity, topic/attribution, verdict/adopt, method/query-audit]
status: verified
date: 2026-08-29
links: [[verify-result-row]], [[empty-query-first]], [[telemetry-identity-axes]], [[post-spawn-telemetry-gap]], [[decision-sentence-first]], [[routing-label-coverage]], [[telemetry-data-model-map]]
---

# 세는 단위를 먼저 적어라

> **한 줄 판정**: ★채택 — 비율이나 합계보다 먼저 "설치 1행, 사람 1명, 이벤트 1건, 결제 1건" 중 무엇을 세는지 적어야 한다.

## 무엇을 물었나

같은 숫자라도 설치 행, 사람, 이벤트, 결제 중 무엇을 분모로 삼는지 먼저 고정하지 않으면 어떤 오진이 생기는가.

## 무엇을 했나

오늘 나온 설치/사람/결제/차트 오진을 세는 단위 문제로 묶었다. 원문 수치와 표본 크기는 위키로 옮기지 않고 Evidence가 가리키는 원본에 둔다.

## 규칙

모든 집계 문장 앞에 다음 형식을 붙인다.

| 말하기 전 적을 것 | 예 |
| --- | --- |
| 관측 단위 | 설치 행 / 사람 / 이벤트 / 결제 / 계정 |
| 분모 | 재설치 포함 여부, 중복 제거 키, 기간, 프로젝트, 데이터셋 |
| 분자 | 성공, 전환, 결제, grant, paid, 콜러블 같은 상태의 직접 근거 컬럼 |
| 브리지 | 사람과 설치, 설치와 이벤트, 결제와 계정을 잇는 키가 무엇인지 |
| 중복 정책 | 같은 사람이 여러 브라우저/재설치/세션을 만든 경우 어떻게 세는지 |

"설치 첫스폰 비율", "사람-설치 다리", "매출 링크", "CAC 콜러블" 같은 말은 모두 단위가 다르다. 같은 표에서 나왔다는 이유로 서로의 분모를 빌려 쓰지 않는다.

2026-08-26 정정: `first run 577 → first spawn 18 = 3.1%` 는 신뢰할 수 있는 활성화율이 아니다. 분자는 인증 게이트에서 끊기고, 분모는 재설치를 거르지 않는다. 위키에서는 이 값을 단독 사실로 인용하지 않는다.

2026-08-26 정정: 외부 실매출로 보였던 결제 1건은 운영자 포트원 이니시스 테스트 결제였다. 외부 실매출은 없는 것으로 본다. 이 행을 외부 수요 증거로 쓰지 않는다.

## 왜

재설치 루프나 여러 브라우저는 설치 행을 늘린다. 사람 축은 그 행들을 접는다. 결제 축은 다시 운영자/외부, 테스트/실거래, grant/paid 성격을 나눈다. 단위를 먼저 쓰지 않으면 [[verify-result-row]] 를 통과한 행도 집계 단계에서 다른 의미가 된다.

## 한계 / 정직성

- 이 노트는 수치 노트가 아니라 방법론 노트다. 오늘 발견의 정확한 값은 원본 문서와 쿼리가 갖는다.
- 단위를 먼저 적는다고 축 연결이 자동으로 맞지는 않는다. 브리지 키와 null 정책은 원본 설계나 코드 주석에서 다시 확인해야 한다.
- 위키에는 금액, 결제키, 원시 uid, API 키, 서비스 계정 값을 쓰지 않는다.

## 실제 영향

차트나 표를 해석할 때 첫 문장을 "나는 무엇을 1개로 세고 있는가"로 시작한다. 그 문장을 못 쓰면 쿼리나 화면을 더 보기 전까지 결론을 쓰지 않는다.

## Evidence

- [v3/docs/post-spawn-telemetry-gap-2026-08-25.md](../../../v3/docs/post-spawn-telemetry-gap-2026-08-25.md) — 설치 행과 사람 축이 갈라지는 사례 원본
- [v3/functions/src/telemetryIdentityAxis.ts](../../../v3/functions/src/telemetryIdentityAxis.ts) — 익명/설치/사람 축 경계 구현
- [v3/docs/install-unified-view-2026-08-24.md](../../../v3/docs/install-unified-view-2026-08-24.md) — 설치 통합 뷰 원본

## Backlinks

- [[verify-result-row]] · [[empty-query-first]] · [[telemetry-identity-axes]] · [[post-spawn-telemetry-gap]] · [[decision-sentence-first]] · [[routing-label-coverage]] · [[glossary]] · [[overview]] · [[do-not-silently-drop-missing-join-targets]] · [[2026-kpi-targets-pressure-test]] · [[sole-persistent-user-is-not-external]] · [[shared-project-retention-confounded-with-internality]]
- [[telemetry-data-model-map]] — 표마다 행 1 이 무엇인지(grain) 적어 둔 지도
