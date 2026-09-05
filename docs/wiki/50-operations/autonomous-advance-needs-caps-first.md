---
title: 완료가 다음을 부르게 — 자율 전진은 한도를 먼저 깔고 켠다
tags: [domain/operations, topic/agents, topic/electron, topic/observability]
status: active
date: 2026-09-05
links: [[mission-conductor-observability-gaps]], [[closed-loop-one-turn-and-its-stops]]
---

# 완료가 다음을 부르게 — 자율 전진은 한도를 먼저 깔고 켠다

> **한 줄 판정**: ★설계 확정 + 구현 착지, **기본값 OFF**. 완료 후크는 **PR 머지가 아니라 `DONE` 전이**에 건다(머지 시점에 걸면 "머지됐지만 후속 남음" 4건에서 전부 오발한다). 전진 대상은 **암묵 미션(`missionKind: "implicit"`)뿐** — 명시 미션은 지휘자가 이미 운전하므로, 두 자율 경로의 이중 스폰은 런타임 락이 아니라 **`missionKind` 필드 하나의 분기로 구조적으로 배타**다. 그리고 무한루프의 판정 축은 스폰 **횟수**가 아니라 **열린 티켓 수의 단조 감소**다. 안전장치 3한도(연속 스폰 5 / 동시 슬롯 3 / 진행없음 2) + 승인필요 제외 + 사장님 입력 우선을 **전진 로직보다 아래에** 깔았고, 유닛 테스트 57건으로 고정했다. ★같은 날 그 **위 계층**(미션 쪼개기 + 미션→다음 미션, 티켓 `F2TAJlSgSP8Ag1qJNkp1`)이 얹혔다 — **같은 플래그 하나**로 함께 켜지고, 다음 미션은 **사장님 텔레그램 승인 없이 시작되지 않으며**, 스폰 전 토큰 잔여는 **사용량 탭이 읽는 그 함수**(`account-usage.getAccountRateLimits` → `harness-quota.ts`)를 읽는다. ★**2026-09-05 정정**: 그 "같은 플래그 하나"는 **MCP 서버에 도달하지 않고 있었다** — env allowlist 에 키가 없어 셸에 넣든 `v3/.env` 에 넣든 값이 자식에 안 실렸다. 두 계층 다 켤 수 없었다. 전달 경로를 잇고 **부팅 한 줄**로 켜짐 여부를 보이게 했다(아래 별도 항목).

## 무엇을 물었나

[[mission-conductor-observability-gaps]] 가 닫은 것은 "끊긴 것을 안 끊기게"였다. 그런데 그게 전부 들어가도 폐루프는 **스스로 전진하지 않는다** — 아무도 "다음"을 밀어주지 않기 때문이다.

사장님 지시: _"이게 그 미션을 닫는 최종 태스크인지 아님 그중 하나인지가 체크되면서, 그중 하나면 다음 태스크를 연달아 오케한테 알아서 스폰하도록 하는 메시지가 오케한테 들어가야 폐루프가 돌 것 같은데."_ 그리고 조건: _"무한루프랑 비용폭주는 방지하도록 설계만 잘해주고 가자."_

그래서 물음은 둘이다. **(1) 완료를 어디서 잡고 무엇을 신호에 담아야 오케가 다음을 결정할 수 있나. (2) 그 자율 루프를 무엇이 멈추게 하나.**

## 무엇을 했나

설계 문서를 코드보다 먼저 냈고, 순서를 **(1) 설계 → (2) 안전장치 → (3) 전진 로직**으로 고정했다. 판정은 전부 순수 모듈 2장(`advance-guards.ts` → `mission-advance.ts`)에 두고 Firestore I/O 는 `tools.ts` 가 한다(`merge-closeout.ts`·`implicit-mission.ts` 와 같은 분리). 후크는 `closeImplicitMissionIfComplete` 바로 옆, **DONE 에 이르는 두 경로 모두**에 걸었다.

## 결과 (수치)

