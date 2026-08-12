# RCA — 안티그래비티 born-dead 에이전트를 와치독이 못 잡음 (티켓 Tw9156cxfaa6PMBwzayr)

> 조사 전용 문서. 수정은 별도 후속 티켓 제안(§6). 모든 주장은 코드 라인 실증.
> 대상 커밋 기준 파일: `v3/electron/agent-watchdog.ts`, `agent-manager.ts`,
> `agent-status-reconcile.ts`, `bridge-server.ts`, `mcp-server/tools.ts`, `main.ts`.

## 0. 증상 (관측 사실)

- `wXOhvdp1` 이 **antigravity(agy)** 로 스폰됨. 활동로그 0 — `claim_task` 조차 호출 안 함 → 보드 무진행.
- 사장님 관측: **"안티그래비티는 항상 에러로 실패"**.
- ★핵심 증상: 오케가 `wXOhvdp1` 을 **재디스패치**했더니 새 에이전트로 재배정되지 않고
  **"이미 바인딩됨"** 이라며 **죽은 agy 에이전트를 그대로 재사용**함.
- 와치독은 이 스테일을 감지·복구·재라우팅하지 못함.

## 1. 한 줄 결론

> **에이전트 생사 판정이 — 와치독의 death 테스트와 dispatch 의 `findLiveTaskAgent` 재사용 게이트
> 양쪽 모두 — `agent.status` 에 의존하는데, 이 status 는 PTY 바이트 파생이라 프로세스가 깨끗이
> `exit` 할 때만 terminal(`stopped`/`error`)에 도달한다. agy 는 OAuth 벽 / 트러스트 다이얼로그 /
> 에러 배너를 계속 repaint 하며 "블록/행" 상태로 실패하지 exit 하지 않으므로, status 가 영구히
> `working`/`idle` 에 머문다. 그 결과 (a) 와치독은 이 에이전트를 절대 `dead` 로 보지 않고,
> born-dead·silent 감지기는 계속 흘러나오는 PTY 스피너 바이트에 무력화되며, (b) 죽은 agy 가
> 레지스트리에서 제거되지도 않아 task 바인딩을 영구 유지 → 재디스패치·respawn·reroute 가 전부
> 같은 죽은 agy 로 라우팅된다("이미 바인딩됨").**

이것은 `cf` 메모 `agent_working_derived_from_pty_bytes` (끝난 CLI = 영구 working 오판)의
정확한 재현이며, 이번엔 **dispatch 재사용 경로까지** 같은 오판을 공유한다는 점이 새로운 발견이다.

## 2. 생사 판정이 status 에 묶여 있고, status 는 terminal 로 안 간다

### 2-1. status 는 exit 로만 terminal 이 된다

`agent-manager.ts` PTY exit 핸들러(`onExit`, L987~1136):

- `stopRequested || exit 0 || graceful(nonzero after GRACEFUL_LIFETIME)` → `stopped` (L1022–1038)
- fast-fail/크래시 → 재시작 예산 소진 후에만 `error` (L1100–1135)

즉 **status 가 `stopped`/`error` 가 되려면 프로세스가 반드시 `exit` 해야 한다.**

### 2-2. 블록/행은 exit 하지 않는다 → status 는 working/idle 유지

- 첫 PTY 바이트가 `idle→working` 으로 자동 승격(`agent-manager.ts` onData L882–902,
  `shouldPromoteOnPtyOutput` `agent-status-reconcile.ts:116`). agy 는 배너/스피너/OAuth 프롬프트
  같은 바이트를 반드시 뱉으므로 → status = **working**.
- 45분 무출력 백스톱 `shouldDemoteAbandonedTurn`(`agent-status-reconcile.ts:174`)조차
  **`working→idle`** 로만 강등한다. **어떤 경로도 "행" 을 terminal 로 만들지 않는다.**
- 로그인 백스톱 `handleLoginScreen`(`agent-manager.ts:536–550`)은 `looksLikeLoginScreen` 이
  agy 의 실제 출력 패턴과 매치될 때만 `setStatus(error)` 를 건다. **관측된 재사용이 status 가
  non-terminal 이었음을 증명**하므로(§4-1) 이 백스톱은 이 인스턴스에서 발화하지 않았다 —
  즉 agy 는 로그인 화면 패턴에 안 걸리는 방식으로(프롬프트 주입 이후 에러, 미스매치 배너 등) 실패했다.

### 2-3. 죽은 agy 가 레지스트리에서 제거되지 않는다

`pruneDeadEntries`(`agent-manager.ts:366–379`)는 **`status ∈ {stopped,error}`** 인 항목만 제거(L369).
non-terminal(working/idle) 로 행 상태인 agy 는 **영구 잔류**하며 `currentTaskId` 바인딩을 계속 보유.

## 3. 와치독이 못 잡는 이유 (감지 갭)

`agent-watchdog.ts` `inspect()`:

