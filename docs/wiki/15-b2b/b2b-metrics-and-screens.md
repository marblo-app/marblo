---
title: B2B 화면·지표 — 빈 상태부터 층화하여 의사결정에만 쓴다
tags: [domain/b2b, topic/analytics, topic/metrics, verdict/adopt]
status: verified
date: 2026-09-01
links: [[b2b-roadmap-phase-0-5]], [[b2b-team-label-layer]], [[enterprise-control-plane-positioning]], [[telemetry-data-model-map]], [[counting-unit-first]]
---

# B2B 화면·지표 — 빈 상태부터 층화하여 의사결정에만 쓴다

> **한 줄 판정**: ★채택 — B2B 분석은 모델 종합 점수나 직원 순위가 아니라, 복잡도별 모델 표와 **머지 티켓당 사용량 환산 비용(추정)**으로 좌석·예산·모델 정책을 판단한다. 첫날은 데이터가 아닌 빈 상태를 정직하게 보여 준다.

## 무엇을 물었나

조직 분석 화면이 관리자의 결정을 돕되 감시 도구·거짓 성공률·0으로 접힌 미수집 화면이 되지 않으려면 무엇을 계산하고 무엇을 빼야 하는가.

## 결과

- 계층은 L0 조직, L1 프로젝트, L2 사람이다. 팀은 L0 안의 소계이고 모델·에이전트는 표의 열/탭이지 새 행 계층이 아니다.
- 작업 효율의 정본은 기간 사용량 환산 비용 합 ÷ 머지 티켓 수다. 완료율·토큰당 머지·평균 소요시간은 결정을 흐리거나 게임될 수 있어 정본이 아니다.
- 모델 비교는 복잡도별 표 3개에서만 한다. 비율·몫은 n≥35, 중앙값은 n≥10, 합계는 표본 제한 없이 보이며 전기 비교는 양쪽 창이 통과해야 한다.
- 사람별 효율 순위·팀 평균 대비, 프롬프트/응답/코드 원문, 청구액, 서버가 모르는 열린 워크트리, 0행 `flow_executions`는 화면에서 제외한다.

### 빈 상태 규율

외부 조직·프로젝트가 0이면 `0`이라고 가장하지 않는다. 사용량은 게이트 사유, 머지는 `empty`와 웹훅 설치 CTA, 사람 축은 “적재 전(T0 이후)”과 `n/35`, 열린 워크트리는 `미수집`으로 구분한다. 현재 조직 인스턴스 0건은 이 규율을 증명하는 시작 상태다.

## 왜

한 점수로 모델을 순위화하면 복잡도 분포가 다른 팀을 섞어 심슨의 역설을 만들고, 직원 비교는 감시로 전환된다. 비용과 머지는 조직이 실제로 바꿀 수 있는 좌석·예산·모델 정책에 연결된다. 상태를 분리해야 아직 수집하지 않은 값, 접근 불가 값, 실제 영(0)을 다른 처방으로 다룰 수 있다.

## 한계 / 정직성

- 사람 축 성공률은 forward-only 각인 뒤에만 유효하다. 이전 익명 행을 백필하지 않는다.
- `flow_executions`는 원본 설계 시점 0행·호출부 0이므로 지표 근거가 아니다.
- 현재 수치는 고객 성과가 아니라 고객 조직 0건인 설계 기준이다.

## 실제 영향

문서 변경만. 새 차트 라이브러리나 BQ `org_id`/`team_id` 스키마 변경을 요구하지 않는다.

## Evidence

- [docs/org-analytics-metrics-and-screens-2026-08-31.md](../../org-analytics-metrics-and-screens-2026-08-31.md) — §2 화면, §4 모델 비교, §5 표본, §6 효율, §7 빈 상태.
- [docs/org-analytics-b2b-design-2026-08-31.md](../../org-analytics-b2b-design-2026-08-31.md) — 성공률 사람 축과 단계별 배선.

## Backlinks

- [[b2b-roadmap-phase-0-5]] — 어느 Phase에 어떤 화면이 켜지는가.
- [[b2b-team-label-layer]] — 팀을 L0 그룹핑으로만 쓰는 이유.
- [[enterprise-control-plane-positioning]] — Cost per Successful Task와 같은 지표의 포지셔닝 이름.
- [[telemetry-data-model-map]] — 사람 축의 데이터 경계.
- [[counting-unit-first]] — n≥35/n≥10을 적용하는 방법론.