| 설계 질문      | 판정                                     | 근거                                                                                                                                                                                                                                                   |
| -------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 완료 후크 지점 | **`DONE` 전이** (머지 아님)              | `merge_and_close` 는 `evaluateMergeCloseout` 을 거쳐 DONE 으로 끝나므로 DONE 후크가 머지를 **포함**한다. 반대로 머지에 걸면 `HOLD_REVIEW`(후속 남음) 4건 — F1 콜러블·F4 조직초대(당일), `N8sAY4Tj`(백필 미실행)·`84tDu7UW`(승인 대기) — 에서 전부 오발 |
| 귀속           | `tasks.contextId === missionId`          | 명시·암묵 공통. `board`/`lane:*` 는 미션 아님                                                                                                                                                                                                          |
| 전진 대상      | **암묵 미션만**                          | 지휘자가 `wire.ts:219,264` 에서 implicit 을 설계상 건너뛴다 = 아무도 안 미는 유일한 population. 진단 실측으로 **활성 미션 3건이 전부 implicit**                                                                                                        |
| 종결 판정      | 기존 `shouldCloseImplicitMission` 재사용 | 닫는 조건을 두 벌로 만들지 않는다. 마지막이면 미션이 닫히고 **신호는 안 나간다**                                                                                                                                                                       |
| 신호 내용      | **4갈래**                                | `readyNow`(지금 집을 수 있음) / `blocked`(선행 미충족) / `inFlight`(또 뽑지 마라) / `needsOwnerApproval`(자율 스폰 금지) + 권고 한 줄                                                                                                                  |
| 이중 스폰 방지 | **구조적 배타**                          | 지휘자=스텝·명시, 완료후크=티켓·암묵. `missionKind` 하나로 갈린다 — 락이 아니라 분기                                                                                                                                                                   |

안전장치(기본값):

| 한도           | 기본    | 판정 축                                   | 넘으면                                                 |
| -------------- | ------- | ----------------------------------------- | ------------------------------------------------------ |
| 연속 자율 스폰 | 5       | 사람 개입 이후 **배달된** 신호 수         | HALT + 사유                                            |
| 동시 슬롯      | 3       | `inFlight` 개수                           | **back-pressure** — 신호는 나가되 `readyNow` 를 비운다 |
| 진행 없음      | 2       | **열린 티켓 수가 안 줄어든** 연속 신호 수 | HALT + 사유                                            |
| 승인 필요      | —       | 배포·메일발송·결제·심사기간 화면          | `readyNow` 에서 제외 → 오케가 사장님께                 |
| 사장님 입력    | —       | 미해결 질문 ∨ 미소비 오너 인바운드        | hold(자율보다 우선) + 연속 카운터 0 리셋               |
| 플래그         | **off** | `MISSION_ADVANCE_SIGNAL` **정확히** `on`  | 아무것도 읽지 않는다. ★값이 MCP 프로세스까지 **전달돼야** 판정 자체가 성립한다(2026-09-05) |

표본/재현단위: 유닛 테스트 **57건**(안전장치 27 + 전진 로직 30), 재현 단위는 완료 1건당 판정 1회(순수 함수, 라이브 보드 불요). 회귀 확인: `npm run typecheck` 통과, 인접 스위트 245건(미션 엔진·지휘자·merge-closeout·implicit-grouping·회수) 전량 통과.

## 왜

**머지에 걸면 안 되는 이유**는 `merge-closeout.ts` 가 이미 판정해 뒀다 — _"코드 머지 ≠ 작업 완료"_. 머지는 코드가 착지한 사실이고, 티켓의 목표는 아직 시크릿·승인·라이브 재실행을 남겨둘 수 있다. **아직 안 끝난 일 위에 다음 일을 쌓는 것**이 비용 폭주의 가장 흔한 시작점이다. `DONE` 은 그 후속까지 끝났다는 사람의 판정이라, 후크를 거기 걸면 지연은 생겨도 오발은 없다.

**중복을 락이 아니라 분기로 막은 이유**: 락은 잊히고 분기는 타입에 남는다. 지휘자는 이미 implicit 을 건너뛰는 코드를 가지고 있었으므로, 완료후크가 그 반대편만 채우면 두 경로가 같은 미션을 동시에 운전하는 상태는 **만들어질 수 없다**. 조율해야 할 경합 자체가 없어진다.

