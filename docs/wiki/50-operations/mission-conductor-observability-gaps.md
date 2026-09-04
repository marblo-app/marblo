---
title: 미션 폐루프 정지는 조용할수록 안 보인다 — 관측 가능성 함정 3건
tags: [domain/operations, topic/agents, topic/electron, topic/observability]
status: verified
date: 2026-09-04
links: [[post-spawn-telemetry-gap]]
---

# 미션 폐루프 정지는 조용할수록 안 보인다 — 관측 가능성 함정 3건

> **한 줄 판정**: ★확정 — 지휘자(Conductor)의 정지 지점 10곳 중 **A(오케 세션 부재)** 는 감시 타이머 자체가 안 걸려 nudge·escalate 가 영원히 없고, **C(재시작 후 wait 스텝)** 는 중복-grant 가드가 재평가를 삼켜 조용히 멈춘다. 고아 클레임 회수(`releaseTaskClaimsForDeadAgent`)는 `claimedBy` 만 지우고 `status` 를 `IN_PROGRESS` 로 남겨, 재클레임 입구 두 곳(`get_available_tasks`·`claim_task`)이 전부 `TODO` 만 받아 **회수돼도 아무도 못 집는다** — 실측 티켓 1건이 9시간 무변화로 방치됐다.

## 무엇을 물었나

미션 폐루프가 멈췄을 때, 그 정지는 화면·저널에 사유를 남기는가. 그리고 죽은 에이전트의 일감을 되돌리는 경로는 실제로 그 일감을 다시 집을 수 있게 만드는가.

## 무엇을 했나

`grantStep`→`startReportWatch`→`onStepReport` 폐루프 1회전의 끊길 수 있는 지점을 전수로 뽑아 "조용한가 / 사유가 남는가"로 갈랐다. 가짜 시계(`vi.useFakeTimers`)와 가짜 오케로 3케이스를 재현 테스트(`v3/tests/unit/mission-conductor-silent-stall.test.ts`)에 고정했다. 별도로 실제 고아 클레임 1건(`VCGuLWmNTlhoRvwGAKJA`)을 Firestore 실측으로 추적했다.

## 결과 (수치)

| 정지 지점                 | 트리거                                                                                                                                        | 사유가 남는가               | 확정도          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | --------------- |
| **A** 오케 세션 부재      | `grantStep` 이 running 마킹 → 세션탐색 → 없으면 `return`. `startReportWatch` 는 그 `return` **아래**에 있어 도달 못 함                        | ❌ 영구 조용함              | 확정(테스트)    |
| B(대조군) 보고만 누락     | 세션은 생존 — watchdog 이 240초×3 nudge 후 escalate                                                                                           | ✅ 타임라인 + `notifyUser`  | 확정(테스트)    |
| **C** 재시작 후 wait 스텝 | 재시작 시 `wait` 스텝은 `running` 유지 + resume. re-grant 가 중복-grant 가드(`status==="running"`→return)에 삼켜져 wait 게이트 재평가에 못 옴 | ❌ 조용함                   | 확정(테스트)    |
| **고아 클레임 회수**      | `releaseTaskClaimsForDeadAgent` 가 `claimedBy: null` 만 쓰고 `status` 는 그대로                                                               | ❌ 조용함(감시 자체가 없음) | 확정(코드+실측) |

표본: 재현 테스트 3케이스(`[A]`·`[B]`·`[C]`) + 실측 고아 티켓 1건. 재현 단위는 정지 지점 1곳(케이스별 fake-timer 1회전). 실측 티켓은 `status: IN_PROGRESS`·`claimedBy` 유지가 관측 시점(사건 후 약 9시간)까지 무변화였고, 담당 에이전트 문서는 `status: working`(종료 미기록) · `instancePid` 는 지금도 살아 있는 Electron 프로세스였다.

## 왜

`grantStep` 은 "running 마킹 → 감시 타이머 장착"이 아니라 "running 마킹 → 세션 확보 시도 → 실패 시 조기 return, 감시 타이머는 그 아래" 순서다. 그래서 세션이 없으면 워치독 자체가 안 걸린다 — 실패해서 조용한 게 아니라 **감시가 시작되지 않아서** 조용하다. 재시작 후 wait 스텝도 같은 모양이다: 가드가 "이미 running 이면 재평가하지 않는다"를 "게이트 재확인이 필요 없다"와 혼동해, 앱이 꺼진 동안 게이트 조건이 이미 충족돼도 깨워줄 이벤트가 다시 오지 않는 한 영원히 선다.

