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

오케가 **busy**(사람과 대화 중이거나 턴이 도는 중)인 동안은 위 idle pickup이 판정 자체를
건너뛴다 — 유휴 여부가 그 축의 게이트이기 때문이다. 그래서 "턴은 도는데 보드가 안
움직이는" 구간과 "REVIEW로 상태를 바꿨는데 그 근거가 GitHub 어디에도 없는" 구간은 idle
pickup과 무관한 별도 축이다. 아래 두 축이 그 사각을 메운다.

### 활성 정체 — busy인데 티켓 전이·dispatch·PR 변화가 없다

오케가 busy인 구간이 판정 창(기본 10분) 이상 지속되는 동안 티켓 상태 전이·dispatch(신규
claim)·PR 상태 변화 세 축이 전부 0이면 활성 정체다. 판정은 스위프가 매 틱 이미 읽어 오는
attention 행을 이전 틱과 diff해서 얻는다(새 I/O 없음) — 스위프 틱 횟수나 출력량이 아니라
활성 구간 시작 시각과 각 축의 마지막 진전 시각이라는 **벽시계**만 본다. 실제 진전이 있으면
그 시각으로 정체 시계가 리셋된다.

### 미제출 작업 — REVIEW/IN_PROGRESS인데 GitHub에 흔적이 없다

REVIEW 또는 IN_PROGRESS 티켓의 브랜치가 다른 조건(dirty 아님, 판정 창 이상 무활동)을
만족하는데 그 작업이 GitHub 어디에도 반영되지 않았으면 미제출이다. 판정 순서는 강도순
이다: ① 패치 내용이 이미 base에 있는가(가장 강함 — 있으면 그 즉시 미제출이 아니다) ②
그 브랜치를 head로 하는 PR이 open·merged·closed 어떤 상태로도 존재하는가 ③ PR이 있어도
가장 최근 머지 시각 이후에 커밋이 더 붙었는가(머지 뒤 드리프트). **커밋 SHA/정체성
비교(`git cherry`, `git log origin/main..HEAD`)는 판정 근거로 쓰지 않는다** — 이 저장소는
squash 머지를 쓰므로 그 비교는 정상적으로 머지된 브랜치를 전부 미제출로 오판한다(정상
머지 브랜치 표본에서 실측 5/5 오탐 확인 후 폐기). 판단에 필요한 사실을 하나라도 모르면
신호를 내지 않는다 — 오탐이 쏟아지면 이 축 전체가 무시당하므로 미탐 쪽으로 기운다.

## 멈추는 조건

기본값은 OFF다. 스위치는 정확히 `MISSION_ADVANCE_SIGNAL=on`이며 `true`, `1`, `yes`는
OFF다. 연속 자율 신호 5회와 열린 티켓 수가 줄지 않는 신호 2회는 HALT, 동시 진행 3개는
사람 개입이 필요 없는 back-pressure다. 승인 필요 작업, 토큰 부족, 바쁜 오케, 사장님
개입은 자동 행동 대신 보류하거나 알림만 남긴다. 활성 정체·미제출 작업 두 축도 같은 한도
함수를 그대로 타되, 각자 자기 세션 상태·쿨다운을 갖는다 — 한 축이 오판해도 다른 축의
판정을 의심할 필요가 없게 파일·상태를 분리했다.

## 확인 방법

1. 미션의 티켓이 `DONE`으로 전이됐는지와 `SIGNAL_ADVANCE` 분류(`readyNow`, `blocked`,
   `inFlight`, `needsOwnerApproval`)를 확인한다.
2. 다음 미션은 `ASK_OWNER`가 남았는지 확인한다. 후보가 있다고 자동으로 다음 미션이
   시작된 것으로 읽지 않는다.
3. 정체면 120초 뒤 idle pickup이 같은 가드와 토큰 게이트를 거쳐 **PTY에 문장만** 넣는지
   확인한다. 이 경로도 에이전트를 직접 스폰하지 않는다.
4. 오케가 busy인 채로 판정 창을 넘겼는데 attention 행이 그대로면 `[활성 정체]` 알림이
   나가는지 확인한다.
5. REVIEW/IN_PROGRESS 티켓의 브랜치에 PR 흔적이 전혀 없는 채로 판정 창을 넘기면
   `[미제출 작업]` 알림이 나가는지 확인한다 — PR이 하나라도 있으면 통과가 아니라
   머지 뒤 드리프트까지 봐야 한다.

## Evidence

- [[closed-loop-one-turn-and-its-stops]] — 9단계와 가드의 코드 실측 (아카이브)
- [[five-layers-that-hid-the-closed-loop]] — 실패 원인 조사 (아카이브)
- [[autonomous-advance-needs-caps-first]] — 한도 설계 조사 (아카이브)
- [[mission-conductor-observability-gaps]] — 관측 공백 조사 (아카이브)
- [v3/electron/orchestrator-active-stall.ts](../../../v3/electron/orchestrator-active-stall.ts) — 활성 정체 판정 코어
- [v3/electron/orchestrator-unsubmitted-work.ts](../../../v3/electron/orchestrator-unsubmitted-work.ts) — 미제출 작업 판정 코어. 헤더 주석에 unpushed 기준을 폐기한 실측(5/5 오탐)이 그대로 있다
- [v3/electron/orchestrator-board-resync.ts](../../../v3/electron/orchestrator-board-resync.ts) — 두 축을 세 번째·네 번째 패스로 배선(diff 기반, 새 I/O 없음)
- [v3/tests/unit/orchestrator-active-stall.test.ts](../../../v3/tests/unit/orchestrator-active-stall.test.ts) · [v3/tests/unit/orchestrator-active-stall-resync.test.ts](../../../v3/tests/unit/orchestrator-active-stall-resync.test.ts) — 활성 정체 유닛·배선 테스트
- [v3/tests/unit/orchestrator-unsubmitted-work.test.ts](../../../v3/tests/unit/orchestrator-unsubmitted-work.test.ts) — 미제출 작업 유닛 테스트

## Backlinks

- [[closed-loop-rehearsal-runbook]]
- [[autonomous-advance-needs-caps-first]]
- [[closed-loop-one-turn-and-its-stops]]
- [[five-layers-that-hid-the-closed-loop]]
- [[mission-conductor-observability-gaps]]
- [[same-assumption-repeats-across-layers]] — 이 노트가 인용하는 `orchestrator-board-resync.ts`에 패스 둘이 얹히면서 그 노트가 인용하던 줄번호가 드리프트했다
- [[staleness-meter-must-not-be-driven-by-what-it-measures]] — 두 축 모두 이 규칙(계량기를 관측 대상이 굴리게 하지 마라)을 지켜 벽시계로만 잰다
- [[notification-needs-a-recipient]] — 같은 파일을 다른 축(수신자 커버리지)으로 인용한다. 이 노트가 얹은 패스들은 그 커버리지 판정을 안 건드린다