**무한루프의 축이 스폰 횟수가 아닌 이유**가 이 설계에서 가장 비직관적인 부분이다. 신호는 티켓이 `DONE` 될 때만 나가므로 **매 신호가 "티켓 하나 닫힘"을 동반한다** — 겉보기엔 늘 진행 중이다. 진짜 폭주의 모양은 다르다: 오케가 신호를 받고 형제를 집는 대신 **새 티켓을 더 만든다.** 그러면 티켓은 계속 닫히는데 미션의 **열린 티켓 수는 줄지 않는다.** 연속 스폰 한도는 사람 개입 때마다 리셋되므로 이걸 못 잡는다. 그래서 판정을 `openCount` 의 단조 감소로 걸었다.

**멈춤에 사유가 세 곳 남는 이유**는 [[mission-conductor-observability-gaps]] 가 세운 규약 그대로다 — 조용히 멈추면 그때 고친 문제가 형태만 바꿔 재발한다. 그리고 **배달 실패(`failed`)는 연속 카운터를 올리지 않는다**: 닿지도 않은 신호를 한도에 세면 미션이 진행 없이 한도만 태우고 멈춘다.

## 한계 / 정직성

- **`status: active` 이지 `verified` 가 아니다.** 플래그가 OFF 라 이 경로는 **라이브에서 한 번도 돈 적이 없다.** ★그리고 2026-09-05 이전에는 켤 방법 자체가 없었다(전달 경로 부재 — 아래 항목). 고정된 것은 순수 함수의 판정이고, 실제 오케가 이 신호를 읽고 옳게 dispatch 하는지는 **미확정**이다.
- 한도 기본값 5 / 3 / 2 는 **실측이 아니라 판단**이다. 동시 슬롯 3의 유일한 실측 근거는 "오늘 손배치로 11기까지 갔다"인데, 그건 사람이 배치한 수라 자율 상한의 근거로는 약하다. 사장님 검토 후 조정할 값이다.
- 승인필요 분류는 **표지 문자열 매칭**이다(부정어 창 포함). 표지가 없는 배포 티켓은 못 잡는다. 그래서 스캔 면을 `merge-closeout` 보다 **넓혀** 본문까지 본다 — 저기서는 오탐이 가볍고(REVIEW 에 남음) 여기서는 누락이 무겁다(승인 없이 배포 스폰). 방향이 반대라 같은 규율을 쓰되 값을 다르게 잡았다.
- 사장님 입력 감지는 (a) 미션 티켓의 미해결 질문 (b) 미소비 오너 인바운드 두 축이다. 텔레그램/슬랙을 거치지 않은 구두 지시는 **관측되지 않는다**.
- 명시 미션 경로는 한 줄도 안 건드렸다 — 거기서 폐루프가 도는지는 이 노트가 답하지 않는다.
- (F2TAJlSg) 상위 계층도 **플래그가 OFF 라 라이브에서 한 번도 돈 적이 없다.** 사장님께 질문이 실제로 닿는지, 답을 받은 오케가 옳게 이어가는지는 **미확정**이다.
- (F2TAJlSg) 사장님 답변은 기존 오너 인바운드 경로로 오케에 닿는다 — 이 계층은 답을 **파싱하지 않는다**. 승인 판단은 오케가 한다.
- (F2TAJlSg) 다음 미션 후보는 **워크체인에 적힌 것**뿐이다. 체인에 안 적힌 일은 후보가 되지 않는다.
- (F2TAJlSg) 토큰 게이트가 보는 하네스는 잔여를 실제로 조회할 수 있는 `claude`·`gpt` 둘뿐이다(그 외 벤더는 공개 API 자체가 없다).
- 수치가 갈리면 원본이 옳다.

## 그 위 계층 (2026-09-04, 티켓 `F2TAJlSgSP8Ag1qJNkp1`)

같은 날 사장님이 계층 하나를 더 지시하셨다:

> _"오케브레인 미션을 하나씩 끝내면서 다음 미션으로 넘어가는 형태로 가도록 체크할 수 있어? 다만 이 루프에서 우리 유세이지탭에 사용량 토큰 잔여량을 체크하면서 스폰을 진행하고, 텔레로 다음 미션의 시작은 사용자에게 물어보고 가능 형태로 설계하면 어떨까"_

그리고 **"한번에 켜줘"**.

