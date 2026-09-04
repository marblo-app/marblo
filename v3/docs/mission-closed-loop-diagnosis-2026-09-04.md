# 미션 폐루프가 안 도는 이유 — 지휘자 정지 지점 진단

- 티켓: `wUPbx6EKWSpXaUsOAI9q`
- 일자: 2026-09-04
- 대상 프로젝트: `GFB8JnJrrX6AgahqmGB3`
- 재현 테스트: `v3/tests/unit/mission-conductor-silent-stall.test.ts`

관찰 원문(사장님): _"오케브레인과 미션이 태스크 단위로 떨어지고 완료되면 다시 미션에서
다음을 이어서 태스크 분해하고 이어지는 클로즈드 루프도 기능 구현했었는데 이게 잘 안 되는 것 같다."_

이 문서는 **원인 특정 + 최소 재현**까지다. 고치는 것은 후속 티켓이다(§6).
확정과 미확정을 §5 에서 분리해 적었다.

---

## 1. 결론 먼저

**폐루프 코드가 고장난 게 아니다. 지금 이 프로젝트에는 폐루프가 운전할 대상이 0건이다.**

활성 미션 3건은 전부 `missionKind: "implicit"` — 실행 계획(`steps`)이 없는 **Replay 라벨**이고,
설계상 미션 엔진 픽업에서 통째로 제외된다. 스텝을 가진 명시 미션은 현재 **0건**이다.
지휘자(Conductor)는 정상 대기 중이며, 허가할 스텝이 없어서 조용하다.

그래서 1차 과제는 "폐루프를 고치는 것"이 아니라 **"미션이 안 걸려 있다는 사실이 화면에 보이는가"** 다.
지금은 보드에 `active` 3건이 떠 있어 **돌고 있는 것처럼 보인다** — 이것이 관찰과 실제의 간극이다.

동시에, 폐루프가 실제로 돌기 시작하면 **조용히 멈출 수 있는 지점이 3곳 확인됐다**(§4 의 A/C/D).
이건 지금 안 보일 뿐 사라진 문제가 아니라서, 재현 테스트로 고정해 뒀다.

---

## 2. 활성 미션 실측

`missions` 컬렉션을 Firestore REST 로 직접 조회(`projectId == GFB8JnJrrX6AgahqmGB3`, 2026-09-04 실측).

| 상태                                                                  | 건수   |
| --------------------------------------------------------------------- | ------ |
| `active`                                                              | 3      |
| `completed`                                                           | 21     |
| 그 외(`planning`/`sleeping`/`waiting_for_human`/`failed`/`abandoned`) | 0      |
| **합계**                                                              | **24** |

active 3건의 실제 모양:

| missionId              | kind     | steps | currentStepIndex | taskIds | lastActivityAt |
| ---------------------- | -------- | ----- | ---------------- | ------- | -------------- |
| `27CNOI0pdxvsSjVwuB3x` | implicit | **0** | 0                | 3       | 2026-08-21     |
| `N2hEH1t7Eh8WdAxQS0KC` | implicit | **0** | 0                | 8       | 2026-08-30     |
| `uiig9mvbutT5SV1Op5JD` | implicit | **0** | 0                | 0       | 2026-09-02     |

**세 건 모두 `steps: []`, `missionKind: "implicit"`.** 이건 사고가 아니라 설계된 값이다:

> `steps: []` / `contextLog: []` 는 의도된 값이다 — 암묵적 미션은 실행 계획이 아니라 **라벨**이다.
> (`electron/mcp-server/implicit-mission.ts`)

그리고 부팅 복구는 이 마커를 보고 명시적으로 건너뛴다:

```ts
// electron/mission-engine/wire.ts
// ★암묵적 미션(오케가 ad-hoc 배치에 붙인 Replay 라벨)은 실행 계획이
// 없다(steps=[]). 엔진이 이어받으면 0-스텝 미션을 헛돌린다.
if (isImplicitMission(d.data())) continue;
```

**⇒ 확정: 지휘자가 허가할 스텝이 하나도 없다. 폐루프는 멈춘 게 아니라 시작된 적이 없다.**

