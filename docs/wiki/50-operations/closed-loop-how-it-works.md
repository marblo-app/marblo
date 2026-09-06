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
닫히면 다음 미션 후보를 고른다. ★토큰 잔여가 넉넉하면(사장님 지시 2026-09-06, 티켓
Ps490B7n6CvdHQmIXRfu) 승인 없이 오케에게 진행을 알리고 연결된 채널(텔레그램/슬랙)에
보고하며, 잔여가 부족하거나 **잔여를 못 읽었으면** 사장님에게 알리거나 묻는다. 아무 완료
이벤트가 없을 때는 보드 재동기화의 120초 틱이 유휴 오케에게 남은 작업을 다시 알린다.

재동기화 다이제스트는 한 틱에 상위 N개만 이름을 싣지만, **이름이 실제로 실린 항목만
seen 으로 확정한다.** 절삭된 항목은 다음 틱의 후보로 남고, 성공한 앞쪽 항목은 후보에서
빠지므로 유한한 관심항목은 N개 단위로 반드시 순회한다. 이전 구현은 절삭분까지 seen 으로
찍어 이름이 한 번도 불리지 않은 티켓을 그 PTY 세션에서 영구 제외했다. 이 규칙은
`REVIEW`·`FAILED`·`BLOCKED`·고아·성공 턴 0·체인 READY처럼 완료 이벤트 없이 남은 주의
상태에만 적용하며, 유실된 `SIGNAL_ADVANCE` 자체를 다시 만들지는 않는다.

★2026-09-06(티켓 `gPIC5k65hGKcTOpq4NQZ`): CLAIMED/IN_PROGRESS 판정에 고아와 별개인
셋째 분기 "성공 턴 0"이 얹혔다 — claim 한 에이전트가 플릿에 살아있어(고아가 아니어서)
`working`처럼 보여도, 그 세션 jsonl 에 실모델로 도착한 assistant 턴이 **한 번도**
없으면(429 등으로 매 요청이 거절돼 온 경우) 고아의 10분 유예 없이 짧은 창만으로
통보한다(실측: `Y4wcieyXuaxHGBsV84gW`, 429 로 1시간 35분 동안 성공 턴 0인데
`working`으로 보인 사고). ★**이 축은 판정 함수까지만 존재한다** — `listAttentionTasks()`
가 이 판정의 입력(`ResyncTaskRow.hasSuccessfulTurn`)을 세션 파일을 읽어 채우는
배선은 이 티켓 스코프(`main.ts` 미포함) 밖이라 **아직 없다.** 그때까지는 이 셋째
분기가 실제 스위프에서 발화하지 않는다 — 후속 티켓 `IOAvYsfHz72Ov5BDy8NO`가 배선을
잇는다.

| 흐름                                             | 주체               | 확인할 사실                                                                       |
| ------------------------------------------------ | ------------------ | --------------------------------------------------------------------------------- |
| 지시 → 미션 → 티켓 → 스폰                        | 사장님·오케        | `contextId`가 미션이면 그 티켓은 미션 소속                                        |
| PR 머지 → DONE                                   | 사람·오케          | 머지는 완료가 아니다. 후속이 있으면 `HOLD_REVIEW`다                               |
| DONE → 형제 티켓 알림                            | 기계               | `MISSION_ADVANCE_SIGNAL=on`일 때만 `SIGNAL_ADVANCE`                               |
| 마지막 티켓 → 다음 미션, 토큰 넉넉(sufficient)   | 기계 → 채널        | `PROCEED`; 승인 없이 진행 + 텔레그램/슬랙 보고                                    |
| 마지막 티켓 → 다음 미션, 토큰 부족(insufficient) | 기계 → 사장님      | `NOTIFY_OWNER`; 스폰 안 함, 사유만 알림                                           |
| 마지막 티켓 → 다음 미션, 토큰 못 읽음(no-data)   | 기계 → 사장님      | `ASK_OWNER`; 자동 진행 금지, 안전 측으로 여쭘                                     |
| 완료가 없는 정체                                 | 기계               | 120초 보드 재동기화의 idle pickup이 PTY에만 알림                                  |
| PROCEED가 오케에게 닿고도 근거 티켓이 안 움직임  | 기계 → 오케·사장님 | `[PROCEED 재호출]`; 판정 창(10분) 뒤 재호출, 한도 넘으면 사장님 채널 에스컬레이션 |