| 계층      | 무엇을                               | 트리거                          |
| --------- | ------------------------------------ | ------------------------------- |
| #1412     | 끊긴 것을 안 끊기게                  | 조용한 정지 5지점               |
| #1414     | **미션 안에서** 태스크 → 다음 태스크 | 티켓 `DONE` 전이                |
| F2TAJlSg  | **미션 쪼개기 / 미션 → 다음 미션**   | **미션이 닫힌 순간**            |

| 물음                              | 판정                                                                                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 아무도 못 집는 지시를 어떻게 찾나 | 워크체인 `source === "owner"` ∧ `evidenceTaskIds.length === 0`. **새 판정 축 0** — `work-chain-core` 의 완료 판정 집합을 그대로 읽는다. 티켓이 붙은 항목은 자동 제외 |
| 쪼개는 주체                       | **오케다.** 기계가 사장님 지시를 티켓으로 번역하지 않는다 — 번역이 틀리면 아무도 모른다. `[Mission Split]` 로 오케를 깨우는 데서 멈춘다        |
| 다음 미션 선택 순서               | **명시적 사전식 네 키**(가중치 0): ①`source === "owner"` ②막고 있는 다른 열린 항목 수(많은 순) ③이미 착수됨(`reachedCount > 0`) ④체인 배열 순서(=우선순위). index 가 유일하므로 **전순서**이고 동률이 없다. ★index 는 전순서라 **그 아래 축은 죽은 코드**이고 위의 축은 필연적으로 배열 큐레이션을 덮는다 — 그래서 ②③ 은 _사장님이 배열을 정하실 때 손에 없던 구조적 사실_ 만 골랐다(hKdbFBcR) |
| 후크 지점                         | `closeImplicitMissionIfComplete` 가 missionId 를 돌려준 사실 하나. #1414 의 신호와는 배타(그 시점 미션이 이미 `completed` → `mission-terminal`) |
| ★다음 미션 시작                   | **사장님 텔레그램 승인 없이는 시작되지 않는다.** 질문을 보내고 거기서 멈춘다 — 판정 액션 집합에 "스폰하라"가 **타입으로 존재하지 않는다**       |
| ★토큰 잔여를 어디서 읽나          | **사용량 탭이 그리는 그 실측.** 아래 별도 항목                                                                                                |
| 임계값                            | 새로 만들지 않았다. 라우터가 near-limit 하네스를 자를 때 쓰는 `reservePct`(`MARBLO_QUOTA_RESERVE_PCT`, 기본 10) 그대로                         |
| 플래그                            | **`MISSION_ADVANCE_SIGNAL` 하나.** 이 계층은 환경변수를 한 줄도 읽지 않는다                                                                    |

표본: 유닛 테스트 **36건** 신규(누적 93건). `npm run typecheck` 통과, 인접 스위트 169건 전량 통과.

### ★잔여량 소스 — 화면과 루프가 갈라질 자리가 없다

사장님이 짚으신 지점이 여기다: _"잔여량을 어디서 읽는지가 중요하다 — 사용량 탭이 보는 것과 같은 소스여야 한다. 다르면 화면과 루프가 다른 숫자를 보고, 그건 신뢰 사고다."_

**새 프로브도, 새 합성도, 새 엔드포인트도 만들지 않았다.** 두 경로가 같은 함수에서 갈라진다:

```
        electron/account-usage.ts :: getAccountRateLimits()
          ├─ IPC "usage:accountRateLimits"  → 사용량 탭 "한도(Rate limit) 상태" 패널
          └─ 브리지 GET /model-guidance     → harness-quota.ts :: harnessQuotaRows()
                                            → quota.harnesses[].remainingPercent → 이 게이트
```

`harness-quota.ts` 가 이미 그 불변식을 소유하고 있었다 — _"합성은 여기 한 번만 하고, dispatch 도 guidance 도 이 함수의 결과를 쓴다(읽는 셀 = 쓰는 셀)"_. 그 파일이 생긴 계기 자체가 같은 사고였다: 2026-08-07 에 주간 롤업 추정치가 상시 100% 로 포화돼 **사용량 탭과 라우터가 88%p 갈라져** 있었다. 그래서 이 게이트는 새 소스를 만드는 대신 **그 단일 지점에 붙었고**, 갈라짐 감시(`quotaDivergences`, 임계 15%p)도 공짜로 얻었다.

