# 첫 10분 테스트 4/5 — 첫 에이전트 스폰 실패 층위 진단

- 티켓: `AsdKGPrZvTiNWUTzCyRx`
- 날짜: 2026-07-21
- 성격: **진단 전용(수정 0, git 조작 0)**. 코드 경로 정적 분석 + 비변경 라이브 probe.
- 사장님 가설: **"오케가 tf-add 못해서 스폰 못했나?"**

---

## 0. 한 줄 결론

**사장님 가설 REJECT.** `tf-add`(=`create_task`)·`dispatch_task`·`spawn_agent`의 **디스패치/생성 층은 정상**이며 스폰과 디커플되어 있다. 첫 에이전트 스폰이 죽는다면 그 지점은 **PTY/CLI 층**이고, 신규유저 첫스폰의 최상단 후보는 **(a) CLI 미설치·미인증**이다. **(c) PTY 풀 고갈**은 실재하나 신규유저 _첫_ 스폰엔 비개연(장기세션 누적 문제). **(b) dispatch/tf-add**는 배제.

---

## 1. 3층 분리 확정

첫 에이전트 스폰은 다음 체인을 탄다:

```
[온보딩 첫 에이전트 = 오케스트레이터 자동오픈]
useOrchestratorAutoLaunch.ts → orchestratorSession.launch (IPC)
   └─ main.ts:5536  checkSpawnAuthGate(orchestratorModel)   ← (a) 사전 인증 게이트
        └─ agentManager.launch → pty-manager.create → pty.spawn   ← (c) PTY 층

[오케가 자식 에이전트 스폰 = spawn_agent / dispatch_task]
MCP spawn_agent (tools.ts:2573) ─HTTP─▶ bridge /spawn-agent
   └─ bridge-server.ts:1071 handleSpawnAgent → :2408 spawnNewAgent
        └─ :2466 agentManager.launch  (★checkSpawnAuthGate 미호출)
             └─ pty-manager.create → pty.spawn   ← (c) PTY 층
```

| 층  | 무엇                                         | 코드                                                                                               |
| --- | -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| (a) | CLI 미설치·미인증 (needsAuth)                | `harness-manager.ts:999 checkSpawnAuthGate` / `agent-manager.ts:600 looksLikeLoginScreen` backstop |
| (b) | dispatch / tf-add / create                   | `tools.ts:1575 create_task`, `:3235 dispatch_task`, `bridge-server.ts:1590 dispatchTask`           |
| (c) | PTY spawn helper (node-pty 고아fd·ptmx 고갈) | `pty-manager.ts:233 pty.spawn` (throw at `:240`)                                                   |

---

## 2. (b) dispatch/tf-add — 정상 확정, 스폰과 디커플

### 2-1. 코드 증거: tf-add/create 는 PTY 무관

- **`tf-add` 스킬 → `create_task`**: `.claude/skills/tf-add/SKILL.md`는 `create_task`/`create_tasks_bulk`만 호출. **에이전트 스폰 호출 없음.**
- **`create_task`** (`v3/electron/mcp-server/tools.ts:1575`): 프로젝트 해석 → 검증 → **단일 `setDoc(ref, data)` Firestore write**(`:1673-1700`). 상태 `TODO` 시드. **bridge 호출·PTY·spawn 전무.** CLI/PTY 의존도 0.
- **`dispatch_task`** (`tools.ts:3235`): 태스크 생성부는 Firestore `addDoc`(`:3365`); 스폰부만 bridge `/dispatch-task` POST(`:3474`). **생성과 스폰이 분리**되어 있어, 설령 스폰이 죽어도 태스크 레코드는 남는다.

### 2-2. 라이브 증거: dist-mcp 독립 stdio 핸드셰이크 (비변경 probe)

`node v3/dist-mcp/index.js`를 독립 stdio로 띄우고 `initialize` + `tools/list`만 전송(**tool 호출 안 함 → Firestore 무변경**):

```
initialize OK — server: Marblo 3.0.0
tools/list OK — total tools: 33
  FOUND create_task
  FOUND dispatch_task
  FOUND spawn_agent
  FOUND create_tasks_bulk
```

→ MCP 트랜스포트·툴 등록 층 **정상**. dispatch/생성 경로는 도달 가능하고 well-formed.

### 2-3. 라이브 증거: 오늘 오케가 20기+ 스폰

디스패치/생성/tf-add 층이 죽어 있었다면 오늘의 대량 스폰 자체가 불가능. **이 층은 동작 확정.**

> **판정: (b) 배제.** tf-add 못해서 스폰 못한 게 아니다. 태스크 생성은 Firestore-only 이며, 스폰 실패와 인과 무관.

---

## 3. (a) CLI 미설치·미인증 — 첫스폰 최상단 후보

### 3-1. 온보딩 "첫 에이전트" = 오케스트레이터 자동오픈

`useOrchestratorAutoLaunch.ts`가 폴더연결 직후 오케를 자동 launch. 이 경로는 **사전 게이트 + 계측이 둘 다 존재**:

```ts
// useOrchestratorAutoLaunch.ts
result = await orchestratorSession.launch(...)      // main.ts:5536 checkSpawnAuthGate
if (result?.needsAuth) {
  telemetry.orchestratorBlocked("cli_auth");        // :90  ← CLI 미설치/미인증
  window.dispatchEvent("marblo:open-cli-setup");    // CliSetupGate 표시
  return;
}
telemetry.orchestratorOpened(!!priorId);            // :98  첫 에이전트 뜬 순간
...
catch { telemetry.orchestratorBlocked("launch_error"); }  // :115 런치 예외
```

`checkSpawnAuthGate`(`harness-manager.ts:999`)는 `probeCliAuth`로 **미설치(`not-installed`)/미인증(`not-authenticated`)을 구분**해 needsAuth 반환. claude/codex/antigravity만 게이트, gemini/custom은 통과(`modelToCliAuth :977`).

### 3-2. 왜 최상단 후보인가

신규유저가 claude(또는 선택 모델) CLI를 **설치 안 했거나 로그인 안 했으면**, **첫 에이전트(=오케)부터** needsAuth로 막혀 CliSetupGate로 튕긴다. 이건 "첫 에이전트 스폰 실패"의 문자 그대로의 정의이며, `#542` 퍼널 주석이 **"★22→6의 핵심 사유"**로 지목한 바로 그 지점(`telemetryService.ts:547`).

---

## 4. (c) PTY 풀 고갈 — 실재하나 첫스폰엔 비개연

### 4-1. 메커니즘 (코드 확인)

- node-pty 1.1.0은 macOS에서 **spawn당 `/dev/ptmx` master 2개**를 열고, teardown이 그중 1개를 **누수**(`pty-manager.ts:71-83`). `kern.tty.ptmx_max` 기본 **511** 소진 시 `openpty()`가 ENXIO.
- 소진 시 `pty.spawn`이 throw(`pty-manager.ts:240-264`, `"PTY exhausted..."`), `reap()` 후 rethrow.

### 4-2. 왜 신규유저 _첫_ 스폰엔 비개연

ptmx 고갈은 **누적형**이다 — 세션이 길어지며 고아 fd가 511까지 쌓여야 발생. **오늘 오케가 겪은 스폰 실패가 정확히 이것**이지만, 그건 **다수 스폰 이후**의 일이다. 갓 설치한 신규유저의 PTY 풀은 깨끗(0)하므로 **에이전트 #1(오케)에서 ptmx 고갈은 거의 불가능**. 자식 에이전트를 여러 기 스폰한 뒤라면 가능.

### 4-3. 발생 시 관측 경로

오케 launch가 throw → `useOrchestratorAutoLaunch.ts:115` catch → `orchestratorBlocked("launch_error")`. 즉 첫스폰(오케) 경로에선 `launch_error`로 잡힌다.

> **판정: (c) 첫스폰 원인일 가능성 낮음.** 장기세션(자식 다스폰 후) 재현 후보로 별도 추적.

---

## 5. ★계측 맹점 — 22→6 이 왜 안 갈렸나 (핵심)

과제 질문: _"agent:spawned/agent:crashed(errorCategory)가 실제 발화하는가"_ + _"22→6이 시도조차 안한 건지 시도했다 crash인지."_

### 5-1. 계측 발화 지점 (코드 확인)

- `agent:spawned`: `agent-manager.ts:925` — **`ptyManager.create()`(`:492`) 성공 직후 무조건 발화**.
- `agent:crashed(errorCategory)`: `agent-manager.ts:1118` — `onExit` 핸들러의 **terminal 분기(재시작 예산 소진 OR fast-fail 예산 소진)에서만**. 분류: `fast_fail_config`(FAST_FAIL_WINDOW 내 반복 즉사 = 미설치 바이너리/설정오류) vs `runtime_crash`(정상기동 후 MAX_RESTARTS 소진)(`:1112`).

### 5-2. 자식 에이전트 스폰 경로의 2개 맹점

`spawn_agent`/`dispatch` → `spawnNewAgent` → `agentManager.launch` 경로는 **`checkSpawnAuthGate`를 호출하지 않는다**(bridge-server.ts:2466, 사전 게이트 없음). 런타임 backstop만 의존 → 다음 두 실패가 **crash 계측에 안 잡힌다**:

| 실패 모드                | 코드                                                                        |   agent:spawned    |    agent:crashed     | 결과                                  |
| ------------------------ | --------------------------------------------------------------------------- | :----------------: | :------------------: | ------------------------------------- |
| **login-screen(미인증)** | `agent-manager.ts:536 handleLoginScreen` → `agent:needsAuth` + status error | **이미 발화**(925) |          ✗           | **"성공한 스폰"으로 위장**, 이후 무음 |
| **PTY 고갈**             | `pty-manager.ts:240` throw → `launch()`가 925·onExit등록(987) 전에 throw    |         ✗          |          ✗           | **완전 불가시**                       |
| 미설치 바이너리          | fast-fail 반복 → `:1112`                                                    |      발화 후       | ✓ `fast_fail_config` | 유일하게 보이는 케이스                |