★`PROCEED`는 **에이전트를 직접 스폰하지 않는다.** 승인 질문을 생략하고 오케 PTY에 "지금
진행하라"를 넣을 뿐이며, 실제 `dispatch_task`/`spawn_agent`는 그 메시지를 읽은 오케가 한다
(ASK_OWNER 승인 이후 오케가 스폰하는 것과 같은 방식 — 새 스폰 경로를 만들지 않았다). 즉
**"승인을 안 여쭙는다" ≠ "사람 없이 스폰된다"** — 오케가 정체해 있으면 진행도 멈춘다.
★이 정체는 아래 "약속 정체" 절의 와치독(#1478)이 잡는 것과 **같은 종류는 아니다** —
그 축은 `work-chain-capture.ts`가 **오케 자신이 쓴** 약속 문장(`escalate_to_owner`·
`answer_question`·`add_activity` 등)만 읽어 포착하고, PROCEED 가 오케에게 **넣는** 지시문은
오케가 쓴 문장이 아니라서 그 포착 대상이 아니다. ★idle pickup·활성 정체도 이 갭을
덮지 않는다 — 둘 다 `listAttentionTasks()`가 읽는 같은 행(`REVIEW`/`FAILED`/`BLOCKED`/
`CLAIMED`/`IN_PROGRESS`만, `TODO`는 없음)을 보는데, PROCEED가 지목한 다음 후보 티켓은
오케가 아직 claim하지 않았으면 `TODO`로 남아 그 행 자체가 안 보인다(우연히 다른 축이
겹쳐도 보장이 아니다 — 티켓 xKhErJdSwDH3LIItFe42 판정). ★그래서 이 쿼리를 `TODO`
포함으로 넓히는 대신(그러면 이 보드의 평범한 `TODO` 백로그 전체가 매 틱 후보가 돼
알림 폭주로 이어진다) 아래 "PROCEED 재호출" 절의 전용 축이 미션 핸드오프가 적어 둔
`handoffOutcome`/`handoffNextTaskId`만 좁혀 읽어 다시 부른다.

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

### 약속 정체 — 오케 자신이 "하겠습니다"라고 말한 항목 하나가 안 움직인다

★위 세 축(idle pickup·활성 정체·미제출 작업)은 전부 **보드**(티켓 상태·PR·GitHub)를
본다. 이 축은 다르다 — `work-chain-capture.ts`가 오케의 약속 어미를 이미 자동
포착해 워크체인에 남기는데(`source="auto"`), 그 항목 **하나**가 포착된 뒤 아무도
안 건드렸으면(`updatedAt`이 판정 창 10분 이상 그대로) 오케에게 그 항목만 콕 집어
묻는다. 오케가 계속 바쁘게 다른 일을 해도 상관없다 — 활성 정체가 못 보는 사각을
메운다(2026-09-06 실측: "별도로 정리해서 드리겠습니다"가 다음 메시지에 끌려가
안 돌아왔고, 네이버 티켓을 만들어놓고 그 약속 항목에는 안 붙였다). ★티켓이
생겨도 `update_work_chain_item`으로 그 항목에 붙이지 않으면 여전히 정체로 본다
— 새 신호를 만들지 않는다.

이 축은 **묻기만** 한다. 대신 티켓을 닫거나 대신 `update_work_chain_item`을
호출하지 않는다 — 자동 실행은 금지다.

### PROCEED 재호출 — PROCEED가 닿고도 그 후보 티켓이 안 움직인다

★위 네 축(idle pickup·활성 정체·미제출 작업·약속 정체) 중 이 갭을 보장하는 것은 없다
(위 "지금 무엇이 참인가" 절 참고). 이 축은 미션 핸드오프가 PROCEED를 낼 때 이미
적어 두는 `advanceState.handoffOutcome === "auto-proceed"`와 `handoffAskedAt`, 그리고
이 티켓이 추가한 `handoffNextTaskId`(1순위 후보의 근거 티켓)만 읽는다 — `listAttentionTasks()`
쿼리를 넓히지 않는다. 판정 창(10분, `ACTIVE_STALL_WINDOW_MS` 재사용) 이상 지났는데
그 근거 티켓의 현재 status를 단건으로 읽어(`fbGetDoc`, 프로젝트 전체 진전이 아니라
**그 티켓 하나**만 본다) 여전히 `TODO`면 오케 PTY에 다시 알린다. 근거 티켓이 없는
후보(need="split", 아직 아무도 태스크로 안 쪼갠 사장님 지시)는 지켜볼 티켓이 없으므로
이 축의 범위 밖이다.

★이 축만 다른 다섯과 다른 동작이 하나 있다 — HALT(연속/정체 한도 초과, 새 한도를
안 만들고 `evaluateAdvanceGuards` 그대로)에 닿으면 오케 PTY 알림에 **더해** 사장님
채널로 1회 에스컬레이션한다(`AgentWatchdog.escalate`가 이미 쓰는 `telegramPoller.sendMessage`
재사용, 새 전송 채널 아님). PROCEED는 "사장님 승인 없이 진행한다"는 자동 결정이라,
그게 무반응으로 끝나면 조용히 포기하지 않는다 — 대신 다시 부르고, 그래도 안 되면
사람에게 올린다. 이 축도 dispatch/claim을 대신 하지 않는다 — 재호출까지다.

## 멈추는 조건

기본값은 OFF다. 스위치는 정확히 `MISSION_ADVANCE_SIGNAL=on`이며 `true`, `1`, `yes`는
OFF다. 연속 자율 신호 5회와 열린 티켓 수가 줄지 않는 신호 2회는 HALT, 동시 진행 3개는
사람 개입이 필요 없는 back-pressure다. 승인 필요 작업, 바쁜 오케, 사장님 개입은 자동
행동 대신 보류하거나 알림만 남긴다. ★토큰 잔여는 세 갈래다(티켓 Ps490B7n6CvdHQmIXRfu,
2026-09-06) — 넉넉하면(sufficient) 승인 없이 진행하고 채널에 보고하며, 부족하면
(insufficient) 스폰 없이 알리고, **잔여를 못 읽었으면(no-data) 넉넉함이 확인되지
않았으므로 여전히 사장님께 여쭙는다** — `evaluateTokenBudgetGate`가 no-data에도
`allowSpawn:true`를 주지만, 자동 진행 판정은 그 필드를 보지 않고 `code`로만 분기해
no-data가 진행으로 새지 않는다. 활성 정체·미제출 작업·약속 정체·PROCEED 재호출 네 축도
같은 한도 함수를 그대로 타되, 각자 자기 세션 상태·쿨다운을 갖는다 — 한 축이 오판해도
다른 축의 판정을 의심할 필요가 없게 파일·상태를 분리했다. ★PROCEED 재호출만 HALT에
사장님 채널 에스컬레이션이 더 붙는다(조용한 포기 금지) — 새 한도가 아니라 같은 HALT
판정에 얹은 부가 동작이다.

## 확인 방법

1. 미션의 티켓이 `DONE`으로 전이됐는지와 `SIGNAL_ADVANCE` 분류(`readyNow`, `blocked`,
   `inFlight`, `needsOwnerApproval`)를 확인한다.
2. 다음 미션은 토큰 잔여에 따라 셋 중 하나로 갈린다: 넉넉하면 `PROCEED`(채널 보고와
   함께 이미 진행됐는지), 부족하면 `NOTIFY_OWNER`(스폰 안 하고 알렸는지), 잔여를
   못 읽었으면 `ASK_OWNER`(자동 진행하지 않고 여쭀는지)를 확인한다. 후보가 있다고
   토큰 확인 없이 자동으로 다음 미션이 시작된 것으로 읽지 않는다.
3. 정체면 120초 뒤 idle pickup이 같은 가드와 토큰 게이트를 거쳐 **PTY에 문장만** 넣는지
   확인한다. 이 경로도 에이전트를 직접 스폰하지 않는다.
4. 오케가 busy인 채로 판정 창을 넘겼는데 attention 행이 그대로면 `[활성 정체]` 알림이
   나가는지 확인한다.
5. REVIEW/IN_PROGRESS 티켓의 브랜치에 PR 흔적이 전혀 없는 채로 판정 창을 넘기면
   `[미제출 작업]` 알림이 나가는지 확인한다 — PR이 하나라도 있으면 통과가 아니라
   머지 뒤 드리프트까지 봐야 한다.
6. 오케가 자기 입으로 말한 약속(워크체인 auto 포착)의 `updatedAt`이 판정 창을
   넘기면 `[약속 확인]` 질문이 나가는지 확인한다 — 티켓이 생겨도
   `update_work_chain_item`으로 그 항목에 안 붙었으면 여전히 질문 대상이어야
   한다.
7. PROCEED가 나간 뒤 그 1순위 후보의 근거 티켓이 판정 창을 넘기고도 `TODO`로
   남아 있으면 `[PROCEED 재호출]`이 나가는지 확인한다 — 근거 티켓이 `TODO`를
   벗어나면(claim만 돼도) 더는 재호출되지 않아야 한다. 한도를 넘겨 HALT되면
   오케 PTY 알림과 별개로 사장님 채널(텔레그램/슬랙)에도 에스컬레이션이
   나가는지 확인한다.

## Evidence

- [[closed-loop-one-turn-and-its-stops]] — 9단계와 가드의 코드 실측 (아카이브)
- [[five-layers-that-hid-the-closed-loop]] — 실패 원인 조사 (아카이브)
- [[autonomous-advance-needs-caps-first]] — 한도 설계 조사 (아카이브)
- [[mission-conductor-observability-gaps]] — 관측 공백 조사 (아카이브)
- [v3/electron/orchestrator-active-stall.ts](../../../v3/electron/orchestrator-active-stall.ts) — 활성 정체 판정 코어
- [v3/electron/orchestrator-unsubmitted-work.ts](../../../v3/electron/orchestrator-unsubmitted-work.ts) — 미제출 작업 판정 코어. 헤더 주석에 unpushed 기준을 폐기한 실측(5/5 오탐)이 그대로 있다
- [v3/electron/orchestrator-board-resync.ts](../../../v3/electron/orchestrator-board-resync.ts) — 다이제스트의 명시 항목·세션별 seen·120초 재동기화와 활성 정체·미제출 작업·약속 정체·★PROCEED 재호출(티켓 `xKhErJdSwDH3LIItFe42`, 2026-09-06)의 세 번째~여섯 번째 패스. ★2026-09-06(티켓 `gPIC5k65hGKcTOpq4NQZ`): 새 패스가 아니라 다이제스트 축(v1) 자체의 `classifyResyncAttention`에 셋째 attention kind `"no-successful-turn"`이 얹혔다(고아와 별개, 위 문단 참고)
- [v3/electron/agent-manager.ts](../../../v3/electron/agent-manager.ts) — ★2026-09-06(티켓 `gPIC5k65hGKcTOpq4NQZ`): `sessionHasSuccessfulTurn`(세션 jsonl 의 assistant 턴이 실모델로 도착한 적이 있는가) — 위 "성공 턴 0" 축의 판정 재료. `main.ts`가 아직 이 값을 `ResyncTaskRow`에 배선하지 않아 축 자체는 미발화 상태다
- [v3/tests/fixtures/session-zero-turn-429.jsonl](../../../v3/tests/fixtures/session-zero-turn-429.jsonl) — 실사고(`Y4wcieyXuaxHGBsV84gW`) 세션 jsonl 사본. env-swap 벤더(MiniMax) 자체 쿼터 거절이 원인이었음을 system-reminder 원문으로 확인한 근거
- [v3/electron/orchestrator-commitment-stall.ts](../../../v3/electron/orchestrator-commitment-stall.ts) — ★약속 정체 순수 판정. 진전=항목 `updatedAt`, 새 포착기 아님(`work-chain-capture.ts`가 이미 적어 둔 것을 읽는다), 대신 실행 안 함(질문만)
- [v3/electron/orchestrator-mission-recall.ts](../../../v3/electron/orchestrator-mission-recall.ts) — ★PROCEED 재호출 순수 판정(티켓 `xKhErJdSwDH3LIItFe42`). 좁히는 열쇠는 `handoffOutcome`/`handoffNextTaskId`(status 쿼리 확장 아님), HALT 시 사장님 에스컬레이션 본문을 채우는 것이 다른 네 축과의 유일한 차이
- [v3/tests/unit/orchestrator-mission-recall.test.ts](../../../v3/tests/unit/orchestrator-mission-recall.test.ts) · [v3/tests/unit/orchestrator-mission-recall-resync.test.ts](../../../v3/tests/unit/orchestrator-mission-recall-resync.test.ts) — PROCEED 재호출 유닛·배선 테스트
- [v3/tests/unit/orchestrator-active-stall.test.ts](../../../v3/tests/unit/orchestrator-active-stall.test.ts) · [v3/tests/unit/orchestrator-active-stall-resync.test.ts](../../../v3/tests/unit/orchestrator-active-stall-resync.test.ts) — 활성 정체 유닛·배선 테스트
- [v3/tests/unit/orchestrator-unsubmitted-work.test.ts](../../../v3/tests/unit/orchestrator-unsubmitted-work.test.ts) — 미제출 작업 유닛 테스트
- [v3/tests/unit/orchestrator-commitment-stall.test.ts](../../../v3/tests/unit/orchestrator-commitment-stall.test.ts) · [v3/tests/unit/orchestrator-commitment-stall-resync.test.ts](../../../v3/tests/unit/orchestrator-commitment-stall-resync.test.ts) — 약속 정체 유닛·배선 테스트
- [v3/electron/mcp-server/mission-handoff.ts](../../../v3/electron/mcp-server/mission-handoff.ts) — ★2026-09-06(티켓 `Ps490B7n6CvdHQmIXRfu`): `PROCEED` 액션·`formatOwnerProceedReport`(토큰 넉넉하면 승인 없이 진행 + 채널 보고). `evaluateMissionHandoff`가 토큰 게이트를 `allowSpawn`이 아니라 `tokenGate.code`로만 분기하는 자리가 이 파일의 결정 코어다
- [v3/electron/mcp-server/advance-guards.ts](../../../v3/electron/mcp-server/advance-guards.ts) — `evaluateTokenBudgetGate`의 `no-data` 근거가 갱신됐다: 예전엔 "사장님 승인 게이트가 무조건이라 안전"이었으나, 지금은 **호출자가 `code`로만 분기하는 계약**이 안전을 보장한다(`allowSpawn:true`를 자동 진행 판단에 쓰지 않는다)
- [v3/tests/unit/mission-handoff.test.ts](../../../v3/tests/unit/mission-handoff.test.ts) — 토큰 잔여 네 갈래(sufficient→PROCEED·insufficient→NOTIFY_OWNER·no-data→ASK_OWNER·한도초과→HALT/HOLD)를 각각 고정. `no-data`가 `PROCEED`로 새지 않는 것도 전용 테스트로 고정

## Backlinks

- [[closed-loop-rehearsal-runbook]]
- [[autonomous-advance-needs-caps-first]]
- [[closed-loop-one-turn-and-its-stops]]
- [[five-layers-that-hid-the-closed-loop]]
- [[mission-conductor-observability-gaps]]
- [[same-assumption-repeats-across-layers]] — 이 노트가 인용하는 `orchestrator-board-resync.ts`에 패스 둘이 얹히면서 그 노트가 인용하던 줄번호가 드리프트했다. ★2026-09-06(티켓 `gPIC5k65hGKcTOpq4NQZ`): 그 노트의 "네 번째 복제 지점"이 이번 셋째 attention kind(성공 턴 0)를 기록한다 — `agent_working_derived_from_pty_bytes` 함정의 세 번째 재현
- [[staleness-meter-must-not-be-driven-by-what-it-measures]] — 두 축 모두 이 규칙(계량기를 관측 대상이 굴리게 하지 마라)을 지켜 벽시계로만 잰다
- [[notification-needs-a-recipient]] — 같은 파일을 다른 축(수신자 커버리지)으로 인용한다. 이 노트가 얹은 패스들은 그 커버리지 판정을 안 건드린다