`null`(조회 불가)은 **"모름"이지 "0% 잔여"가 아니다.** 모름을 소진으로 접으면 프로브 없는 기기에서 폐루프가 영영 멈춘다(= [[mission-conductor-observability-gaps]] 가 고친 조용한 정지의 재발). 그래도 안전한 이유는 **두 게이트가 직렬이고 승인 게이트가 무조건**이기 때문이다 — 토큰 판정의 불확실성이 무단 스폰으로 이어질 수 있는 경로가 없고, "못 읽었다"는 사실은 사장님께 나가는 질문에 그대로 실린다.

### 게이트 순서가 토큰 먼저인 이유

토큰이 부족한 상태에서 "다음 미션 시작할까요?"를 여쭈면 사장님이 승인하셔도 스폰이 안 된다. 그래서 부족하면 **질문이 아니라 보고**가 나간다("시작하지 못했습니다, 사유는 …"). 여쭙기 전에 할 수 있는지 먼저 확인하는 것이 맞다.

## ★플래그가 도달하지 않던 길 (2026-09-05, 티켓 `zyHtb4bjBSUWpzQ46avD`)

위 표들이 "플래그 하나로 켠다"고 적어둔 동안, **그 플래그는 판정하는 프로세스에 도달하지 못하고 있었다.** 노트가 틀린 게 아니라 한 칸을 안 본 것이다 — 판정이 어디서 도는지는 적었지만, 그 값이 **거기까지 어떻게 가는지**는 아무도 적지 않았다.

실측(2026-09-05): 돌고 있는 오케의 MCP config(`marblo-agent-configs/claude-mcp-orchestrator-*.json`)의 `marblo` 서버 `env` 를 직접 열어보니 `MISSION_ADVANCE_SIGNAL` 이 **없다**.

| 자리                                    | 무엇을 한다                                | 결과                             |
| --------------------------------------- | ------------------------------------------ | -------------------------------- |
| `advance-guards.ts :: isAdvanceSignalEnabled` | **MCP 서버 프로세스의** `process.env` 를 읽는다 | 읽을 값이 없으면 항상 off        |
| `agent-config.ts :: getMCPServerEnv`    | MCP 자식의 env 를 **allowlist 로** 조립한다 | `PATH` · `MARBLO_*` · `VITE_FIREBASE_*` 뿐 |

즉 앱 프로세스가 값을 가지고 있어도 자식에게 넘기는 줄이 없었다. **켰다고 믿을 뿐 켜진 적이 없다**가 정확한 서술이다.

**고친 방식 — 목록을 열지 않고 키 하나만.** allowlist 가 닫혀 있는 것 자체가 설계다(자식이 앱의 시크릿을 통째로 물려받지 않는다). 그래서 `process.env` 통과가 아니라 `MISSION_ADVANCE_SIGNAL` 한 키만 명시적으로 추가했다.

**값의 출처는 앱 프로세스 `process.env` 뿐이다.** 전달부가 `v3/.env` 를 따로 읽지 않는다 — `main.ts` 가 부팅 때 dotenv 로 `v3/.env` 를 이미 `process.env` 에 싣기 때문에 셸과 `.env` 가 자동으로 둘 다 커버되고, 파일을 두 번 읽으면 "앱이 본 값"과 "MCP 가 본 값"이 갈라질 자리가 생긴다(§잔여량 소스와 **같은 규율**: 같은 사실을 두 번 합성하지 않는다). 부작용으로 앱 재시작 없이는 못 바꾸게 되는데, **비용이 나가는 스위치에는 그게 오히려 정상**이다.

**값은 가공하지 않는다.** 트림도 소문자화도 기본값도 전달 경로에서 하지 않고 원문 그대로 싣는다. "정확히 `on`" 판정의 단일 지점은 `isAdvanceSignalEnabled` 하나여야 한다 — 전달 경로가 `" ON "` 을 미리 다듬거나 미설정에 `"off"` 를 채우면 판정이 두 곳으로 쪼개진다.

**부팅 한 줄.** 도달 실패가 **조용했던** 것이 이 사고가 며칠을 간 이유다(= 조용한 정지 규약 위반). MCP 부팅 배너 옆에 stderr 한 줄을 붙였다 — 원문을 그대로 보여주므로 `"true"`·`"1"` 오타가 왜 OFF 인지 값을 보면 안다.