```
missing       = getAgentHealth(agentId) === null          // agy는 레지스트리에 있음 → false
terminalLocal = status ∈ {stopped, error}                 // working/idle → false
lastActiveMs  = max(lastBoardMs, health.lastPtyActivityMs) // L813 ★PTY가 섞임
boardFresh    = now - lastBoardMs <= graceMs(5m)
dead   = !boardFresh && (terminalLocal || (missing && now-lastActiveMs >= 15m))  // L824
silent = !dead && !missing && now-lastActiveMs > graceMs                          // L830
noFirstActivity(born-dead) = !dead && !missing && seen≥3m && lastActiveMs<=baseline // L850
```

agy(working/idle, 레지스트리 존재)에 대입하면:

- `dead` = `!boardFresh && (false || (false && …))` = **항상 false**. 와치독은 이 agy 를 절대 죽었다고 안 본다.
- **PTY 바이트가 흐르는 경우**(agy 가 스피너/에러배너를 계속 repaint): `lastPtyActivityMs` 가 갱신되어
  `lastActiveMs` 가 신선 → `silent=false`, 그리고 `lastActiveMs > baseline` → `noFirstActivity=false`.
  → **nudge 도 respawn 도 발화 안 함. 완벽히 살아있어 보임.** (cf 메모의 오판을 와치독이 그대로 상속)
- **PTY 가 정말 조용한 경우**(부팅 후 무출력): graceMs(5m) 후 `silent=true` → nudge(죽은 PTY 에 write, 무의미).
  firstActivityGraceMs(3m) 후 `noFirstActivity=true` → **respawn 시도**. 그러나 §4 로 인해 respawn 이 무효화됨.

> 부가: 티켓 가시성은 갭이 아니다. `bindTaskToDispatchedAgent`(`mcp-server/tools.ts:498–524`)가
> dispatch 시 **TODO→CLAIMED** 로 승격하므로 `listActiveTickets`(`main.ts:1553`, CLAIMED/IN_PROGRESS
> 쿼리)가 티켓을 본다. 따라서 miss 의 본질은 "안 보임"이 아니라 **"살아있다 오판"**이다.
> (단 dispatch 가 `dispatch_task` 경로가 아니라 순수 `spawn_agent` 였다면 bind 가 없어 TODO 잔류 →
> 그땐 가시성 갭도 추가된다. 이번 관측은 재디스패치 재사용이 일어났으므로 dispatch_task 경로로 간주.)

## 4. respawn·재라우팅이 죽은 agy 로 재흡수되는 이유 (복구 갭)

### 4-1. `findLiveTaskAgent` — 재사용 게이트의 결함

`bridge-server.ts:2248–2269`:

```ts
const byTaskId = agents.find(
  (a) =>
    a.status !== "stopped" &&
    a.status !== "error" &&
    a.currentTaskId === taskId,
);
```

- **status 가 non-terminal 이기만 하면 "살아있는 task-bound 워커"로 판정**. model 도, 실제 진행도,
  board 활동도 보지 않는다.
- dispatch 최상단(`bridge-server.ts:1825–1836`)에서 이 함수가 스코어링보다 먼저 실행되어
  매치되면 `routeToTaskAgent`(L2271) → 죽은 agy PTY 에 write 하고
  `"Agent already bound to task … — routed instead of reassigning or spawning a duplicate"`(**L2292**)
  를 반환. → **관측된 "이미 바인딩됨" 증상과 정확히 일치.**
- §2-3 로 인해 죽은 agy 가 절대 사라지지 않으므로 이 매치는 **영구히 성립**한다.

### 4-2. 세 복구 경로가 모두 같은 함정에 빠진다

- **오케 수동 재디스패치** → `dispatchTask` → `findLiveTaskAgent` 재흡수 (관측된 경로).
- **와치독 respawn**(`respawnForTicket`, `main.ts:1634`) → 역시 `dispatchTask` → 재흡수.
  `respawnForTicket` 은 `res.success !== false` 를 성공으로 보므로(L1652) reused 응답을 **성공으로 오인**,
  실제로는 아무것도 안 바뀌었는데 respawn 카운터만 증가.
- **와치독 reroute(W4)**(`rerouteForTicket`, `main.ts:1822–1837`) → antigravity 는 gpt/codex 를 포함하지
  않으므로 `alt="gpt"` 로 재라우팅을 시도하지만, **`findLiveTaskAgent` 는 model 을 보지 않아** 여전히
  죽은 agy 로 재흡수된다. 게다가 reroute 는 **respawn 3회 소진 뒤에만** 1회 발화(`agent-watchdog.ts:1011`).

**결론: 실패모델 자동 재라우팅 경로는 존재하지만(코드 있음), `findLiveTaskAgent` 의 바인딩
단락(short-circuit)을 탈출할 수 없어 실질적으로 작동하지 않는다.**

## 5. 안티그래비티 스폰 실패의 반복성

- 사장님 진술 "항상 에러로 실패" + 코드상 agy 는 별도의 성공 검증 게이트가 없음(트러스트 다이얼로그
  자동응답 `agent-manager.ts:261`, 로그인 백스톱만 존재). agy 특유의 실패 신호를 terminal 로 분류하는
  로직이 **없다** → 실패가 항상 "working 처럼 보이는" 버킷으로 흘러든다. 따라서 **1회성이 아니라 상시적**
  실패 모델일 개연성이 높다.