부가 관측: `lastActivityAt` 이 각각 14일 / 5일 / 2일 전이다. `active` 인데 최신 것도 이틀째 조용하다.
이 세 건을 닫거나 보관하는 경로가 돌지 않고 있다는 뜻이기도 하다(§6-4).

---

## 3. 지금 실제로 도는 드라이버는 B안(지휘자)이다

코드만 읽으면 반대로 읽힌다. 기본값이 A안이기 때문이다:

```ts
// electron/mission-engine/conductor-driver.ts
const DEFAULT_DRIVER: MissionDriver = "engine";
```

그러나 **실행 중인 Electron main 프로세스(pid 82786)의 env 에 `MISSION_DRIVER=orchestrator` 가 설정돼 있음을 실측**했다.
(이 워크트리에는 `.env` 가 없고 본 체크아웃 `v3/.env` 에만 키가 있다. 값은 위 한 줄이 전부이며 비밀이 아니다.)

**⇒ 확정: 활성 드라이버는 B안(Conductor)이다.**
따라서 티켓이 지목한 _"dispatch 실패 / decompose 실패 폴백"_ 은 **A안 엔진 advance-loop 의 경로이고 현재 도달 불가**다
(`scheduleAdvance` 가 orchestrator 모드에서 곧장 `conductor.requestAdvance` 로 위임하고 리턴한다).
원인 후보에서 제외한다. 이 판정은 `MISSION_DRIVER` 가 바뀌면 뒤집힌다.

---

## 4. 끊길 수 있는 지점 전수 — 조용한가, 사유가 남는가

정상 폐루프 1회전:

```
requestAdvance → advance → grantStep(오케 PTY 에 '이 스텝만' 주입)
   → [오케가 작업] → mission_step_done MCP
   → 'mission.step_reported' 이벤트 → onStepReport
   → verifyGate → pass → passStepAndAdvance → 다음 grantStep …
```

이 사슬에서 끊길 수 있는 지점을 전수로 뽑고, **조용히 멈추는가 / 저널·화면에 사유가 남는가** 로 갈랐다.
조용히 멈추는 것이 가장 나쁘다 — 아무도 못 알아채기 때문이다.

| #     | 끊김 지점                              | 코드                                                                | 사유가 남는가                                 | 확정도       |
| ----- | -------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------- | ------------ |
| **A** | **오케 세션 부재 → grant 미배달**      | `grantStep` 의 `no live owner orchestrator session` 조기 return     | ❌ **조용함**                                 | 확정(테스트) |
| **B** | 보고 누락 (오케는 생존)                | `startReportWatch` → nudge×3 → escalate                             | ✅ 타임라인 + 사용자 알림                     | 확정(테스트) |
| **C** | **재시작 후 남은 `running` wait 스텝** | `grantStep` 의 중복-grant 가드가 wait 분기보다 앞                   | ❌ **조용함**                                 | 확정(테스트) |
| **D** | **주입이 거부됐는데 성공으로 기록**    | `OrchestratorRef.postMessage` 가 `injectMessage` 의 `false` 를 버림 | ⚠️ 지연 후에만 (B 로 흡수)                    | 확정(코드)   |
| E     | `ensureSession` throw                  | `grantStep` 의 `ensureSession failed` 조기 return                   | ❌ 조용함                                     | 확정(코드)   |
| F     | `postMessage` throw                    | catch 후 `startReportWatch` 는 정상 진입                            | ✅ B 경로로 흡수                              | 확정(코드)   |
| G     | 게이트 미통과 (gstack/fix)             | `handleStepFailure` → retry×2 → escalate                            | ✅ `supervisor.note` + `step.failed`          | 확정(코드)   |
| H     | 게이트 미통과 (wait/dispatch)          | 재시도 없이 running 유지 + 이벤트 대기                              | ⚠️ `awaiting_tasks` 노트는 남지만 만료가 없음 | 확정(코드)   |
| I     | 미션이 `active` 아님                   | `advance` / `onStepReport` 의 조기 return                           | ❌ 조용함(단, 상태 자체는 화면에 보임)        | 확정(코드)   |
| J     | stale stepIndex 보고                   | `onStepReport` 의 `stale step report ignored`                       | ❌ 조용함                                     | 확정(코드)   |