```
[advance-signal] MISSION_ADVANCE_SIGNAL="on" → ON — 자율 전진 신호가 켜져 있다(한도는 advance-guards 가 건다).
[advance-signal] MISSION_ADVANCE_SIGNAL=(미설정) → OFF — …
```

### 켜는 절차

1. `v3/.env` 에 `MISSION_ADVANCE_SIGNAL=on` 한 줄(정확히 `on`. `true`·`1`·`yes` 는 전부 OFF).
2. **Marblo 앱을 재시작한다.** dotenv 는 부팅 때 한 번만 읽는다.
3. **에이전트를 새로 스폰한다.** MCP config 는 스폰 시점에 쓰이므로 이미 떠 있는 오케는 옛 env 를 그대로 물고 있다.
4. 새 MCP 서버 stderr 의 `[advance-signal] … → ON` 을 확인한다. 이 줄이 없거나 `→ OFF` 면 안 켜진 것이다.

끄는 것은 반대로: 그 줄을 지우거나 값을 바꾸고 **앱 재시작 + 새 스폰**.

## 실제 영향

**변경 있음**(2026-09-04, 티켓 `Sf8Id64jLeyDvWIS4cub`). **단 기본값 OFF** — 켜기 전까지 런타임 동작은 불변이다.

- 신규 `v3/electron/mcp-server/advance-guards.ts` — 한도·승인필요 분류·플래그(순수)
- 신규 `v3/electron/mcp-server/mission-advance.ts` — 귀속·종결·4갈래 분류·신호 본문(순수)
- `v3/electron/mcp-server/tools.ts` — `update_task_status` 와 `merge_and_close` 의 **양쪽** DONE 자리에 후크 + 배달 결과 3분기 처리
- (F2TAJlSg) 신규 `v3/electron/mcp-server/mission-handoff.ts` — 분해 대상·선택 순서·게이트 둘(순수)
- (F2TAJlSg) `advance-guards.ts` 에 `evaluateTokenBudgetGate` 추가 — ★한도는 여전히 **한 파일**이다
- (F2TAJlSg) `tools.ts` — 미션이 닫힌 자리(양쪽 DONE 경로)에 핸드오프 후크, 텔레그램 아웃바운드를 모듈 스코프로 올려 **경로 하나**로 통일
- (zyHtb4bj) `v3/electron/agent-config.ts :: getMCPServerEnv` — allowlist 에 `MISSION_ADVANCE_SIGNAL` **한 키만** 추가(원문 그대로, 기본값 없음). 이 줄이 없으면 위 계층 둘 다 켤 수 없다
- (zyHtb4bj) `advance-guards.ts` 에 `formatAdvanceSignalBootLine` + `mcp-server/index.ts` 부팅 한 줄 — 도달 여부가 더는 조용하지 않다

앞으로 자율 루프를 하나라도 더 만들 때 지킬 규칙 — 셋 다 테스트가 지킨다:

1. **완료 후크는 "코드가 착지한 시점"이 아니라 "일이 끝났다고 판정된 시점"에 건다.** 머지·배포·PR 클로즈는 전부 전자다.
2. **두 자율 경로가 같은 대상을 밀 수 있으면, 조율하지 말고 소유 필드로 갈라라.** 런타임 락으로 맞추려는 순간 그 락을 잊는 세 번째 경로가 생긴다.
3. **자율 루프의 정지 조건은 "몇 번 돌았나"가 아니라 "일이 실제로 줄고 있나"로 건다.** 그리고 **멈춤에도 사유가 남아야 한다** — 조용한 정지는 정지하지 않은 것보다 나쁘다.
4. **화면이 보여주는 수치로 기계가 판단해야 하면, 새로 합성하지 말고 화면이 읽는 함수를 읽어라.** 같은 사실을 두 번 합성하면 언젠가 갈라지고, 갈라진 뒤에는 어느 쪽이 맞는지 아무도 모른다.
5. **자율 루프에 사람 게이트를 넣을 거면, "스폰하라"를 뜻하는 반환값이 타입에 없게 만들어라.** 관례로 지키면 언젠가 우회하는 경로가 생긴다.
6. **플래그를 만들면 그 값이 판정하는 프로세스까지 가는 경로를 같은 변경에서 증명하라.** 판정 함수의 유닛 테스트는 전부 초록이어도 전달 한 줄이 없으면 스위치는 존재하지 않는다 — 그리고 **켜졌는지 보이는 줄**이 없으면 그 사실이 조용히 며칠을 간다.

