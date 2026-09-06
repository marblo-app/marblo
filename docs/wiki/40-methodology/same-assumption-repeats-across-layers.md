---
title: 한 층에서 틀린 가정은 다른 층에도 복제돼 있다 — 고친 뒤 같은 가정을 전수로 찾아라
tags: [domain/methodology, topic/agents, topic/observability, verdict/adopt, method/source-link]
status: verified
date: 2026-09-05
links: [[count-callers-before-closing-a-gate]], [[notification-needs-a-recipient]], [[five-layers-that-hid-the-closed-loop]], [[staleness-meter-must-not-be-driven-by-what-it-measures]], [[closed-loop-how-it-works]], [[extend-the-verdict-when-you-add-a-dimension]]
---

# 한 층에서 틀린 가정은 다른 층에도 복제돼 있다 — 고친 뒤 같은 가정을 전수로 찾아라

> **한 줄 판정**: ★채택 — 버그를 고쳤을 때 **고친 것은 그 가정의 한 사본**이다. 가정은 코드보다 잘 복제되고, **복제본끼리 서로를 가린다** — 아래층이 100% 죽어 있으면 위층이 틀렸다는 증상 자체가 안 생기기 때문이다. 2026-09-05 실측: **"미션 티켓이면 그것을 보는 주인이 따로 있다"** 라는 문장 하나가 **두 층**(알림 배달 · 재동기화 스위프)에 각각 박혀 있었고, 아래층을 고친 **뒤에야** 위층이 관측됐다. ★고친 층의 조사가 위층의 코드 줄을 **이미 읽었는데도** 놓쳤다 — 같은 줄을 두 번 읽고 두 번째에야 두 번째 의미를 봤다. 그러므로 수리 직후에 **가정을 문장으로 적고, 그 문장을 쓰는 자리를 전수로 센다.**

## 무엇을 물었나

폐루프가 하루에 다섯 번 고쳐졌다. 각 수리는 그 자리에서 옳았는데 왜 매번 다음 고장이 나왔나 — 그중 **두 층은 같은 원인이었나, 다른 원인이었나**.

## 무엇을 했나

