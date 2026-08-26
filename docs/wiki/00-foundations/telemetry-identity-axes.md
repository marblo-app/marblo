---
title: userId 는 표마다 다른 사람이다
tags: [domain/foundations, topic/identity, topic/observability, topic/bigquery]
status: verified
date: 2026-08-25
links: [[do-not-retry]], [[empty-query-first]], [[post-spawn-telemetry-gap]], [[routing-label-coverage]], [[glossary]], [[overview]], [[architecture]]
---

# userId 는 표마다 다른 사람이다

> **한 줄 판정**: ★채택 — `events`/`task_outcomes`/`agent_heartbeats` 의 `userId` 는 설치 clientId(36자 42명)이고 `cost_logs.userId` 는 Firebase uid(28자 5명)다. 같은 이름으로 조인하면 사람이 아니다.

## 무엇을 물었나

표 네 개의 `userId` 를 한 키로 가로질러도 되는가. 안 되면 컬럼을 어떻게 부를 것인가.

## 무엇을 했나

2026-08-25 BQ 실측으로 길이별 사람 수를 세고, writer 코드를 읽었다. events 는 `e.clientId`, cost_logs 는 `context.auth.uid`. 개명 안은 코드 상수로 고정했고 프로덕션 ALTER 는 하지 않았다.

## 결과 (수치)

| 표 | 축 | 36자 | 28자 | 그 외 |
| --- | --- | ---: | ---: | ---: |
| events | install clientId | 42명 / 399,600행 | 1명 / 12,822행 | 14자 1명 / 49행 |
| task_outcomes | install clientId | 7명 / 1,462행 | 0 | 0 |
| agent_heartbeats | install clientId | 14명 / 12,528,710행 | 1명 / 205,192행 | 0 |
| cost_logs | Firebase uid | 0 | 5명 / 390,287행 | 0 |

표본: 전 표 전 기간, 측정일 2026-08-25. 유의성은 사람 수 그대로다. 퍼센트로 접지 않는다.

개명 안: `installClientId` (앞 세 표) · `firebaseUid` (`cost_logs`). 새 표에 `userId` 를 쓰지 않는다.

## 왜

writer 가 다르다. 익명 설치 여정은 clientId 를 `userId` 칸에 넣고, 비용 원장은 로그인 uid 를 같은 칸 이름에 넣는다. 이름이 같아서 조인 쿼리가 컴파일된다. 결과는 빈 집합이거나 우연의 28자 오염이다.

## 한계 / 정직성

- 28자 행이 events/heartbeats 에 남아 있다. 2026-06-13 이전 스킴이다. 그 행을 uid 축과 잇는 것은 [[do-not-retry]] M2.
- 길이만으로 사람 동치가 아니다. 36자끼리만 같은 축이다.
- **수치가 갈리면 원본 측정 문서가 옳다.**

## 실제 영향

코드에 축 가드가 생겼다. `canJoinUserId('events','cost_logs')` 는 false. 미인증 비용은 cost_logs 에 0행 — 콜러블이 uid 를 요구한다. 기업 비용 대시보드가 cost_logs 를 사람 축으로 쓰면 전제가 바뀐다.

## Evidence

- [v3/docs/post-spawn-telemetry-gap-2026-08-25.md](../../../v3/docs/post-spawn-telemetry-gap-2026-08-25.md)
- [v3/functions/src/telemetryIdentityAxis.ts](../../../v3/functions/src/telemetryIdentityAxis.ts)
- [v3/functions/src/analyticsIdScheme.ts](../../../v3/functions/src/analyticsIdScheme.ts)

## Backlinks

- [[do-not-retry]] · [[empty-query-first]] · [[post-spawn-telemetry-gap]] · [[verify-result-row]] · [[counting-unit-first]] · [[routing-label-coverage]] · [[glossary]] · [[overview]] · [[architecture]]
