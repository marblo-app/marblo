---
title: 미션 폐루프 정지는 조용할수록 안 보인다 — 관측 가능성 함정 3건
tags: [domain/operations, topic/agents, topic/electron, topic/observability]
status: verified
date: 2026-09-04
links: [[post-spawn-telemetry-gap]], [[autonomous-advance-needs-caps-first]]
---

# 미션 폐루프 정지는 조용할수록 안 보인다 — 관측 가능성 함정 3건

> **한 줄 판정**: ★확정 — 지휘자(Conductor)의 정지 지점 10곳 중 **A(오케 세션 부재)** 는 감시 타이머 자체가 안 걸려 nudge·escalate 가 영원히 없었고, **C(재시작 후 wait 스텝)** 는 중복-grant 가드가 재평가를 삼켜 조용히 멈췄으며, 고아 클레임 회수(`releaseTaskClaimsForDeadAgent`)는 `claimedBy` 만 지우고 `status` 를 `IN_PROGRESS` 로 남겨 **회수돼도 아무도 못 집었다**(실측 티켓 1건이 9시간 무변화). **2026-09-04 PR #1412 로 세 지점 모두 닫혔다** — 감시는 주입 **이전**에 걸리고, wait 은 re-grant 때 1회 재평가하며, 회수는 제출 전 상태만 `TODO` 로 되돌려 되살린다. liveness 판정 축도 Electron 인스턴스 pid → **에이전트 자신의 heartbeat** 로 바뀌었다.

## 무엇을 물었나

미션 폐루프가 멈췄을 때, 그 정지는 화면·저널에 사유를 남기는가. 그리고 죽은 에이전트의 일감을 되돌리는 경로는 실제로 그 일감을 다시 집을 수 있게 만드는가.

## 무엇을 했나