## Evidence

- [v3/docs/mission-advance-signal-design-2026-09-04.md](../../../v3/docs/mission-advance-signal-design-2026-09-04.md) — 설계 전문(§2 후크 지점 근거, §6 지휘자와의 관계, §7 안전장치)
- [v3/docs/mission-closed-loop-diagnosis-2026-09-04.md](../../../v3/docs/mission-closed-loop-diagnosis-2026-09-04.md) — 선행 진단(§1 활성 미션 3건 전부 implicit, §2 실측표)
- [v3/electron/mcp-server/advance-guards.ts](../../../v3/electron/mcp-server/advance-guards.ts) — `evaluateAdvanceGuards`, `detectApprovalSignals`, `isAdvanceSignalEnabled`
- [v3/electron/mcp-server/mission-advance.ts](../../../v3/electron/mcp-server/mission-advance.ts) — `evaluateMissionAdvance`, `classifySiblings`
- [v3/electron/mcp-server/merge-closeout.ts](../../../v3/electron/mcp-server/merge-closeout.ts) — `evaluateMergeCloseout` 의 `HOLD_REVIEW` 분기(후크 지점 근거의 원천)
- [v3/tests/unit/mission-advance-guards.test.ts](../../../v3/tests/unit/mission-advance-guards.test.ts) — 한도 27건
- [v3/tests/unit/mission-advance-signal.test.ts](../../../v3/tests/unit/mission-advance-signal.test.ts) — 전진 로직 30건
- [v3/docs/mission-layer-advance-design-2026-09-04.md](../../../v3/docs/mission-layer-advance-design-2026-09-04.md) — ★상위 계층 설계 전문(§2 쪼개기, §3 선택 순서, §4 게이트 둘과 잔여량 소스, §7 플래그 하나)
- [v3/electron/mcp-server/mission-handoff.ts](../../../v3/electron/mcp-server/mission-handoff.ts) — `evaluateMissionHandoff`, `selectHandoffCandidates`, `selectSplitTargets`, `countBlockedBy`(K2), `OWNER_CHOICE_LIMIT`(상위 N)
- [v3/electron/harness-quota.ts](../../../v3/electron/harness-quota.ts) — ★잔여량 합성 단일 지점(사용량 탭과 같은 소스라는 근거의 원천)
- [v3/electron/account-usage.ts](../../../v3/electron/account-usage.ts) — `getAccountRateLimits()`; 사용량 탭은 IPC `usage:accountRateLimits` 로, 이 루프는 브리지 `/model-guidance` 로 **같은 함수**를 읽는다
- [v3/tests/unit/mission-handoff.test.ts](../../../v3/tests/unit/mission-handoff.test.ts) — 상위 계층 54건(승인 게이트·토큰 게이트·★우선순위 진리표·상위 N 제안·플래그 단일성). 축별 뮤테이션 4종이 전부 kill 된다
- [v3/electron/agent-config.ts](../../../v3/electron/agent-config.ts) — `getMCPServerEnv`; ★플래그가 MCP 자식에 실리는 **유일한** 자리(2026-09-05 전에는 이 줄이 없었다)
- [v3/tests/unit/advance-signal-env-delivery.test.ts](../../../v3/tests/unit/advance-signal-env-delivery.test.ts) — 전달·무가공·allowlist 폐쇄성·부팅 줄 11건(전달 한 줄 제거 뮤테이션으로 가드 실재 확인)

## Backlinks

- [[mission-conductor-observability-gaps]] — 같은 폐루프의 **반대 축**: 저기는 "끊긴 것을 안 끊기게", 여기는 "완료가 다음을 부르게"
- [[closed-loop-one-turn-and-its-stops]] — 이 노트의 판정이 **한 바퀴 어디에 놓이는지**. 순서와 멈추는 자리는 거기가 맡는다