### A — 오케 세션이 죽으면 미션은 사유 없이 선다 (가장 나쁨)

`grantStep` 의 순서가 문제다:

1. 스텝을 `running` 으로 마킹하고 `step.started` 타임라인을 남긴다.
2. 살아있는 오케 세션을 찾는다. 없으면 `ensureSession` 을 시도한다.
3. 그래도 없으면 **`return`** — 여기서 끝난다.
4. `startReportWatch(...)` 는 **3번 return 보다 아래**에 있다.

즉 **감시 타이머가 아예 걸리지 않는다.** nudge 도, escalate 도, `step.failed` 도 영원히 없다.
남는 것은 `step.started` 하나뿐이라, 저널만 보면 **"이 스텝은 시작됐고 지금 진행 중"** 으로 읽힌다.
미션은 `active` + 스텝 `running` 인 채로 무한정 서 있으면서 **도는 것처럼 보인다.**

기존 스위트(`mission-conductor.test.ts`, `mission-b-e2e.test.ts`)는 이 상황을
_"throw 하지 않고 running 마킹은 한다"_ 까지만 단언한다. **그 뒤로 아무 일도 일어나지 않는다는 사실은
아무도 고정하지 않았다.** 새 테스트 `[A]` 가 그 공백을 메운다.

### B — 대조군: 오케가 살아 있으면 사유가 남는다

같은 "보고 누락"인데 결말이 정반대다. watchdog 이 240초 간격으로 최대 3회 nudge 를 주입하고,
한도를 넘기면 `waiting_for_human` 으로 전이하며 타임라인에 남긴다:

```
step.failed { error: "report timeout (no mission_step_done)", policy: "escalate", notifyUser: true }
```

A 와 B 의 유일한 차이는 **오케 세션 생존 여부** 하나다. 증상은 같고 관측 가능성만 정반대다.

### C — 앱 재시작 시 wait 스텝이 영구 정지할 수 있다

재시작 복구(`engine.recoverInFlight`)는 step type 별로 다르게 처리한다:

- `gstack` / `fix` → `pending` 으로 되돌려 재실행 (**정상 — 재grant 된다**)
- `dispatch` → 기존 task 재연결 또는 `pending` (**정상**)
- `wait` → **`running` 그대로 두고 `resume`**

`wait` 를 그대로 두는 근거는 코드 주석에 있다: _"runWait 가 기존 taskIds 를 재폴링(안전)"_.
그런데 **`runWait` 는 A안 엔진의 것이고 B안 지휘자에는 없다.** 지휘자는 task 이벤트가 올 때만 wait 게이트를 재평가한다.

그리고 `grantStep` 의 가드 순서가 여기서 또 문제가 된다:

```ts
if (step.status === "running") { log(...); return; }   // ← 여기서 삼켜진다
...
if (step.type === "wait") { /* grant 시점 1회 게이트 평가 */ }   // ← 여기 못 온다
```

재시작 후의 re-grant 는 **중복-grant 가드에 통째로 삼켜져** wait 분기의 "grant 시점 1회 게이트 평가"에 도달하지 못한다.
**앱이 꺼져 있는 동안 task 가 전부 끝났다면 깨워 줄 이벤트가 다시는 오지 않는다** —
게이트 통과 조건을 이미 만족했는데도 미션은 영원히 선다. 타임라인에는 아무것도 안 남는다.

새 테스트 `[C]` 가 이걸 고정한다: 게이트가 `passed: true` 인데 `currentStepIndex` 가 0에 머물고 `contextLog` 가 비어 있으며,
뒤늦은 task 이벤트를 하나 흘려 넣으면 **즉시 전진한다**(= 정지 원인이 "게이트 미충족"이 아니라 "재평가 미트리거"임을 증명).

### D — 주입이 거부됐는데 지휘자는 "허가 완료"로 기록한다

`injectMessage` 는 4가지 이유로 `false` 를 돌려주며, **throw 하지 않는다**:

| refusal              | 뜻                                      |
| -------------------- | --------------------------------------- |
| `boot-gate-unstable` | 부팅/재기동 중이라 보류                 |
| `session-gone`       | 세션이 살아 있지 않다                   |
| `mission-changed`    | 대기 중 미션이 바뀌었다                 |
| `pty-refused`        | PTY 컴포저가 막혀 있다(초안·다이얼로그) |

그런데 어댑터가 그 boolean 을 **버린다**:

```ts
// electron/mission-engine/orch-registry-impl.ts
postMessage: async (message: string) => {
  const session = manager.getSession();
  if (!session) throw new Error("orchestrator session not running");
  await manager.injectMessage(message);   // ← 반환값(false)을 보지 않는다
},
```

`postMessage` 가 정상 resolve 하므로 지휘자는 `grantStep — granted to orchestrator` 를 로그에 남긴다.
**아무것도 배달되지 않았는데 허가한 것으로 기록된다.**

완전히 조용하지는 않다 — 이 경로는 `startReportWatch` 에 도달하므로 결국 B 로 흡수된다.
다만 **최소 4×240초 ≈ 16분**이 지나야 하고, 그때 나오는 사유는 `report timeout` 이라
**진짜 원인(주입 거부)을 가리키지 않는다.** `orchestrator-manager.ts` 는 이미 `lastInjectOutcome` 에
정확한 사유를 진단용으로 남기고 있는데, 지휘자가 그걸 읽지 않는다.

### H — `awaiting_tasks` 대기에는 만료가 없다

`dispatch`/`wait` 게이트가 미통과면 지휘자는 **재시도하지 않고** 스텝을 `running` 으로 유지한다
(재dispatch 로 중복 task 가 생기는 걸 막기 위한 의도적 설계). `supervisor.note { kind: "awaiting_tasks" }` 는 남는다.

문제는 **이 대기에 상한이 없다**는 것이다. 소속 task 가 IN_PROGRESS 로 죽어 있으면(=§5 의 고아 클레임)
미션은 게이트 앞에서 무기한 대기한다. 노트는 남으므로 "완전히 조용함"은 아니지만,
**아무도 그 노트를 보고 있지 않다**는 점에서 실질은 조용한 정지에 가깝다.
A/C 와 H 가 겹치면 폐루프는 어느 지점에서든 알림 없이 정지한다.

---

## 5. 앱 재시작과 고아 클레임 — 죽은 클레임을 되돌리는 경로가 있는가

**답: 회수 경로는 존재한다. 그러나 이번 사례에서 돌지 않았고, 설령 돌았어도 티켓을 살리지 못한다.**

### 5.1 실제 사례 실측 — `VCGuLWmNTlhoRvwGAKJA`

2026-09-04 실측 (사건 발생 약 9시간 후):

| 필드        | 값                                                                              |
| ----------- | ------------------------------------------------------------------------------- |
| `title`     | [P1·텔레그램·후속] powerSaveBlocker 가 걸려 있는데 왜 15~17분 서스펜션이 나는가 |
| `status`    | **`IN_PROGRESS`**                                                               |
| `claimedBy` | `d7419238-…` (**여전히 설정돼 있음 — 회수 안 됨**)                              |
| `claimedAt` | 2026-09-04 02:48                                                                |
| `updatedAt` | 2026-09-04 02:51 (**이후 무변화**)                                              |
| `contextId` | `board`                                                                         |
| `missionId` | **(없음)**                                                                      |

담당 에이전트 문서 `agents/d7419238-…`:

| 필드          | 값                                          |
| ------------- | ------------------------------------------- |
| `status`      | **`working`** (종료 처리 안 됨)             |
| `machineId`   | 본 머신과 일치                              |
| `instancePid` | `82786` (**지금도 살아 있는 dev Electron**) |
| `updatedAt`   | **필드 자체가 없음**                        |

부가 관측: 이 티켓은 `contextId: "board"` 이고 `missionId` 가 없다.
**고아가 된 일감은 미션 소속조차 아니었다** — 일이 미션이 아니라 보드를 통해 흐르고 있다는 §1 판정과 일치한다.

### 5.2 회수 경로는 있다