- 단, agy 의 **실제 PTY 출력 원문**(어떤 에러/화면에서 멈추는지)은 이 조사에서 라이브 캡처하지 못했다.
  이는 수정(§6 Fix 2)의 정확한 패턴 작성에 필요 — 후속에서 라이브 관측 필요(§7 질문).

## 6. 수정 제안 (구현은 후속 티켓)

우선순위 순. Fix 1·3 이 관측 증상("이미 바인딩됨")을 직접 끊는 최소 침습 수정.

- **Fix 1 (핵심) — born-dead 는 바인딩 단락 승리 금지.**
  `findLiveTaskAgent` 와 와치독 death 테스트에서 "live/bound" 자격에 _status non-terminal_ 뿐 아니라
  _생존 증거_(스폰 후 board 활동 ≥1건, 또는 firstActivityGraceMs 이내)를 요구. board 활동 0 이고
  firstActivityGraceMs 경과한 에이전트는 status 가 working/idle 여도 유효 워커로 보지 않는다.

- **Fix 2 — agy(및 일반 CLI) 하드 실패를 명시적으로 terminal 화.**
  `looksLikeLoginScreen`/startup 매처에 agy 의 실제 실패·인증 패턴을 추가해 `setStatus(error)` 로
  귀결시켜 와치독·`findLiveTaskAgent` 양쪽이 terminal 로 취급하게 함. **agy 실제 출력 라이브 캡처 선행 필요.**

- **Fix 3 — 명시적 model reroute 는 재사용 단락을 깨야 한다.**
  `findLiveTaskAgent`(및 재사용 라우팅)이 명시적 model 요청을 존중: dispatch/reroute 가 바인딩된
  에이전트와 다른 model 을 지정하면 단락-재사용 금지 → 재배정/신규 스폰 허용. 없으면 reroute 가
  영원히 model 을 못 바꿈.

- **Fix 4 — 와치독 born-dead/silent 는 BOARD 활동만으로 판정.**
  `lastActiveMs = max(board, PTY)`(L813)의 PTY 항이 스피너-repaint 죽은 agy 를 `silent`·`noFirstActivity`
  양쪽에서 빠져나가게 하는 원흉. 모듈 자체 교리(PTY 는 hint)대로 born-dead/silence 는 add_activity/commit
  같은 board 신호로만 계산.

- **Fix 5 — respawn 은 비생산 바인딩 에이전트를 강제 교체할 수 있어야.**
  와치독이 born-dead 티켓을 respawn 할 때 먼저 죽은 agy 를 kill/unbind(또는 force-reassign 플래그로
  dispatch)해 `findLiveTaskAgent` 가 respawn 을 같은 agy 로 되돌리지 못하게.

## 7. 미결·후속 질문

- agy 가 정확히 어떤 화면/에러에서 "행"하는지 실제 PTY 원문 라이브 캡처 (Fix 2 패턴 정확도용).
- 관측된 재디스패치가 `dispatch_task`(bind 있음) 경로였는지 `spawn_agent`(bind 없음) 경로였는지 확정 —
  후자면 가시성 갭(§3 부가)도 수정 대상에 포함.

## 8. 후속 구현 — §6 Fix 4 정제 (티켓 nxi5EN27tF2RHLSUQZGh, W7)

§3 이 지목한 원흉(`lastActiveMs = max(board, PTY)` 의 PTY 항)을 실제로 끊었다. 단
Fix 4 원안(“PTY 항을 통째로 버리고 board 만 본다”)이 아니라 **한 단계 좁힌 형태**로 구현한다:

- PTY 프레임을 분류해(`agent-status-reconcile.ts` `classifyPtyFrame`) **idle 입력 프롬프트로
  확정된 프레임과 내용 없는 커서 repaint 만** 생존신호에서 제외한다. 나머지 출력(스트리밍
  응답·툴 로그)은 종전대로 생존 근거로 인정 — PTY 항을 통째로 버리면 *출력 중인* 추론
  에이전트까지 5분에 nudge 대상이 되므로, 이쪽이 false-kill 여지가 더 작다.
- 그 위에 **적극 증명 축**을 하나 더 얹었다: 하네스 입력 프롬프트에 `promptIdleGraceMs`(기본
  90초) 이상 머물고 보드 활동도 그동안 없으면 stuck. 침묵 타이머가 아니라 “CLI 가 입력을
  기다린다”는 관측이므로, **아무 프레임도 못 내는 추론 에이전트는 이 상태에 진입 자체가 불가**하다.
- 이 신호가 여는 것은 사다리의 **nudge 단 하나**다. respawn 은 종전 조건(dead / born-dead /
  nudge 예산 소진) 그대로 — 마커 오탐의 최대 피해가 무해한 메시지 1건이 되도록 설계했다.
- 회귀 고정: `tests/unit/pty-prompt-idle.test.ts`, `tests/unit/agent-watchdog-prompt-idle.test.ts`.

Fix 1·2·3·5(바인딩 단락, agy 하드 실패 terminal 화, model reroute, 강제 교체)는 이 티켓 범위
밖으로 남아 있다.
