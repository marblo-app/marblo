---
title: 폐루프는 어떻게 도는가
tags: [domain/operations, topic/agents, topic/electron, topic/observability, kind/knowledge]
status: active
date: 2026-09-05
links: [[closed-loop-one-turn-and-its-stops]], [[five-layers-that-hid-the-closed-loop]], [[autonomous-advance-needs-caps-first]], [[mission-conductor-observability-gaps]]
---

## 지금 무엇이 참인가

폐루프는 티켓을 자동으로 만들거나 에이전트를 자동 스폰하는 기능이 아니다. 오케가 미션과
티켓을 만들고 스폰하며, 기계는 **완료된 티켓의 형제 작업을 오케에게 다시 알리고**, 미션이
닫히면 다음 미션 후보를 사장님에게 묻는다. 아무 완료 이벤트가 없을 때는 보드 재동기화의
120초 틱이 유휴 오케에게 남은 작업을 다시 알린다.

| 흐름                      | 주체          | 확인할 사실                                         |
| ------------------------- | ------------- | --------------------------------------------------- |
| 지시 → 미션 → 티켓 → 스폰 | 사장님·오케   | `contextId`가 미션이면 그 티켓은 미션 소속          |
| PR 머지 → DONE            | 사람·오케     | 머지는 완료가 아니다. 후속이 있으면 `HOLD_REVIEW`다 |
| DONE → 형제 티켓 알림     | 기계          | `MISSION_ADVANCE_SIGNAL=on`일 때만 `SIGNAL_ADVANCE` |
| 마지막 티켓 → 다음 미션   | 기계 → 사장님 | `ASK_OWNER`; 자동 선택·자동 스폰하지 않음           |
| 완료가 없는 정체          | 기계          | 120초 보드 재동기화의 idle pickup이 PTY에만 알림    |

## 멈추는 조건

기본값은 OFF다. 스위치는 정확히 `MISSION_ADVANCE_SIGNAL=on`이며 `true`, `1`, `yes`는
OFF다. 연속 자율 신호 5회와 열린 티켓 수가 줄지 않는 신호 2회는 HALT, 동시 진행 3개는
사람 개입이 필요 없는 back-pressure다. 승인 필요 작업, 토큰 부족, 바쁜 오케, 사장님
개입은 자동 행동 대신 보류하거나 알림만 남긴다.

## 확인 방법

1. 미션의 티켓이 `DONE`으로 전이됐는지와 `SIGNAL_ADVANCE` 분류(`readyNow`, `blocked`,
   `inFlight`, `needsOwnerApproval`)를 확인한다.
2. 다음 미션은 `ASK_OWNER`가 남았는지 확인한다. 후보가 있다고 자동으로 다음 미션이
   시작된 것으로 읽지 않는다.
3. 정체면 120초 뒤 idle pickup이 같은 가드와 토큰 게이트를 거쳐 **PTY에 문장만** 넣는지
   확인한다. 이 경로도 에이전트를 직접 스폰하지 않는다.

## Evidence

- [[closed-loop-one-turn-and-its-stops]] — 9단계와 가드의 코드 실측 (아카이브)
- [[five-layers-that-hid-the-closed-loop]] — 실패 원인 조사 (아카이브)
- [[autonomous-advance-needs-caps-first]] — 한도 설계 조사 (아카이브)
- [[mission-conductor-observability-gaps]] — 관측 공백 조사 (아카이브)

## Backlinks

- [[closed-loop-rehearsal-runbook]]
- [[autonomous-advance-needs-caps-first]]
- [[closed-loop-one-turn-and-its-stops]]
- [[five-layers-that-hid-the-closed-loop]]
- [[mission-conductor-observability-gaps]]