`main.ts` 에 10분 주기 `runGhostReclaimSweep` 이 있고, 판정은 `agent-lifecycle-reclaim.ts`
`evaluateGhostReclaim` 이 순수 함수로 한다. 통과하면 `releaseTaskClaimsForDeadAgent` 가 호출된다.

### 5.3 그런데 두 겹으로 막힌다

**(a) 게이트를 통과하지 못했다.**
`instancePid = 82786` 은 **지금도 살아 있는 프로세스**다(`ps` 로 확인 — dev Electron main).
`evaluateGhostReclaim` 은 이 상황에서 두 분기 중 하나로 간다:

- `inMemory === true` → `reclaim: false, "live in this instance's AgentManager"`
- `isPidAlive(82786) === true` → `reclaim: false, "pid 82786 alive — another Electron instance … may own it"`

**어느 분기였는지는 미확정**이다(실행 중 앱의 메모리를 건드리지 않기로 해 확인 보류 — §6-5).
확정인 것은 **둘 중 무엇이든 결과가 `reclaim: false`** 라는 점이다.
가드 자체는 의도된 보수성이다("다른 머신/다른 인스턴스의 살아있는 에이전트는 절대 건드리지 않는다").
문제는 **에이전트가 죽어도 그 에이전트를 띄운 Electron 이 살아 있으면 영원히 고아로 남는다**는 것이다.
`instancePid` 는 **에이전트의 pid 가 아니라 Electron 인스턴스의 pid** 라서, 앱이 안 죽으면 liveness 신호가 되지 못한다.

**(b) ★설령 통과했어도 티켓은 못 살린다.**
이쪽이 더 구조적인 문제다.

```ts
// main.ts — releaseTaskClaimsForDeadAgent
await fbUpdateDoc(fbDoc(db, "tasks", taskDoc.id), {
  claimedBy: null,
  claimedAt: null,
  updatedAt: now,
}); // ← status 는 손대지 않는다
```

`claimedBy` 만 지우고 **`tasks.status` 는 `IN_PROGRESS` 그대로 남는다.** 그런데 양쪽 입구가 전부 `TODO` 만 받는다:

- `get_available_tasks` → `where("status", "==", "TODO")` — **피드에 안 잡힌다.**
- `claim_task` → `if (task.status !== "TODO") return "Error: Task is not available for claiming (not in TODO status)."` — **집을 수 없다.**

**⇒ 확정: 회수돼도 그 티켓은 아무도 다시 집을 수 없는 상태가 된다.**
(이 세션 시작 시 `claim_task` 가 실제로 그 문구로 거부되는 것을 직접 관측했다.)

### 5.4 그리고 아무도 알아채지 못한다

`IN_PROGRESS` 인데 오래 조용한 티켓을 감시하는 경로가 없다.
미션 스텝에는 `startReportWatch`(240초 nudge)가 있지만, **보드 티켓에는 대응물이 없다.**
그래서 8~9시간 무산출이 알림 없이 지나갔다. 이것이 §4-H 와 만나면 미션도 같이 무기한 대기한다.

---

## 6. 확정 / 미확정 정리와 후속 제안

### 확정 (측정 또는 테스트로 뒷받침됨)

1. 활성 미션 3건은 전부 implicit·`steps: []` 이고 설계상 엔진 픽업에서 제외된다 → **운전할 스텝이 0건**.
2. 실행 중 드라이버는 `MISSION_DRIVER=orchestrator`(B안 지휘자).
3. **A** — 오케 세션 부재 시 grant 미배달 + watchdog 미장착 → 사유 없는 영구 정지. (테스트)
4. **B** — 오케 생존 시 보고 누락은 `report timeout` 으로 escalate 된다. (테스트)
5. **C** — 재시작 후 남은 `running` wait 스텝은 re-grant 가 가드에 삼켜져 재평가되지 않는다. (테스트)
6. **D** — `postMessage` 가 `injectMessage` 의 `false` 를 버려 거부된 주입이 "허가 완료"로 기록된다. (코드)
7. `releaseTaskClaimsForDeadAgent` 는 `status` 를 되돌리지 않아 `IN_PROGRESS` 티켓은 재클레임 불가. (코드 + 실측)
8. `VCGuLWmNTlhoRvwGAKJA` 는 실측 시점에 여전히 `IN_PROGRESS` + `claimedBy` 유지 = **회수되지 않았다.**

