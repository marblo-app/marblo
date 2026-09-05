---
title: 스폰 이후 종료가 샌다
tags: [domain/investigations, topic/observability, topic/identity, topic/bigquery, verdict/adopt]
status: verified
date: 2026-08-25
links: [[telemetry-identity-axes]], [[empty-query-first]], [[do-not-retry]], [[telemetry-data-model-map]]
---

# 스폰 이후 종료가 샌다

> **한 줄 판정**: ★채택 — 36자 clientId 축에서 종료 1,570 / 스폰 5,840. 하트비트만 남은 에이전트 1,518개는 계측 유실이다. 결과 없는 사람 10명 중 보드를 완료하지 않은 쪽이 8명, 크래시 루프가 2명이다.

## 무엇을 물었나

이용자가 스폰한 뒤의 사용 기록이 빠졌는가. 빠졌다면 제품(안 했다)인가 계측(했는데 안 남았다)인가.

## 무엇을 했나

같은 날 BQ를 36자 축으로만 다시 세고, `agent:stopped` writer 와 `task_outcomes` 구독 작성기와 `logCostBatch` 인증 게이트를 읽었다. 오늘 실측을 넣는 검사가 RED 가 되는 것을 단위 테스트로 고정했다.

## 결과 (수치)

| 지표                             |                                 값 | 재현 단위    |
| -------------------------------- | ---------------------------------: | ------------ |
| spawned / stopped                |                      5,840 / 1,570 | 이벤트, 36자 |
| 하트비트만 있고 종료 0인 agentId |                      1,518 / 3,526 | agentId      |
| 스폰한 사람 / 결과 있는 사람     |                             17 / 7 | 사람 수      |
| 디스패치 후 결과 0               |                   6명 (taskId 142) | 사람 수      |
| 그중 크래시 루프                 |                   2명 (크래시 376) | 사람 수      |
| 디스패치 없음                    |                                4명 | 사람 수      |
| cost_logs 사람                   | 5명, 한 계정이 390,144 / 390,287행 | Firebase uid |

이벤트 모수는 충분하다. 사람 수는 17명이라 퍼센트로 말하지 않는다.

## 왜

종료 IPC 는 죽은 창을 버리고, 렌더러 flush 는 10초 타이머라 앱 종료가 먼저 죽는다. 하트비트는 세션 중에 나가서 남고, stopped 는 마지막에 나가서 사라진다. 재시작은 스폰만 늘린다. 아웃컴은 Firestore 터미널 전이만 보므로 크래시 난 태스크는 행이 없다.

## 한계 / 정직성

- 티켓 인용 6,934 vs 1,800 은 28자 행이 섞였다. 36자만 보면 5,840 vs 1,570. 비율은 같다.
- 1,518 중 '지금 이 순간 실행 중'인 몫은 가르지 못했다. 하트비트가 과거 세션인 것은 맞다.
- **수치가 갈리면 원본 측정 문서가 옳다.**

## 실제 영향

살아 있는 다른 창으로 IPC 폴백, 창 숨김/종료 시 flush, 오늘 실측 RED 검사. cost_logs 를 기업 비용의 사람 축으로 쓰면 미인증은 0이다.

## Evidence

- [v3/docs/post-spawn-telemetry-gap-2026-08-25.md](../../../v3/docs/post-spawn-telemetry-gap-2026-08-25.md)
- [v3/functions/src/postSpawnTelemetryGuard.ts](../../../v3/functions/src/postSpawnTelemetryGuard.ts)
- [v3/electron/telemetry.ts](../../../v3/electron/telemetry.ts)

## Backlinks

- [[telemetry-identity-axes]] · [[empty-query-first]] · [[do-not-retry]] · [[counting-unit-first]] · [[2026-kpi-targets-pressure-test]] · [[sole-persistent-user-is-not-external]] · [[shared-project-retention-confounded-with-internality]]
- [[telemetry-data-model-map]] — 표·키 지도
- [[mission-conductor-observability-gaps]] — 같은 종류의 함정: liveness 신호가 개체 자신이 아니라 컨테이너를 가리키면 죽음을 못 잡는다
- [[closed-loop-one-turn-and-its-stops]] — 폐루프 한 바퀴에서 스폰(4단계)·워크트리(5단계)가 돌았는지는 이 관측 구멍이 막혀야 알 수 있다
