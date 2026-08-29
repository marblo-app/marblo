---
title: 지표 전에 결정 문장을 먼저 써라
tags: [domain/methodology, topic/observability, topic/bigquery, verdict/adopt, method/query-audit]
status: verified
date: 2026-08-29
links: [[counting-unit-first]], [[verify-result-row]], [[empty-query-first]]
---

# 지표 전에 결정 문장을 먼저 써라

> **한 줄 판정**: ★채택 — "이 값이 X면 우리는 Y를 한다"를 한 줄로 못 쓰는 지표는 대시보드 헤드라인이나 콜러블 정본으로 승격하지 않는다.

## 무엇을 물었나

어드민 분석 콜러블과 차트를 통합 뷰로 옮길 때, 어떤 지표를 남기고 어떤 지표를 버릴 것인가.

## 무엇을 했나

콜러블마다 세는 단위와 행동 문장을 대조한 원본 문서를 읽었다. 설치 1행이 아닌 값을 `v_install_unified`로 억지 이관하지 않는다는 규칙만 위키로 뽑고, 콜러블별 표는 원본에 둔다.

## 규칙

| 확인할 것 | 남기는 기준 |
| --- | --- |
| 결정 문장 | "이 값이 X면 우리는 Y를 한다"가 제품·운영 행동으로 이어져야 한다 |
| 세는 단위 | 설치, 이벤트, 사람, 계정, 결제 원장 중 무엇인지 먼저 적는다 |
| 정본 소스 | 같은 축의 원장·뷰·콜러블인지 확인한다 |
| 화면 호출성 | 실제 화면 호출이 없으면 헤드라인 지표가 아니라 삭제·보류 후보로 둔다 |
| 대조값 | 기존 경로와 새 경로가 다르면 불일치가 정상인지, 버그인지 문장으로 적는다 |

값을 설명할 수 있어도 행동을 만들지 못하면 노이즈다. 반대로 운영 이상 감지처럼 사업 지표가 아니어도 행동 문장이 있으면 운영 탭에는 남을 수 있다.

## 왜

대시보드는 숫자를 많이 보여주는 곳이 아니라 다음 결정을 줄이는 곳이다. 단위가 다른 값을 한 통합 뷰로 몰면 [[counting-unit-first]] 를 어기고, 행 성격을 안 보면 [[verify-result-row]] 를 어긴다.

## 한계 / 정직성

- 이 노트는 콜러블 삭제 목록이 아니다. 삭제·보류 판단은 원본 분류표와 실제 호출 지점이 갖는다.
- 표본이 한 자릿수인 지표는 방향 판단용으로만 둔다. 분모가 찰 때까지 사업 결론으로 쓰지 않는다.
- 수치가 갈리면 원본 문서가 옳다.

## 실제 영향

새 분석 지표를 만들 때 PR 설명에 결정 문장, 단위, 정본 소스, 화면 호출 여부를 같이 쓴다. 이 네 가지가 없으면 위키나 대시보드에 올리지 않는다.

## Evidence

- [v3/docs/admin-analytics-callable-migration-classification-2026-08-25.md](../../../v3/docs/admin-analytics-callable-migration-classification-2026-08-25.md)
- [v3/docs/chart-data-integrity-2026-08-25.md](../../../v3/docs/chart-data-integrity-2026-08-25.md)
- [v3/docs/admin-analytics-replan-2026-08-24.md](../../../v3/docs/admin-analytics-replan-2026-08-24.md)

## Backlinks

- [[counting-unit-first]] · [[verify-result-row]] · [[empty-query-first]] · [[wiki-write-at-merge]] · [[artifact-scope-boundary]] · [[do-not-silently-drop-missing-join-targets]]