### 미확정 (추측으로 쓰지 않는다)

- `evaluateGhostReclaim` 이 `inMemory` 분기였는지 `isPidAlive` 분기였는지. **결과가 `false` 인 것만 확정.**
- 사장님이 "폐루프가 안 된다"고 느낀 그 순간에 A/C/D 중 무엇이 실제로 발생했는지.
  현재 활성 미션이 0건이라 **런타임 증거가 없다.** §1(미션 미등록)만으로도 관찰은 설명되지만,
  A/C/D 가 과거에 발생했을 가능성을 배제할 근거도 없다.
- implicit 미션 3건이 왜 `active` 로 남아 있는지(닫는 경로가 없는지, 조건 미충족인지). 이번 범위 밖.

### 후속 티켓 제안

| #   | 제안                                                                                                                                                                                                                 | 근거   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | **grant 미배달 시 사유를 남긴다** — `grantStep` 의 두 조기 return(A·E) 앞에 `step.failed`/`supervisor.note` 를 남기거나, `startReportWatch` 를 return 보다 위로 올려 최소한 escalate 는 되게 한다                    | §4-A   |
| 2   | **`postMessage` 가 주입 실패를 삼키지 않게 한다** — `injectMessageDetailed` 를 써서 refusal 을 지휘자까지 올리고 타임라인에 분류값으로 남긴다(PTY 원문 금지 규약 유지)                                               | §4-D   |
| 3   | **재시작 시 wait 스텝도 한 번은 재평가한다** — `recoverInFlight` 에서 wait 을 pending 으로 되돌리거나, 지휘자가 부팅 시 wait 게이트를 1회 평가한다                                                                   | §4-C   |
| 4   | **고아 클레임을 실제로 되살린다** — `releaseTaskClaimsForDeadAgent` 가 `status` 를 `TODO` 로 되돌리고(회수 사유를 activity 로 남김), 에이전트 liveness 를 Electron pid 가 아닌 에이전트 자신의 heartbeat 로 판정한다 | §5.3   |
| 5   | **오래 조용한 `IN_PROGRESS` 티켓을 감시한다** — 미션 스텝의 240초 nudge 에 대응하는 보드 티켓용 watchdog                                                                                                             | §5.4   |
| 6   | **"활성 미션 0건"이 화면에 보이게 한다** — implicit 라벨과 실행 가능한 미션을 UI 에서 구분한다. 지금은 `active` 3건이 떠서 도는 것처럼 보인다                                                                        | §1, §2 |

---

## 7. 재현 테스트

`v3/tests/unit/mission-conductor-silent-stall.test.ts` — 가짜 시계(`vi.useFakeTimers` + 주입된 `deps.now`)와
가짜 오케로 실시간 sleep 없이 3케이스를 고정한다.

| 케이스            | 단언                                                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `[A]` 오케 사망   | nudge 한도의 20배 시간이 지나도 `posts` 0, `notices` 0, 타임라인은 `["step.started"]` 하나뿐, `step.failed`·`supervisor.note`·`step.error` 전부 없음, 미션은 계속 `active`/`running` |
| `[B]` 보고만 누락 | nudge 정확히 3회 → `waiting_for_human` + `notices` 에 `escalate` + `step.failed.error === "report timeout (no mission_step_done)"` + `notifyUser === true`                           |
| `[C]` 재시작 wait | `verifyGate` 가 `passed: true` 인데 `currentStepIndex` 0 고정 + `contextLog` 비어 있음. 뒤늦은 task 이벤트 1건에 즉시 전진(원인이 재평가 미트리거임을 증명)                          |

**이 테스트들은 현재 동작을 고정하는 재현 테스트다.** `[A]`·`[C]` 가 조용한 것은 버그이며,
후속 티켓에서 고칠 때 **이 테스트가 빨간불이 되는 것이 의도된 신호**다.
