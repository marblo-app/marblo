---
title: 라우팅 라벨은 액션축과 결과축을 분리한다
tags: [domain/methodology, topic/observability, topic/routing, topic/bigquery, verdict/adopt, method/query-audit]
status: verified
date: 2026-08-26
links: [[counting-unit-first]], [[verify-result-row]], [[telemetry-identity-axes]]
---

# 라우팅 라벨은 액션축과 결과축을 분리한다

> **한 줄 판정**: ★채택 — 모델 라우팅 학습 로그는 `model@effort` 액션축, 실제 결과축, 비용 커버리지를 따로 보존해야 한다. 누락 비용을 숫자 0으로 접지 않는다.

## 무엇을 물었나

"어떤 태스크 특징에서 어떤 모델 칸을 골랐고 결과가 어땠나"를 학습셋으로 만들 수 있는가.

## 무엇을 했나

라우팅 라벨 캡처 감사를 읽고 재사용 규칙만 뽑았다. 구체 갭 번호와 쿼리는 원본에 둔다.

## 규칙

| 축 | 보존할 것 | 금지 |
| --- | --- | --- |
| 액션 | 선택한 `model@effort`, 후보 `model@effort` 집합, 선택 모드 | 하네스 이름만으로 비용 칸을 대표하기 |
| 결과 | 최신 터미널 결과, 귀책, 소요, 산출 여부 | 진행 중 행을 실패나 성공에 섞기 |
| 비용 | 태스크 단위 롤업과 커버리지 | 비용 누락을 숫자 0으로 합산하기 |
| 탐색 | explore/tie-rotate 여부 | 탐색 로그를 순수 최적 선택처럼 학습시키기 |
| 조인 | 익명 세계 내부 키와 계정 원장 키 구분 | `cost_logs` 계정 uid를 익명 이벤트 라벨에 직접 조인하기 |

특히 성과표는 "분모에서 제외한 행 수"를 같이 말해야 한다. 0은 값이고, 없음은 커버리지 문제다.

## 왜

라우팅은 선택하지 않은 후보의 결과를 모른다. 선택 로그 안에서도 일부 행은 탐색이고, 결과 표는 effort 해상도를 잃을 수 있으며, 비용 롤업은 누락될 수 있다. 이 셋을 분리하지 않으면 모델이 좋아진 것이 아니라 기록이 섞인 것일 수 있다.

## 한계 / 정직성

- 이 노트는 학습을 시작하라는 판단이 아니다. 표본이 얇으면 모델이 아니라 배관만 만든다.
- 로컬 라우팅 그래프와 BigQuery 로그는 같은 저장소가 아니다. 재현 가능한 학습셋인지 별도로 확인한다.
- 수치가 갈리면 원본 감사 문서가 옳다.

## 실제 영향

라우팅·벤치·모델 비용 분석은 액션축, 결과축, 비용 커버리지를 별도 열로 둔다. `successPerDollar` 같은 파생값은 커버리지가 충분할 때만 해석한다.

## Evidence

- [v3/docs/routing/label-capture-audit-2026-08-10.md](../../../v3/docs/routing/label-capture-audit-2026-08-10.md)
- [v3/docs/routing/shadow-serving-stub.md](../../../v3/docs/routing/shadow-serving-stub.md)
- [v3/docs/live-orchestration-moat-review-2026-08-23.md](../../../v3/docs/live-orchestration-moat-review-2026-08-23.md)

## Backlinks

- [[counting-unit-first]] · [[verify-result-row]] · [[telemetry-identity-axes]]