착지한 두 수리(#1425 알림 배달, #1427 자율 픽업)의 진단을 나란히 놓고 **각 층이 전제한 문장**을 뽑아 적었다. 그다음 그 문장이 참이 되려면 무엇이 존재해야 하는지, 암묵 미션에서 그것이 실제로 존재하는지를 코드로 확인했다.

## 결과 (수치)

### 같은 문장, 두 층

> **"미션 티켓이면 그것을 보는 주인이 따로 있다."**

| 층                  | 그 가정의 코드 형태                                                     | 주인이라고 가정한 것   | 암묵 미션에서 실제로는                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 알림 **배달** 층    | `contextId` 가 미션 id 면 미션 오케 풀로 라우팅 (`resolveNotifyTarget`) | 미션 오케 세션         | 그 풀을 채우는 경로가 **없다**(미션 패널·미션 엔진이 launch 할 때만 찬다) → **100% 유실**                                              |
| 재동기화 **스위프** | `if (row.isMission) return null` (`classifyResyncAttention`)            | 컨덕터 report-watchdog | 워치독은 `grantStep` 이 거는 **스텝별** 타이머라 **명시 미션에만** 있다. 암묵 미션 티켓에도 `missionId` 가 박힌다 → **아무도 안 본다** |

**두 층 다 "주인에게 넘긴다"고 코드 주석에 적어 두고 넘겼다.** 각 층은 자기 자리에서 옳게 읽히고, 틀린 것은 **층 사이에 걸친 문장 하나**다.

### 복제본이 서로를 가린 순서

| 시점                | 관측 가능했나                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| 배달 층 수리 **전** | ★**불가.** 배달이 100% 죽어 있으면 "리뷰 19장이 아무에게도 안 보인다"는 사실이 애초에 안 생긴다 |
| 배달 층 수리 **후** | 리뷰가 쌓이고 오케가 서 있는 것이 **처음으로** 증상이 됐다 → 스위프 층 조사로 이어짐            |

★**가장 뼈아픈 사실**: 배달 층 조사는 `if (row.isMission) return null` 을 **이미 읽었다** — "재동기화가 다시 밀어준다"는 문구가 거짓인지 판정하려고 바로 그 줄을 봤다. 그런데 그때는 그 줄이 **"이 문구가 거짓임"의 근거**로만 읽혔고, **"위층이 통째로 눈이 멀었음"** 이라는 두 번째 의미는 안 보였다. 같은 줄을 두 번 읽고 두 번째에야 두 번째 의미를 봤다.

다이제스트 절삭분을 다음 틱에 순회시키는 수리는 이 사례의 가정 복제 판정을 바꾸지
않는다. 그것은 이미 후보로 분류된 항목의 **배달 완료 기준**을 고친 것이며, "미션이면
별도 주인이 있다"는 가정이나 그 가정을 쓰는 두 층의 경계는 새로 만들거나 넓히지 않는다.

재현 단위는 **"가정 문장 1개"**이고 표본은 **1건**(문장 하나가 2개 층에 복제). 사례 수가 적다 — 아래 한계 절을 볼 것.

### 세 번째 복제 지점 — "이 축들은 TODO 를 안 본다" (2026-09-06, 티켓 `xKhErJdSwDH3LIItFe42`)

PROCEED("지금 진행하라")가 오케 PTY 에 닿고도 안 움직이면 아무도 다시 안 부르는 갭을
조사하며, 쿼리를 넓히는 방법(TODO 포함)을 시도하기 **전에** 이 노트의 규칙 3(같은
문장을 쓰는 다른 자리를 전수로 찾는다, 심볼이 아니라 개념으로 grep)을 먼저 적용했다.
"이 축은 TODO 를 안 본다"는 같은 문장이 **독립된 두 자리**에 이미 적혀 있었다:

| 층        | 그 가정의 코드 형태                                                                      | 근거                                                                         |
| --------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 순수 판정 | `classifyResyncAttention`의 `switch(row.status)` — `TODO`는 `default: null`              | `orchestrator-board-resync.ts`                                               |
| I/O 쿼리  | `RESYNC_ATTENTION_STATUSES`(다섯 상태, TODO 없음) — `listAttentionTasks()`가 그대로 쓴다 | `notify-resync-coverage.ts`: "★DONE과 TODO가 없다는 것이 이 목록의 핵심이다" |

★이번엔 두 복제본이 **가리지 않고 같은 답을 냈다** — 둘 다 옳게 "TODO는 범위 밖"이라고
말했고, 그래서 넓히는 시도는 census 단계에서 즉시 기각됐다(넓혔다면 이 보드의 평범한
TODO 백로그 전체가 매 틱 후보가 돼 알림 폭주로 이어졌을 것). 이 사례는 원 사례(두
복제본이 서로를 가려 버그가 됨)의 **거울상**이다 — census를 고치기 **전에** 하면,
가정이 옳을 때는 안전한 경계를 미리 확인해 주고 틀렸을 때는(원 사례처럼) 아래층이
죽어 있음을 미리 드러낸다. 규칙 3은 "복제본을 찾아 고쳐라"뿐 아니라 "복제본을 찾아
넓히지 마라"에도 똑같이 적용된다. 실제 수리는 이 두 자리를 안 건드리고 미션 문서의
`advanceState.handoffOutcome`/`handoffNextTaskId`만 읽는 별도의 좁은 축(여섯 번째
패스)으로 갔다 — [[closed-loop-how-it-works]] 참고.

### 네 번째 복제 지점 — "PTY 바이트가 흐르면 working 이다" (2026-09-06, 티켓 `gPIC5k65hGKcTOpq4NQZ`)

에이전트 `Y4wcieyXuaxHGBsV84gW` 가 429(env-swap 벤더 MiniMax 의 자체 "Token Plan"
쿼터 거절 — 세션 jsonl 의 system-reminder 에 "You are powered by the model
MiniMax-M3." 가 그대로 박혀 있어 확인됐다)로 **성공 턴을 단 한 번도 못 돌았는데**
1시간 35분 동안 보드에 `working` 으로 떠 있었다. 오케(사람)가 세션 jsonl 을 손으로
열어보고서야 잡았다 — 활동 로그도, 자동 알림도 0건.

이 사고는 [v3/docs/watchdog-antigravity-stale-miss-rca.md](../../../v3/docs/watchdog-antigravity-stale-miss-rca.md)
가 이미 이름 붙인 함정 `agent_working_derived_from_pty_bytes`(끝난/막힌 CLI 가
스피너·배너·**합성 에러 메시지**를 계속 repaint 하면 그 바이트만으로 `working` 이
영구화된다)의 **세 번째 재현**이다 — 안티그래비티(OAuth 벽에서 막힘)에 이은 두
번째 사례가 이번 429(요청이 거절만 되고 한 번도 안 나감)다. 그리고 이 노트의
"세 번째 복제 지점"(TODO 미분류)과 **같은 모양**이기도 하다 — 상태 판정 함수가
새로 생긴 실패 축을 못 보고 기존 "정상" 분기로 흡수한다는 점에서
[[extend-the-verdict-when-you-add-a-dimension]] 의 1차·2차(`idle-ok`)와도 같은
계열이다:

| 판정                                       | 그 가정의 코드 형태                                                                      | 새 축이 못 뚫는 이유                                                                                                              |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 보드의 `status=working` 유지               | `agent-manager.ts` 의 PTY `onData` 승격(`shouldPromoteOnPtyOutput`) — 바이트만 보고 승격 | 합성 에러 메시지도 PTY 로 렌더링되는 바이트이므로, "요청이 성공했는가"는 애초에 이 판정의 입력이 아니다                           |
| 재동기화 스위프의 CLAIMED/IN_PROGRESS 판정 | `classifyResyncAttention` 이 보는 것은 `claimedBy` 가 플릿에 살아있는가(orphan)뿐        | "살아있음"과 "요청이 성공한 적 있음"을 같은 것으로 전제한다 — 이 사고에서 에이전트는 플릿에 살아있었다(orphan 판정 영원히 미발동) |

★**이번엔 두 층이 서로 다른 이유로 같은 결론(안전)에 도달했다** — PTY 판정은 "요청
성공"을 아예 안 보고, orphan 판정은 "성공"과 "생존"을 같은 것으로 뭉갰다. 원 사례
(두 층이 같은 문장을 복제)와 다르게, 이번엔 **서로 다른 두 코드 경로가 우연히 같은
사각(성공 여부 미확인)을 공유**했다 — 그래서 사각의 폭이 두 배로 넓다.

이 티켓의 수리(PR #1500)는 세 번째 열(성공 여부)을 `orchestrator-board-resync.ts`
의 `classifyResyncAttention` 에 새 kind `"no-successful-turn"` 으로 추가하고,
그 신호를 세션 jsonl 에서 뽑는 순수 판정(`agent-manager.ts` 의
`sessionHasSuccessfulTurn`)을 만들었다 — `message.model` 이 `"<synthetic>"` 이
아닌 assistant 턴이 하나라도 있는가로 값싸게 판정한다.

★**아직 안 잡힌다 — 배선 미완.** 이 PR 이 만든 것은 **판정 함수와 테스트**까지다.
`main.ts` 의 `listAttentionTasks()` 가 실제 `ResyncTaskRow.hasSuccessfulTurn` 필드를
채우는 배선(에이전트 cwd + claude 세션 id → 세션 파일 경로 → 판정 호출)은 이
티켓의 파일 스코프(`main.ts` 미포함) 밖이라 **아직 연결되지 않았다** — 후속 티켓
`IOAvYsfHz72Ov5BDy8NO`(배선) · `zlJW7D3Kz8HzqXjXJCqE`(죽은 벤더 배치)가 그 일을
한다. 그때까지는 이 축이 실제 스위프에서 한 번도 발화하지 않는다 — **판정 로직이
있다는 사실이 "이제 잡힌다"를 뜻하지 않는다**는 것이 이 노트의 규칙 2(존재해야 할
것을 이름으로 적고, 그것을 만드는 경로를 센다)가 여기서도 그대로 적용된다: 경로가
아직 0개다.

### 겹침을 보장으로 착각하지 마라 — 방향이 반대인 함정

같은 조사에서 두 번째 함정을 확인했다: `orchestrator-commitment-stall.ts`(약속
정체)는 오케가 **스스로 쓴** 약속 문장(워크체인 `source="auto"` 포착)만 본다.
PROCEED가 지목하는 후보는 이미 체인에 있던 항목(주로 `manual`/`owner`)이라 이 축의
포착 대상이 **아니다** — 그런데 우연히 같은 항목이 `source="auto"`로도 잡혀 있으면
겉보기엔 "이미 덮여 있다"로 보인다. **그 겹침은 두 축이 독립적으로 각자의 조건을
만족했을 때만 생기는 우연이지, 한 축이 다른 축을 보장하는 관계가 아니다.** 이 노트의
"복제된 가정"과 방향이 반대인 함정이다 — 저건 **같은 문장이 두 곳에 있는데 아무도
몰랐다**이고, 이건 **두 축이 우연히 같은 항목을 만졌는데 그걸 인과 관계로 착각할
뻔했다**이다. 둘 다 "census를 그 자리에서 멈추면 안 된다"는 같은 교훈으로 묶인다 —
겹침을 봤으면 그 겹침이 **왜** 생겼는지(우연인지 설계인지)까지 확인해야 한다.

## 규칙

수리를 닫기 직전에 셋을 한다. 셋 다 **고친 뒤**에 하는 것이 요점이다 — 고치기 전에는 그 가정이 무엇이었는지 말로 표현되지 않는다.

| #   | 무엇                                                                                    | 구체적으로                                                                                                          |
| --- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | **가정을 한 문장으로 적는다**                                                           | "X 면 Y 가 있다" 꼴로. 코드 주석이 이미 그 문장을 담고 있는 경우가 많다("~ 소관이다", "~ 가 처리한다")              |
| 2   | ★**그 문장이 참이려면 존재해야 하는 것**을 이름으로 적고, 그것을 **만드는 경로**를 센다 | 여기서 "만드는 경로가 0개"가 나오면 그 가정은 전 구간에서 거짓이다 — 배달 층이 정확히 그랬다                        |
| 3   | ★**같은 문장을 쓰는 다른 자리를 전수로 찾는다**                                         | grep 축은 코드 심볼이 아니라 **개념**이다(`isMission` · `missionId` · "소관" · "watchdog"). 심볼만 grep 하면 놓친다 |

★**전수 census 의 대상이 다르다.** [[count-callers-before-closing-a-gate]] 는 **필드/게이트의 호출자**를 센다(누가 이 권한에 의존하나). 이 노트는 **가정의 보유자**를 센다(누가 이 문장을 참이라고 믿고 자기 일을 건너뛰나). 전자는 grep 축이 식별자로 딱 떨어지고, 후자는 **주석과 분기 조건에 자연어로 숨어 있다** — 그래서 더 자주 놓친다.

## 왜

한 층이 완전히 죽어 있으면 **그 아래·위 층의 오류는 증상을 만들 자원이 없다.** 배달이 0%면 "배달된 뒤에 아무도 안 본다"는 사건이 물리적으로 발생하지 않는다. 그래서 직렬로 겹친 고장은 **한 번에 하나씩만** 보이고, 매번 "이번엔 진짜 원인"처럼 보인다 — 실제로 매번 그 층의 진짜 원인이 맞기 때문에 더 속는다.

가정이 특히 잘 복제되는 이유는 그것이 **책임을 넘기는 문장**이기 때문이다. "이건 저쪽 소관"은 각 층을 단순하게 만들어 주므로 설계할 때마다 자연스럽게 다시 쓰인다. 그리고 그 문장은 **넘겨받는 쪽이 존재하는지 확인하지 않는다** — 확인했다면 애초에 한 층에서 끝났을 것이다.

## 한계 / 정직성

- ★**표본이 1건이다.** 가정 문장 하나가 2개 층에 복제된 사례 하나로 세운 규칙이다. "가정은 늘 복제된다"는 주장이 아니라 **"복제됐는지 확인하는 비용이 싸고, 안 하면 다음 층을 며칠 뒤에 만난다"** 는 주장이다.
- 규칙 3(전수 찾기)은 **grep 축을 사람이 잡아야** 한다. 자연어 주석이 대상이라 기계적으로 완전하지 않다 — 못 찾을 수 있다.
- 이 노트는 **직렬로 겹친** 고장을 다룬다. 병렬로 독립된 버그 여러 개에는 해당하지 않는다(그건 그냥 각각 고치면 된다).
- 두 층의 수리는 **서로 다른 접근**을 택했고 그게 옳았다 — 배달 층은 폴백을 만들었고([[notification-needs-a-recipient]]), 스위프 층은 제외를 조건부로 좁혔다(미션 오케가 **안 도는** 프로젝트에서만 본다). **같은 가정이라고 같은 수리가 맞는 것은 아니다.**
- 라이브 관측이 아니라 두 PR 의 진단과 코드 실측이다.
- 갈리면 코드가 옳다.

## 실제 영향

**이 노트로 인한 코드 변경은 없다.** 규칙만 세운다. 근거가 된 두 수리는 각각 #1425 · #1427 로 이미 착지했다.

앞으로 폐루프에 층을 얹을 때 이 규율이 요구하는 것: 수리 PR 본문에 **"이 수리가 폐기한 가정"** 을 한 문장으로 적고, 그 문장을 쓰는 다른 자리를 셌다는 사실(과 개수)을 함께 적는다. 0개면 0개라고 적는다.

## Evidence

- [v3/electron/bridge-server.ts](../../../v3/electron/bridge-server.ts) — 배달 층의 가정. `resolveNotifyTarget`이 미션 풀을 고르고 `missionOrchestratorLookup`이 조회한다. `web_tab_navigate`는 새 pane을 만든 뒤 URL을 반환할 뿐, 미션 오케가 존재한다고 가정하거나 수신자를 선택하지 않는다. **따라서 새 gateway를 이 사례의 세 번째 가정 보유자로 세면 안 되고, 그 구분을 먼저 한 뒤에만 가정 census가 의미를 갖는다.** ★2026-09-06(티켓 `rjoTuGmIlXJQpjDvWMMR`): PTY 거절 직후 컴포저 판독(`describeNotifyRefusal`)을 추가했다 — `resolveNotifyTarget`/`missionOrchestratorLookup` 판정 자체는 안 건드리는 진단 전용 추가라 이 가정 census는 그대로다. ★2026-09-06(티켓 `ndVIU4glmyuKaXPZrBWa`): `dispatchSingle`의 reuse 탈락 사유 진단을 추가했다 — 알림 배달 가정(`resolveNotifyTarget`/`missionOrchestratorLookup`)과는 다른 함수(에이전트 재사용 판정)라 이 census 는 그대로다.
- [v3/electron/main.ts](../../../v3/electron/main.ts) — 그 풀(`missionOrchestrators`, :3679)을 **채우는 유일한 경로**가 `missionOrchestrator:start`(:10697). 암묵 미션에는 이 경로가 없다
- [v3/electron/orchestrator-board-resync.ts](../../../v3/electron/orchestrator-board-resync.ts) — 스위프 층의 같은 가정. `if (row.isMission && !opts?.includeMission) return null`(★2026-09-05 활성 정체·미제출 작업 패스 추가로 줄번호가 드리프트했다 — 최신 값은 이 워크트리 `HEAD` 를 직접 grep), 그리고 :45 주석이 **가정의 근거를 자연어로** 적어 둔다("암묵 미션 티켓에도 `missionId` 가 박히므로 `isMission` 이 true 다"). 그 새 패스들은 이 판정을 안 건드린다 — [[closed-loop-how-it-works]]가 별도로 다루는 다른 축이다. ★2026-09-06(티켓 `WLC9OjIJ8lbCAuz6WlNG`): 다섯 번째 패스(약속 정체, `orchestrator-commitment-stall.ts`)가 또 얹혀 줄번호가 다시 드리프트했다 — 이 패스도 `isMission` 판정을 안 읽는다(워크체인 `open` 항목의 `source==="auto"`만 본다), 판정 자체는 그대로다. ★2026-09-06(티켓 `xKhErJdSwDH3LIItFe42`): 여섯 번째 패스(PROCEED 재호출, `orchestrator-mission-recall.ts`)가 얹혔다 — 이 축도 `classifyResyncAttention`/`isMission` 판정을 안 읽는다(미션 문서 `advanceState`를 별도 쿼리로 읽는다), 이 census 대상 판정은 그대로다
- [v3/electron/mcp-server/notify-resync-coverage.ts](../../../v3/electron/mcp-server/notify-resync-coverage.ts) — ★위 "세 번째 복제 지점" 절의 두 번째 사본. `RESYNC_ATTENTION_STATUSES`(TODO 없음)가 `listAttentionTasks()`(main.ts)의 쿼리와 이 파일의 재전달 판정이 공유하는 단일소스라고 헤더 주석이 명시한다
- [v3/electron/mission-engine/conductor-driver.ts](../../../v3/electron/mission-engine/conductor-driver.ts) — 가정이 참이려면 있어야 했던 주인. report watchdog(:344~, 키는 :466) 의 키가 `${missionId}:${stepIndex}` 라 **`grantStep` 을 거친 명시 미션에만** 존재한다
- [v3/electron/mcp-server/tools.ts](../../../v3/electron/mcp-server/tools.ts) — 암묵 미션 티켓에도 `data.missionId = implicit.missionId`(:4723)가 박힌다. 이 한 줄이 두 층의 가정을 동시에 발동시킨다
- [v3/electron/orchestrator-idle-pickup.ts](../../../v3/electron/orchestrator-idle-pickup.ts) — 스위프 층의 수리. `classifyIdlePickup`(:187)이 미션 행을 **미션 오케가 안 도는 경우에만** 집는다(:197)
- [v3/electron/notify-recipient.ts](../../../v3/electron/notify-recipient.ts) — 배달 층의 수리. `chooseNotifyRecipient`(:70) 의 mission→board 단방향 폴백
- [v3/electron/agent-manager.ts](../../../v3/electron/agent-manager.ts) — ★2026-09-06(티켓 `gPIC5k65hGKcTOpq4NQZ`, 네 번째 복제 지점): `sessionHasSuccessfulTurn`/`assistantLineHasRealModel`(세션 jsonl 의 assistant 턴이 실모델로 도착한 적이 있는가) · `readSessionSuccessfulTurnStatus`(파일 못 읽으면 null="모른다", false 로 승격 안 함)
- [v3/tests/fixtures/session-zero-turn-429.jsonl](../../../v3/tests/fixtures/session-zero-turn-429.jsonl) — `Y4wcieyXuaxHGBsV84gW` 실사고 세션 jsonl 사본(오케가 읽기전용 보존, 시크릿 없음 확인 후 복사). system-reminder 에 "You are powered by the model MiniMax-M3." 가 박혀 있어 env-swap 벤더 축이 원인임을 확정하는 근거
- [v3/tests/unit/agent-manager-zero-turn.test.ts](../../../v3/tests/unit/agent-manager-zero-turn.test.ts) · [v3/tests/unit/orchestrator-board-resync.test.ts](../../../v3/tests/unit/orchestrator-board-resync.test.ts) — 위 픽스처로 red→green 고정 + 뮤테이션 확인(조건 비활성화 시 각각 3건·5건 red)

## Backlinks

- [[closed-loop-rehearsal-runbook]] — ★2026-09-06(티켓 `gPIC5k65hGKcTOpq4NQZ`): §6 트러블슈팅 표가 위 "네 번째 복제 지점"을 인용한다 — 리허설도 자동 스위프도 아직 이 축을 못 잡는다는 사실을 그 노트에 그대로 남겼다
- [[five-layers-that-hid-the-closed-loop]] — 이 규칙이 나온 사례. 다섯 층이 어떤 순서로 서로를 가렸는지가 거기 있다
- [[count-callers-before-closing-a-gate]] — 같은 "전수로 세라" 계열의 앞선 규칙. 저쪽은 **호출자**를, 이쪽은 **가정의 보유자**를 센다
- [[notification-needs-a-recipient]] — 배달 층 사본의 규범적 원본(라우팅은 "어느 풀"까지만 답한다)
- [[staleness-meter-must-not-be-driven-by-what-it-measures]] — 같은 날 같은 폐루프의 다른 층. 그쪽은 가정이 아니라 계량기의 문제였다
- [[closed-loop-how-it-works]] — 이 노트가 인용하는 스위프 층의 파일(`orchestrator-board-resync.ts`)에 새 패스 둘(활성 정체·미제출 작업)이 얹히면서 줄번호가 드리프트한 자리 — 판정 자체는 그대로다. ★2026-09-06(티켓 `WLC9OjIJ8lbCAuz6WlNG`): 다섯 번째 패스(약속 정체)가 또 얹혔다 — 같은 이유로 판정은 그대로다. ★2026-09-06(티켓 `xKhErJdSwDH3LIItFe42`): 여섯 번째 패스(PROCEED 재호출)가 또 얹혔고, 위 "세 번째 복제 지점" 절이 그 판정 전에 한 census 를 기록한다. ★2026-09-06(티켓 `gPIC5k65hGKcTOpq4NQZ`): 다이제스트 축(v1) 자체에 새 attention kind(`no-successful-turn`, 위 "네 번째 복제 지점")가 얹혔다 — 새 패스가 아니라 기존 CLAIMED/IN_PROGRESS 판정의 세 번째 분기다
- [[extend-the-verdict-when-you-add-a-dimension]] — 같은 가정이 "기록"과 "판정" 두 층으로 갈려 한쪽만 고쳐지는 경우. 위 "네 번째 복제 지점"이 그 노트의 1차·2차(`idle-ok`)와 **세 번째 사례**로 이어진다