고아 클레임 쪽은 다른 종류의 함정이다. `releaseTaskClaimsForDeadAgent` 는 "클레임을 풀었다"(`claimedBy: null`)를 "다시 집을 수 있다"와 동일시했지만, 재클레임 입구는 전부 `status === "TODO"` 만 받는다. `claimedBy` 를 지우는 것과 `status` 를 되돌리는 것은 **다른 계약**인데, 회수 로직이 후자를 빠뜨리면 회수는 겉보기 성공(에러 없음, 필드 갱신됨)이지만 실질은 티켓을 그 누구도 못 만지는 상태로 고정한다.

세 지점의 공통 패턴: **정지 원인이 "게이트를 통과 못 함"이 아니라 "재평가·감시가 애초에 트리거되지 않음"** 이라, 로그를 아무리 뒤져도 "왜 멈췄는지"가 안 나온다.

## 한계 / 정직성

- 사장님이 "폐루프가 안 된다"고 느낀 순간에 A·C·D(§원본 4절) 중 무엇이 실제로 발동했는지는 **미확정**이다 — 실측 시점 활성 미션이 전부 `missionKind: "implicit"`(`steps: []`)이라 폐루프가 애초에 걸린 적이 없고, 런타임 증거 자체가 없다.
- 고아 클레임 회수가 실제로 시도됐는지(`evaluateGhostReclaim` 이 `inMemory` 분기였는지 `isPidAlive` 분기였는지)는 미확정이다. 실행 중인 다른 세션의 메모리를 건드리지 않기로 해 확인을 보류했다. 확정인 것은 **결과가 `reclaim: false`** 라는 점뿐이다.
- liveness 판정은 `instancePid`(Electron 인스턴스 pid)로 이뤄진다. 앱이 죽지 않는 한 그 안의 개별 에이전트가 죽어도 살아있다고 오판한다 — 이건 이번 사례의 근본 원인 후보이지 확정된 유일 원인은 아니다.
- 이 판정은 `MISSION_DRIVER=orchestrator`(B안 지휘자) 실측 시점 기준이다. 드라이버가 A안(엔진)으로 바뀌면 다른 코드 경로가 활성화된다.
- 수치가 갈리면 원본이 옳다.

## 실제 영향

무변경. 이 노트가 딸린 PR 은 진단 전용이며 코드·설정·운영을 하나도 바꾸지 않았다.

앞으로 미션 엔진·워치독·회수 계열을 만들거나 고칠 때 지킬 규칙:

1. **감시 타이머는 "성공 경로"가 아니라 "시도 경로"에 건다.** grant/재평가가 조기 return 할 수 있는 모든 갈래 앞에 워치독을 걸거나, 최소한 실패 사유를 `step.failed`/`supervisor.note` 로 남긴다.
2. **liveness 는 인스턴스 pid 가 아니라 개체(에이전트) 자신의 heartbeat 로 판정한다.** 컨테이너가 살아 있다고 그 안의 개체가 살아 있다는 뜻은 아니다.
3. **"해제"(release)와 "재집기 가능"(reclaimable)을 같은 커밋에서 같이 만든다.** 클레임 필드를 지우는 코드를 쓸 때마다, 그 자원을 다시 집는 모든 입구가 실제로 받아주는 상태값으로 함께 되돌리는지 확인한다.

## Evidence

- [v3/docs/mission-closed-loop-diagnosis-2026-09-04.md](../../../v3/docs/mission-closed-loop-diagnosis-2026-09-04.md) — 원측정 전문(§2~§7)
- [v3/tests/unit/mission-conductor-silent-stall.test.ts](../../../v3/tests/unit/mission-conductor-silent-stall.test.ts) — `[A]`·`[B]`·`[C]` 재현
- [v3/electron/mission-engine/conductor-driver.ts](../../../v3/electron/mission-engine/conductor-driver.ts) — `grantStep` 가드 순서
- [v3/electron/agent-lifecycle-reclaim.ts](../../../v3/electron/agent-lifecycle-reclaim.ts) — `evaluateGhostReclaim`
- [v3/electron/main.ts](../../../v3/electron/main.ts) — `releaseTaskClaimsForDeadAgent`, `runGhostReclaimSweep`

## Backlinks

- [[post-spawn-telemetry-gap]] — 같은 종류의 함정: 종료 신호가 새면 "죽었다"를 관측할 수 없다