즉 **crash 텔레메트리만으로는 "시도했다 auth로 죽음" / "시도했다 PTY로 죽음"을 볼 수 없다.** auth 실패는 오히려 `agent:spawned`(성공)로 기록되어 22→6을 _가린다_.

### 5-3. 단, 첫에이전트(=오케) 경로는 #542 퍼널이 커버

오케 자동오픈은 `orchestrator_blocked("cli_auth" | "launch_error")` vs `orchestrator_opened`로 **3분기 계측**(§3-1). 따라서 **오케 레벨 첫스폰은 갈릴 수 있다** — 단 아래 두 전제가 필요:

1. **빌드에 `#542`(commit `78ddec67`)가 포함**되어야 함. 3.0.18 dmg가 이 커밋 이전 빌드라면 그 코호트엔 퍼널 계측이 없다 → 22→6(7/14 코호트)은 **당시 관측 불가**했을 개연(이게 "안 갈렸던" 근본 이유일 수 있음). ▶ **오케/사장님 확인 필요.**
2. **auth-gated flush 한계**(`telemetryService.ts:481-487`): `logTelemetry`는 `auth.currentUser` 있을 때만 flush. 오케 오픈은 로그인 후라 flush됨(OK). 그러나 **끝내 로그인 실패한 유저**의 마찰은 전송 안 됨(§5-2 맹점).

---

## 6. 22→6을 확정하는 BQ 쿼리 (권고 — 실행은 데이터 접근 가진 쪽)

본 진단은 코드/트랜스포트 층까지. 코호트 실수치 확정은 아래 이벤트 카운트로 즉시 갈린다(#542 포함 빌드 한정):

```
events WHERE event IN (
  'onboarding:orchestrator_opened',           -- 첫 에이전트 뜸(성공)
  'onboarding:orchestrator_blocked'           -- errorCategory: cli_auth | launch_error
)
GROUP BY event, errorCategory
```

- `orchestrator_opened` 카운트 = 첫스폰 성공 수
- `orchestrator_blocked(cli_auth)` = **시도했으나 CLI 미설치/미인증** (= (a))
- `orchestrator_blocked(launch_error)` = **시도했으나 런치 예외** (PTY 고갈 등 (c) 포함)
- 위 셋 합 대비 folder_connected 격차 = **오케 오픈 자체에 도달 못한 유저**(로그인/설치 전 이탈)

이 한 쿼리가 "시도조차 안 함 vs 시도했다 CLI미설치 vs 시도했다 런치예외"를 정확히 분리한다.

---

## 7. 최종 판정 요약

| 층                    | 판정                              | 근거                                                                        |
| --------------------- | --------------------------------- | --------------------------------------------------------------------------- |
| (b) dispatch/tf-add   | **원인 아님(배제)**               | create_task=Firestore-only·스폰 디커플; dist-mcp 33툴 정상; 오늘 20기+ 스폰 |
| (a) CLI 미설치·미인증 | **첫스폰 최상단 후보**            | 오케 자동오픈 needsAuth 게이트; #542가 "22→6 핵심 사유"로 지목              |
| (c) PTY 고갈          | **첫스폰 비개연 / 장기세션 후보** | 누적형(511 소진); 신규 풀은 깨끗; 오늘 오케 실패는 다스폰 후                |

**측정 상의 진짜 문제**: 자식 스폰 경로에서 auth 실패는 `agent:spawned`(성공)로 위장되고 PTY 고갈은 완전 불가시라, **crash 계측만으론 22→6이 원천적으로 안 갈렸다.** 오케(첫에이전트) 경로는 #542 퍼널이 forward-looking 하게 메운다 — **단 3.0.18 빌드에 #542 포함 여부부터 확인**해야 22→6 코호트에 적용 가능한지 판가름 난다.

---

## 부록 — 검증 방법/경계

- 정적: `agent-manager.ts`(launch/onExit/needsAuth backstop), `pty-manager.ts`(create/throw/reaper), `bridge-server.ts`(spawnNewAgent), `harness-manager.ts`(checkSpawnAuthGate), `telemetry.ts`·`telemetryService.ts`(발화점), `useOrchestratorAutoLaunch.ts`(첫스폰 계측) 직독.
- 라이브(비변경): `node v3/dist-mcp/index.js` stdio `initialize`+`tools/list`만. **tool 호출 없음 → Firestore 무변경.**
- 미수행(의도적): `create_task`/`dispatch_task` 실호출(=prod Firestore 변경) — 수정금지 규약 준수로 제외. 라이브 오케 세션·Playwright/Electron 부착 안 함(`Me11Ze8kvI35LvONzU9F`).
- 시크릿: `.mcp.json`/firebase-config 원문 미출력. dist-mcp env는 값 노출 없이 기동만.
