---
title: 조회 결과가 있어도 그게 네가 생각한 그 행인지 확인하라
tags: [domain/methodology, topic/observability, topic/verification, topic/bigquery, verdict/adopt, method/query-audit, method/source-link]
status: verified
date: 2026-08-29
links: [[empty-query-first]], [[counting-unit-first]], [[telemetry-identity-axes]], [[do-not-retry]], [[decision-sentence-first]], [[routing-label-coverage]]
---

# 조회 결과가 있어도 그게 네가 생각한 그 행인지 확인하라

> **한 줄 판정**: ★채택 — 빈 조회만 위험한 것이 아니다. 행이 나왔을 때도 그 행의 사람, 계정, 결제 성격, 이벤트 축을 확인하지 않으면 "있는 증거"로 틀린 결론을 만든다.

## 무엇을 물었나

조회 결과가 존재하면 곧바로 해석해도 되는가, 아니면 그 결과가 내가 말하는 대상의 행인지 먼저 확인해야 하는가.

## 무엇을 했나

당일 오진들을 원문 복사 없이 방법론으로 묶었다. 공통점은 조회가 비지 않았는데도 행 정체를 확인하지 않고 결론을 쓴 것이다.

## 규칙

행이 있으면 아래를 먼저 적는다.

| 확인할 것 | 왜 |
| --- | --- |
| 이 행의 주어 | 사람, 계정, 설치, 이벤트, 결제 중 무엇인가 |
| 이 행의 성격 | 운영자/외부, 테스트/실거래, grant/paid 같은 축이 섞였는가 |
| 이 행의 근거 컬럼 | 내가 말하는 결론을 직접 뜻하는 컬럼인가, 편의상 붙은 다른 축인가 |
| 행 하나 원문 확인 | 집계 전에 샘플 1행을 열어 사람이 다른지, 계정이 다른지, 결제 성격이 다른지 본다 |
| 화면-표 대조 | 대시보드 분류와 원장/표 분류가 같은 축을 쓰는지 맞춘다 |

특히 `account_class` 같은 이름은 결제 채널 판정처럼 보일 수 있다. 하지만 결제 테스트/실거래 축은 결제 시점 원장에 남긴 파생 enum만 믿어야 한다. 운영자 계정 축을 PG 테스트키 축으로 읽지 않는다.

2026-08-26 정정: 외부 실매출로 보였던 결제 1건은 운영자 포트원 이니시스 테스트 결제였다. 행이 존재해도 운영자/외부, 테스트/실거래 성격을 확인하지 않으면 매출 증거가 아니다.

## 왜

빈 결과는 [[empty-query-first]] 로 잡힌다. 반대로 결과가 있으면 사람은 안심하고 해석부터 한다. 이때 한 행만 열어보면 끝나는 착각이 집계, 차트, 광고 의사결정으로 증폭된다.

## 한계 / 정직성

- 이 노트는 당일 관찰된 오진을 절차로 일반화한 것이다. 사건별 원시 수치와 실제 행 내용은 원본이 갖는다.
- 결제·계정·사람 축은 시점별로 구현이 바뀔 수 있다. 위키는 컬럼 의미를 고정하지 않고 "컬럼 주석과 원장을 읽어라"는 규칙만 고정한다.
- 값, 결제 식별자, 크레덴셜, 원시 uid 는 위키에 적지 않는다.

## 실제 영향

조회 결과가 있을 때도 결론 전에 "이 행은 무엇의 1행인가"를 쓴다. 외부 매출, grant/paid 덮어쓰기, CAC 콜러블 같은 말은 최소 1행 원문과 화면-표 대조를 통과한 뒤에만 쓴다.

## Evidence

- [v3/functions/src/analyticsPurchase.ts](../../../v3/functions/src/analyticsPurchase.ts) — `account_class` 는 PG 테스트키 판정이 아니라 계정 축이라는 주석
- [v3/docs/ga4-ecommerce-unified-2026-08-24.md](../../../v3/docs/ga4-ecommerce-unified-2026-08-24.md) — 결제/이커머스 축 원본
- [v3/docs/install-unified-view-2026-08-24.md](../../../v3/docs/install-unified-view-2026-08-24.md) — 설치/이벤트 통합 뷰 원본

## Backlinks

- [[empty-query-first]] · [[counting-unit-first]] · [[telemetry-identity-axes]] · [[do-not-retry]] · [[decision-sentence-first]] · [[routing-label-coverage]] · [[overview]] · [[artifact-scope-boundary]] · [[do-not-silently-drop-missing-join-targets]]