**진단(2026-09-04, PR #1402)**: `grantStep`→`startReportWatch`→`onStepReport` 폐루프 1회전의 끊길 수 있는 지점을 전수로 뽑아 "조용한가 / 사유가 남는가"로 갈랐다. 가짜 시계(`vi.useFakeTimers`)와 가짜 오케로 3케이스를 재현 테스트(`v3/tests/unit/mission-conductor-silent-stall.test.ts`)에 고정했다. 별도로 실제 고아 클레임 1건(`VCGuLWmNTlhoRvwGAKJA`)을 Firestore 실측으로 추적했다.

**수정(2026-09-04, PR #1412)**: 그 재현 테스트가 빨간불이 되는 것이 의도된 신호였고, 실제로 왔다. 지목된 지점만 고친 뒤 `[A]`·`[C]` 의 단언을 **"조용하다" → "사유가 남는다"** 로 뒤집어 갱신했다(지우지 않았다 — 조용한 정지가 돌아오면 다시 빨간불이 되어야 한다).

## 결과 (수치)

| 정지 지점                 | 트리거(진단)                                                                                                                                  | 진단 시 사유          | 수정 후 계약                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------- |
| **A** 오케 세션 부재      | `grantStep` 이 running 마킹 → 세션탐색 → 없으면 `return`. `startReportWatch` 는 그 `return` **아래**에 있어 도달 못 함                        | ❌ 영구 조용함        | ✅ 감시를 주입 **이전**에 건다 + 즉시 `supervisor.note{kind:"grant_undelivered", reason}` → escalate 까지 |
| B(대조군) 보고만 누락     | 세션은 생존 — watchdog 이 240초×3 nudge 후 escalate                                                                                           | ✅ 타임라인 + `notifyUser` | 변경 없음(처음부터 대조군)                                                                             |
| **C** 재시작 후 wait 스텝 | 재시작 시 `wait` 은 `running` 유지 + resume. re-grant 가 중복-grant 가드(`status==="running"`→return)에 삼켜져 게이트 재평가에 못 옴          | ❌ 조용함             | ✅ wait 만 게이트 **1회** 재평가(주입·running 재마킹 없음). 뒤늦은 이벤트 없이 스스로 전진                |
| **D** 주입 거부           | `postMessage` 가 `injectMessage` 의 `false` 4갈래를 버려 배달 0건이 `granted` 로 기록                                                          | ⚠️ 16분 뒤 엉뚱한 이름 | ✅ `postMessageDetailed`(선택 메서드)로 거부 사유를 그 자리에 분류값으로 남긴다                            |
| **고아 클레임 회수**      | `releaseTaskClaimsForDeadAgent` 가 `claimedBy: null` 만 쓰고 `status` 는 그대로                                                               | ❌ 조용함(감시 없음)   | ✅ `CLAIMED`/`IN_PROGRESS` → `TODO` 복원(되살린 건수 로그) + 오래 조용한 `IN_PROGRESS` 감시(W9) 신설       |

표본: 재현 테스트 3케이스(`[A]`·`[B]`·`[C]`) + 실측 고아 티켓 1건. 재현 단위는 정지 지점 1곳(케이스별 fake-timer 1회전). 실측 티켓은 `status: IN_PROGRESS`·`claimedBy` 유지가 관측 시점(사건 후 약 9시간)까지 무변화였고, 담당 에이전트 문서는 `status: working`(종료 미기록) · `instancePid` 는 지금도 살아 있는 Electron 프로세스였다.

수정 검증: `npm run typecheck` 통과, `vitest` 556 files / 8920 tests 전량 통과. 수정 5건 각각에 유닛 테스트 + 회수 판정마다 **반대방향 테스트**(살아 있는 에이전트의 티켓은 어떤 경우에도 회수되지 않는다).

## 왜

`grantStep` 은 "running 마킹 → 감시 타이머 장착"이 아니라 "running 마킹 → 세션 확보 시도 → 실패 시 조기 return, 감시 타이머는 그 아래" 순서였다. 그래서 세션이 없으면 워치독 자체가 안 걸린다 — 실패해서 조용한 게 아니라 **감시가 시작되지 않아서** 조용하다. 재시작 후 wait 스텝도 같은 모양이다: 가드가 "이미 running 이면 재평가하지 않는다"를 "게이트 재확인이 필요 없다"와 혼동해, 앱이 꺼진 동안 게이트 조건이 이미 충족돼도 깨워줄 이벤트가 다시 오지 않는 한 영원히 선다.

고아 클레임 쪽은 다른 종류의 함정이다. `releaseTaskClaimsForDeadAgent` 는 "클레임을 풀었다"(`claimedBy: null`)를 "다시 집을 수 있다"와 동일시했지만, 재클레임 입구는 전부 `status === "TODO"` 만 받는다. `claimedBy` 를 지우는 것과 `status` 를 되돌리는 것은 **다른 계약**인데, 회수 로직이 후자를 빠뜨리면 회수는 겉보기 성공(에러 없음, 필드 갱신됨)이지만 실질은 티켓을 그 누구도 못 만지는 상태로 고정한다.

세 지점의 공통 패턴: **정지 원인이 "게이트를 통과 못 함"이 아니라 "재평가·감시가 애초에 트리거되지 않음"** 이라, 로그를 아무리 뒤져도 "왜 멈췄는지"가 안 나온다.

## 한계 / 정직성

- 사장님이 "폐루프가 안 된다"고 느낀 순간에 A·C·D 중 무엇이 실제로 발동했는지는 **여전히 미확정**이다 — 진단 실측 시점 활성 미션이 전부 `missionKind: "implicit"`(`steps: []`)이라 폐루프가 애초에 걸린 적이 없고, 런타임 증거 자체가 없다. 수정은 "다시 일어나면 사유가 남는다"를 보장할 뿐 과거 원인을 확정하지 않는다.
- 고아 클레임 회수가 진단 시점에 실제로 시도됐는지(`evaluateGhostReclaim` 이 `inMemory` 분기였는지 `isPidAlive` 분기였는지)는 미확정이다. 확정인 것은 **결과가 `reclaim: false`** 라는 점뿐이다.
- 새 heartbeat 축은 **회수를 넓히는 방향으로는 한 곳**("pid 는 살아 있다" 갈래)에서만 쓰인다. heartbeat 를 한 번도 관측 못 한 문서는 판정이 예전과 **완전히 동일**하다 — 증거가 없다는 이유로 살아있는 작업을 뺏지 않는다. 그래서 "앱은 살았는데 에이전트만 죽은" 고아 중 **툴콜을 한 번도 안 한 개체는 여전히 회수되지 않는다**.
- 오래 조용한 `IN_PROGRESS` 감시(W9)는 **아무것도 회수하지 않는다** — 드러내기만 한다. 그래서 그 판정이 틀렸을 때의 대가는 알림 하나이고, 반대로 진짜 정지를 자동으로 풀어 주지도 않는다.
- 이 판정은 `MISSION_DRIVER=orchestrator`(B안 지휘자) 기준이다. 드라이버가 A안(엔진)으로 바뀌면 다른 코드 경로가 활성화된다.
- 수치가 갈리면 원본이 옳다.

## 실제 영향

**변경 있음**(2026-09-04, PR #1412 — 이 노트의 진단이 지목한 지점만).

- `conductor-driver.ts`: 감시 장착 순서 교정, wait 재평가, 주입 거부 사유 기록
- `mission-engine/ports.ts`·`orch-registry-impl.ts`: `postMessageDetailed` 선택 메서드(기존 구현·fake 무수정)
- `agent-lifecycle-reclaim.ts`: 에이전트 heartbeat 축(`AGENT_HEARTBEAT_STALE_MS` 60분)
- `main.ts`·`mcp-server/tools.ts`: 회수 시 `TODO` 복원 + 되살린 건수 로그, heartbeat 영속화
- `agent-watchdog.ts`: 오래 조용한 `IN_PROGRESS` 감시(W9, 기본 90분)

★사유 축으로 나가는 것은 **고정 어휘 리터럴뿐**이다 — PTY 원문도 주입하려던 지시 본문도 저널·로그에 넣지 않는다(테스트로 직접 단언).

앞으로 미션 엔진·워치독·회수 계열을 만들거나 고칠 때 지킬 규칙 — 셋 다 이제 테스트가 지킨다:

1. **감시 타이머는 "성공 경로"가 아니라 "시도 경로"에 건다.** grant/재평가가 조기 return 할 수 있는 모든 갈래 앞에 워치독을 걸거나, 최소한 실패 사유를 `step.failed`/`supervisor.note` 로 남긴다.
2. **liveness 는 인스턴스 pid 가 아니라 개체(에이전트) 자신의 heartbeat 로 판정한다.** 컨테이너가 살아 있다고 그 안의 개체가 살아 있다는 뜻은 아니다. 같은 이유로 **PTY 바이트에서 파생된 "working 표시"도 근거가 못 된다** — 2026-09-04 실측에서 51분 무커밋·지시 미배달 상태의 에이전트가 계속 `working` 이었다. 판정은 **마지막 실제 산출 시각**으로 한다.
3. **"해제"(release)와 "재집기 가능"(reclaimable)을 같은 커밋에서 같이 만든다.** 클레임 필드를 지우는 코드를 쓸 때마다, 그 자원을 다시 집는 모든 입구가 실제로 받아주는 상태값으로 함께 되돌리는지 확인한다.

## Evidence

- [v3/docs/mission-closed-loop-diagnosis-2026-09-04.md](../../../v3/docs/mission-closed-loop-diagnosis-2026-09-04.md) — 원측정 전문(§2~§7)
- [v3/tests/unit/mission-conductor-silent-stall.test.ts](../../../v3/tests/unit/mission-conductor-silent-stall.test.ts) — `[A]`·`[B]`·`[C]`. 수정 후 계약으로 갱신됨
- [v3/tests/unit/mission-conductor-grant-delivery.test.ts](../../../v3/tests/unit/mission-conductor-grant-delivery.test.ts) — 주입 거부 4갈래 + 원문 금지
- [v3/tests/unit/agent-watchdog-silent-in-progress.test.ts](../../../v3/tests/unit/agent-watchdog-silent-in-progress.test.ts) — W9 + 반대방향
- [v3/electron/mission-engine/conductor-driver.ts](../../../v3/electron/mission-engine/conductor-driver.ts) — `grantStep` 가드 순서, `noteGrantUndelivered`
- [v3/electron/agent-lifecycle-reclaim.ts](../../../v3/electron/agent-lifecycle-reclaim.ts) — `evaluateGhostReclaim`, `AGENT_HEARTBEAT_STALE_MS`
- [v3/electron/agent-watchdog.ts](../../../v3/electron/agent-watchdog.ts) — `detectSilentInProgressTicket`
- [v3/electron/main.ts](../../../v3/electron/main.ts) — `releaseTaskClaimsForDeadAgent`, `runGhostReclaimSweep`, `flushAgentHeartbeats`

## Backlinks

- [[post-spawn-telemetry-gap]] — 같은 종류의 함정: 종료 신호가 새면 "죽었다"를 관측할 수 없다
- [[autonomous-advance-needs-caps-first]] — 같은 폐루프의 **반대 축**: 끊김을 막는 것과 전진을 만드는 것은 다른 문제다
