# "첫 10분" 5/5 — 스폰 이후 완주 경로 진단 (첫 작업이 실제로 끝나는가)

- **티켓**: PeeRtcTThKc1Rm4I5HvZ (첫 10분 테스트 5/5)
- **날짜**: 2026-07-21
- **성격**: ★진단만. 수정 없음. UX 개선안은 §7 권고로만 분리.
- **범위(스폰 이후)**: 스폰 → 티켓 생성(create_task) → dispatch → 에이전트 실작업 →
  submit_for_review/완료 → 완료판정/회수. 1~4/5(로그인·폴더연결·오케 자동오픈·첫스폰)는
  병렬 4개 티켓이 담당 — 합치면 첫10분 전구간 지도.
- **동기**: 실측에서 **외부 `task:completed` = 0**. 아무도 첫 작업을 못 끝냈다.
  근본원인은 "안 쓴 것"(제품가치)이 아니라 "못 쓴 것"(활성화)
  — `docs/beta-churn-root-cause-analysis-2026-07-21.md`,
  `docs/onboarding-first10-funnel-instrumentation.md`.
- **방법**: 코드 트레이스(worktree HEAD = v3 3.0.17 소스) + shipped 3.0.18 검증
  (`~/Desktop/marblo-3.0.18-release`, asar 정적 대조). **라이브 오케/앱 부착 없음**
  (Playwright/Electron 라이브 부착 금지 준수 — Me11Ze8kvI35LvONzU9F).

---

## 0. shipped 3.0.18 대조 (코드트레이스 유효성)

소스 worktree 는 package.json 3.0.17 이지만, 릴리스 DMG 는 3.0.18 이다. 아래 핵심 경로가
**shipped 3.0.18 asar 에 실제로 들어있음**을 정적 대조로 확인 → 이 진단은 릴리스에 유효.

| 마커                                    | 3.0.18 asar | 의미                                   |
| --------------------------------------- | ----------- | -------------------------------------- |
| `Info.plist CFBundleShortVersionString` | `3.0.18`    | 대상 릴리스 확정                       |
| `Routing gate for every user turn`      | 존재(1)     | 인라인 금지·물리 dispatch 강제 shipped |
| `lastTaskId`                            | 존재(6)     | 회수 버그 fix shipped                  |
| `orchestratorBlocked` / `cli_auth`      | 존재(2/1)   | needsAuth 계측 shipped                 |
| `@anthropic-ai/claude-code`             | 존재(9)     | CLI 설치/인증 게이트 shipped           |

(minified 함수명 `evaluateTerminalTaskReap` 등은 electron main 번들에서 이름이 사라져 0건 —
기능 마커로 확인.)

---

## 1. 결론 (한눈에)

**신규유저의 첫 작업은 3.0.18 clean 환경에서 "완주 가능"하지만, 완주까지의 경로가
가치순간 대비 지나치게 길고, 실패는 전부 조용하다(no user-facing error).**
`task:completed=0` 은 두 원인의 합이다:

1. **활성화 절벽 (진짜 실패)** — 아래 게이트 중 하나만 걸려도 첫 작업이 시작조차 못 하거나
   [working] 에서 영구 고착. clean 환경(도그푸드 아님)에서는 이 중 최소 1개가 거의 항상 걸린다.
2. **★계측 맹점 (측정 아티팩트)** — 퍼널 종착 이벤트 `task:completed` 는 **렌더러 UI 클릭
   완료만** 잡는다. 에이전트/오케 완료는 MCP 직접 write 라 이 이벤트를 우회한다.
   즉 "외부 task:completed=0"이 events 스트림을 센 것이라면, 완주가 실제로 있었어도 0 이 나온다.
   → **§4 필독. "0" 을 활성화 실패로만 읽으면 오진 위험.**

**회수(reclaim) 는 무혐의**: markTurnComplete currentTaskId=null 회수 버그는 **FIXED** (§5).
첫 작업 실패의 원인이 아니다.

첫 aha(작업이 실제로 끝나 머지된 결과를 보는 순간)까지 **최소 홉수**:
`오케 자동오픈 → (사용자가 작업 서술) → create_task → dispatch → 물리 에이전트 스폰 → CLI 인증/trust → 에이전트 작업 → submit_for_review(REVIEW) → 리뷰/승인/머지 → DONE`.
스폰 이후만 해도 **6홉**, 각 홉이 fail-closed 이고 실패가 무음.

---

## 2. 스폰 이후 서브-퍼널 지도

공유 퍼널(`onboarding-first10-funnel-instrumentation.md`)의 종착부:

```
onboarding:orchestrator_opened (=첫 스폰, 1~4/5 담당)
        │
        ▼
[사용자가 첫 작업을 자연어로 서술]  ← 오케는 인사만 하고 "Wait for user instructions"
        │                              (선제적 데모 티켓 없음 — 100% 반응형)
        ▼
create_task / create_tasks_bulk   ── §3-A 3개 fail-closed 게이트 + 최소콜 거부
        │
        ▼
dispatch_task → 물리 에이전트       ── §3-A: 라우팅 게이트가 인라인 해결 금지, 무조건 물리
        │
        ▼
agent:spawned (워커) → 명령 주입     ── §3-B: 미인증/trust/느린콜드부팅서 무음 실패
        │
        ▼
에이전트 실작업
        │
        ▼
submit_for_review → REVIEW          ── §3-C: 텍스트-온리 완료면 영구 stuck / 오케 wake 유실
        │
        ▼
리뷰 → 승인/머지 → DONE             ── §3-D: 에이전트는 REVIEW 까지만. DONE 은 추가 홉
        │
        ▼
task:completed  ←── ★§4: 이 이벤트는 에이전트 완료를 못 잡는다 (계측 맹점)
```

---

## 3. 구간별 발견 (파일:라인 · 실패 시나리오)

### 3-A. 티켓 생성 → dispatch

**FINE (병목 아님)**: 데이터 검증/의존성/projection/모델 디폴트는 견고.

- 무의존성 첫 태스크는 절대 BLOCKED 안 됨(`projection.ts:318-328,347-350`).
- bulk 악성 아이템 격리(`task-body.ts:49-67`) — 배치 킬러(20GMXojE) fix 됨.
- 모델 미설정 → "recommended"/"claude" 디폴트(`dispatch-scoring.ts:393-398,675-682`).
- create 시 projection 동봉 → 보드 즉시 표시(`tools.ts:1695,1945`), TODO→CLAIMED 자동 전이.

**[P1-a] 오케 liveness 게이트 — 모든 툴콜마다 fail-closed** ★이 구간 최상위 위험

- `tools.ts:756-807`(`validateLiveOrchestratorToolCall`) @ `1291-1296`, `bridge-server.ts:209-246,1425-1439`.
- 오케의 **모든** 가드 툴(create_task/create_tasks_bulk/dispatch_task/spawn_agent/claim_task/
  update_task_status…, `tools.ts:733-754`)이 매콜 bridge 로 PTY 라이브 왕복 검증. 거부 조건:
  `MARBLO_BRIDGE_PORT` 없음(`:763`), `MARBLO_ORCHESTRATOR_PTY_SESSION_ID` 없음(`:769`),
  fetch throw/non-200(`:791-806`), env PTY id 가 라이브 세션과 불일치(`bridge-server.ts:233`
  "stale orchestrator PTY session").
- **실패**: 첫 10분 내 bridge 지연/오케 재시작·resume 레이스로 env ptySessionId 가 라이브
  세션에 lag 하면(매 런치 재생성 `orchestrator-manager.ts:606,815-817`), **모든** 티켓생성·
  dispatch 가 "Refusing…"으로 하드 차단. non-도그푸드 유저가 조용히 멈추는 가장 유력 지점.

**[P1-b] `ensureAuthenticated` 매콜 fail-closed**

- `firebase.ts:295-323` @ `tools.ts:1285`. 익명 fallback 없음. MCP 프로세스에 custom token 이
  아직 전파 안 됐으면(#406/#428 계열) 모든 create/dispatch 가 `McpAuthError`. 실패 시 **10s
  쿨다운**(`firebase.ts:302`)이 stall 을 가중. 방금 로그인했지만 토큰이 MCP 자식에 안 닿은
  콜드스타트 창에서 발생 → 보통 self-heal 하나 실측 첫10분에 정확히 겹침.

**[P2-a] `MARBLO_PROJECT` 없음 → "No project context"**

- `tools.ts:195,1640-1645,1738-1744`. 정상 런치는 세팅함(`orchestrator-manager.ts:814`)이라
  폴더→projectId 해석이 안 된 온보딩 갭에서만 발생. fail-closed.

**[P2-b] create_task 최소콜 거부**

- role 필수 + 화이트리스트 `["backend","frontend","test","devops"]`(`tools.ts:137,1604,1650-1656`):
  오케가 "fullstack"/"general"/"pm"/"qa" 같은 자연 역할을 지어내면 하드 거부.
- goal/description 둘 다 없으면 거부(`task-body.ts:113-115`, `tools.ts:1664-1665`) → `create_task(title, role)` 만으론 실패.
- (bulk 는 role 누락 시 "backend" 디폴트 `:1911`, 명시적 invalid 만 해당 아이템 실패 `:1849-1864`.)

**[P2-c] 플랜 동시성 캡** — free ≈ 2 concurrent(`bridge-server.ts:1937-1947`).

- 첫 태스크 1개는 무관하나, 오케가 즉시 여러 티켓 fan-out 하면 3번째+ dispatch 가 캡 사유로 실패.

**[P2-d] reuse 경로 dispatch(task_id 없음)가 완료 footer 스킵**

- `bridge-server.ts:1789-1792,1889-1892`. idle 에이전트 재사용 + task_id 미지정이면 "submit_for_review
  호출하라" 프로토콜이 안 붙어 → 끝내도 미보고 → 오케 blind. (fresh 스폰은 ad-hoc 태스크 자동생성
  +footer 라 안전 `tools.ts:3043-3046`.)

### 3-B. 에이전트가 명령을 받아 실작업 (스폰 직후)

**FINE**: `writeAndSubmit`/`submitWithRetry` CR 전달은 견고(`pty-manager.ts:352-504`),
stale-PTY 가드(`:422,457,480`), 과거 `injectMessage expectPty` 무음드롭 버그는 **fix됨**
(불일치 시 warn+current PTY 라우팅 `orchestrator-manager.ts:521,535-540`), pending 명령
크로스머신 전달은 트랜잭션 once-only(`pending-instruction-listener.ts:175-241`).

**[P0-a] 미인증 CLI = 명령 미전달** ★clean-env 기본 결말

- `agent-manager.ts:520,536-550`. 신규유저는 대개 claude/codex CLI 미로그인. `looksLikeLoginScreen`
  이 `authBlocked=true` → 프롬프트 주입 **억제** → status=error → `agent:needsAuth`. graceful 처리
  (게이트 표시 가능)이지만 **태스크가 시작조차 안 됨**. 이게 clean 환경 디폴트 아웃컴.

**[P0-b] ★clean-env 하드블록: 필수 CLI 가 Node+npm 요구** (스폰 이전 게이트지만 완주의 최상단 문)

- claude-code = `kind:"npm-global"` → "requires Node + npm on PATH"(`harness-catalog.ts:25,114-118`).
  Node 미설치 clean Mac 은 자동설치(`npm install -g @anthropic-ai/claude-code`)도, 수동 fallback
  명령도 **동일하게 실패** → 앱 내부에 탈출로 없음. `CliSetupGate.tsx` 는 인증까지 유도하지만
  npm 자체가 없으면 install 버튼/명령 모두 무력. (앱은 글로벌 설치용 Node 를 번들하지 않음.)

**[P1-c] trust dialog 자동수락 matcher 갭**

- `agent-manager.ts:245-266`(`STARTUP_DIALOG_MATCHERS` 은 Codex 업데이트·Antigravity trust 만 처리).
  Claude/Codex 의 "Do you trust this folder?" matcher **없음**. readiness 패턴은 trust 박스를
  의도적으로 회피(`:554-557`)라, 첫 스폰 시 10s blind fallback(`:638`)이 프롬프트를 **trust
  다이얼로그에 타이핑** → 메뉴 오조작. SUBMIT_SIGNAL CR 도 텍스트가 메뉴에 들어갔으면 무의미.

**[P1-d] readiness miss → 느린 콜드부팅서 blind inject**

- `agent-manager.ts:559-575,637`. 첫 스폰은 marblo MCP 서버도 기동(~10s auth, 핸드셰이크
  타임아웃/패키지 `-32000` 이력). 부팅이 10s 초과인데 readiness 라인 미출현이면 프롬프트가
  아직 준비 안 된 TUI 에 blind 주입.

### 3-C. 완료 보고 (submit_for_review → REVIEW)

**FINE**: submit_for_review 는 durable projection(REVIEW) 후 오케 wake 를 화이트리스트로 확실히
트리거(`tools.ts:2296,2364`, `bridge-server.ts:292,1282,1369`), 완료 footer 가 task_id 를 넣어줘
최소 해피패스는 **툴콜 1회**(`bridge-server.ts:49-79`) — 이 부분은 정상.

**[P0-c] ★텍스트-온리 완료 = 영구 stuck** — 이 퍼널의 급소

- `agent-manager.ts:867-902`. 턴 완료는 오직 (a)dispatch→working, (b)**MCP self-report**로만 파생.
  PTY **출력은 턴을 완료시키지 않음**(`:886-891`). "완료했습니다" 텍스트만 내고 툴을 안 부르면
  fallback 텍스트-스크레이핑 **없음** → 에이전트 [working] 영구 고착, 오케 미wake, 보드 CLAIMED/
  IN_PROGRESS 동결(무에러). 약한/저가 모델·혼란스러운 clean 첫런에서 흔함.
- **가중**: MCP 툴이 로드 안 됐으면(핸드셰이크 타임아웃/`-32000`) submit_for_review 를 **부를 수조차
  없어** 텍스트-온리 stranding 확정. footer(`agent-manager.ts:214-217`)·완료 nudge
  (`completion-report.ts:79`, "절대 블록 안 함")는 프롬프트 넛지일 뿐 강제 아님.

**[P1-e] 오케 PTY wake 는 best-effort(유실 가능)**

- `tools.ts:234-248`: `MARBLO_BRIDGE_PORT` 없으면 조용히 return, `fetch(...).catch(()=>{})` 로 전부 삼킴.
  `bridge-server.ts:1351-1364`: 오케 세션이 running 아니면(유저가 닫음/크래시/신규유저 오케부팅
  자체 실패) 200 `{success:false}` 로 **드롭**. 에이전트 툴콜은 성공(보드=REVIEW)인데 유저가
  보는 오케 채팅은 **반응 없음 → hang 처럼 보임**.

### 3-D. REVIEW → DONE (완주=DONE)

- MCP 전이맵은 REVIEW→DONE 및 CLAIMED/IN_PROGRESS→DONE 까지 허용(`tools.ts:176-179`),
  렌더러 state-machine 은 REVIEW→DONE("approve")만(`state-machine.ts`). 에이전트는 보통
  submit_for_review 로 **REVIEW 까지만** 올린다.
- DONE 도달엔 누군가 update_task_status(DONE)/승인·머지가 필요(오케 또는 사용자). DONE 전이는
  worktree 자동 reap 을 트리거(`tools.ts:2119-2135`)하나 실제 git 머지는 별개 경로.
- **함의**: "첫 작업 완주=DONE"엔 에이전트 작업 이후 **리뷰/머지 홉**이 하나 더 있다.
  이 홉을 신규유저가 안 밟으면 태스크는 REVIEW 에 머무르고 aha(머지된 결과)엔 도달 못 함.

---

## 4. ★계측 맹점: `task:completed=0` 을 어떻게 읽을 것인가

**핵심**: 퍼널 종착 이벤트 `task:completed` 는 **렌더러 `taskService.updateTaskStatus` 에서만**
발화한다(`taskService.ts:171-176`) = "사람이 UI 로 DONE 클릭"한 경우만. 에이전트/오케 완료는
MCP `update_task_status`/`submit_for_review` → `applyProjection` → **Firestore 직접 write** 라
이 함수를 **안 거친다**(코드 주석 `taskService.ts:178-182` 이 명시).

- 즉 정상 경로(오케/에이전트가 완료)에서는 `events.task:completed` 가 **구조적으로 거의 0**
  — 완주가 실제로 있었는지와 무관하게.
- 실제 완료의 authoritative 소스는 **별도 테이블 `task_outcomes`**(구독 기반 `taskOutcomeReporter.ts`,
  UI·MCP·오케·워치독 모든 writer 를 Firestore 구독 초크포인트로 1회씩 포착).

**권고(측정)**: "외부 task:completed=0" 이 어느 소스인지 먼저 확정하라.

- `marblo_telemetry.events` 의 `event='task:completed'` 를 셌다면 → **0 은 부분적으로 계측
  아티팩트**. 활성화 실패 크기를 이 지표로 판단하면 과대추정.
- "정말 아무도 완주 못 했나"의 정답 지표 = **`task_outcomes` 의 최신 positive(DONE) 행 수**
  (taskId 당 최신 행이 authoritative). 이걸로 재측정해야 진짜 완주 0 인지 확인된다.
- 단, `task_outcomes`/구독 리포터도 **렌더러가 살아 구독 중일 때만** 발화 → 완료 후 즉시 앱을
  닫은 헤드리스 완료는 여전히 놓칠 수 있다. (첫스폰 이전 로그인/설치 미계측은 1~4/5·
  `beta_churn` 문서의 최대 맹점과 연결.)

---

## 5. 회수(reclaim) 경로 — 무혐의(FIXED)

과거 의심: `markTurnComplete` 가 완료보고 시 `currentTaskId=null` 로 지우는데 reap 게이트가
non-null 을 요구 → 정상 보고한 에이전트가 영영 회수불가 → 풀 고갈. **현재 코드에서 FIXED.**

- `agent-manager.ts:1326` — null 로 지우기 **전에** `lastTaskId = currentTaskId` 로 보존.
  주석: "Clearing currentTaskId without this is what made every cleanly-completed agent unreapable."
- `agent-reap.ts:125` — 게이트가 `taskId = currentTaskId ?? lastTaskId` 수용. 헤더 30-44 에 사고 postmortem.
- consumer `cleanup_agents` Pass2 `tools.ts:3758,3775-3783` 도 둘 다 통과.
- **순서**: submit/DONE 은 `applyProjection`(보드 terminal) **먼저** → 그 다음 `/set-agent-status idle`
  →`markTurnComplete`. 보드가 이미 terminal 이라 레이스 창에도 `lastTaskId` 로 재검사 가능. **"working 도
  reclaimable 도 아닌 창" 없음.** idle 슬롯은 즉시 해제 → 두번째 태스크 dispatch 즉시 가능.

**단 인접 스로틀 1건(버그 아님)**: 물리 에이전트의 실제 kill/풀재사용은 PTY 5분 무음
(`STALE_TERMINAL_REAP_MS`) **AND** 명시적 `cleanup_agents` 호출 후에만. idle 슬롯 해제는 즉시라 두번째
dispatch 는 바로 되지만, 오케가 `cleanup_agents` 를 안 부르면 terminal-task 좀비가 잔존
(`terminalSince` backstop `agent-manager.ts:143-148` 은 stopped/error 만 커버). currentTaskId 고갈
버그와는 별개.

---

## 6. "aha 가 몇 분 안에 오나" 판정

- 오케는 인사 후 **반응형 대기**("Wait for user instructions", `orchestrator-manager.ts:1002`).
  선제적 "hello-world" 데모 티켓·가이드 없음 → 첫 액션이 곧 실제 작업 서술 = 첫 경험이 고위험.
- 라우팅 게이트(`orchestrator-manager.ts:88`)가 **모든** 작업요청을 인라인 금지·물리 dispatch 강제.
  가장 사소한 첫 요청조차 6홉 물리 파이프라인을 타야 함 → aha 까지 최장 경로.
- 각 홉 실패가 무음(§3) → 유저 체감은 "스피너만 돌고 아무 일도 안 남". clean 환경에서 첫 aha 가
  몇 분 안에 오는 케이스는 (CLI 설치+인증+trust+MCP로드+모델이 툴콜 준수) 5조건 동시 충족일 때만.

---

## 7. 권고 (★수정 아님 — 별도 개선안. 우선순위순)

> 진단 티켓이라 코드 변경 없음. 아래는 후속 티켓 후보.

1. **[P0] 완주 지표 재정의 & 재측정(측정 먼저)** — "외부 완주 0" 을 `task_outcomes` DONE 행으로
   재확인. events.task:completed 로 셌다면 활성화 실패 크기 재추정. (§4)
2. **[P0] 텍스트-온리 완료 안전망** — 에이전트가 툴 미호출로 turn-idle 이면, task 가 여전히
   CLAIMED/IN_PROGRESS 일 때 오케에 "미보고 완료 의심" 넛지 자동 주입(현 footer 는 프롬프트 넛지뿐).
   MCP 툴 미로드도 하드 신호로 노출. (§3-C P0-c)
3. **[P0] clean-env CLI 부트스트랩** — Node 미설치 Mac 을 위한 번들 Node/설치관리자 또는 앱-내
   설치 대행. 현재 npm 없으면 게이트에서 탈출 불가. (§3-B P0-b)
4. **[P1] 미인증·trust 를 첫스폰 전 강제 해소** — needsAuth 게이트를 첫 작업 서술 이전에 완료로
   유도(현재 스폰 후 error 로 나타남). Claude/Codex trust 다이얼로그 auto-accept matcher 추가. (P0-a/P1-c)
5. **[P1] 오케 wake 유실 가시화** — best-effort wake 가 드롭되면 보드/오케에 "에이전트가 REVIEW
   제출했으나 오케 미응답" 배지. 지금은 보드=REVIEW 인데 채팅 hang 으로 보임. (P1-e)
6. **[P1] 첫 태스크는 인라인 허용(라우팅 게이트 예외)** — 온보딩 첫 1건은 물리 6홉 대신 짧은
   인라인 데모로 aha 를 먼저 주는 옵션 검토. (§6)
7. **[P2] 스킬↔툴 계약 정합** — `.claude/skills/tf-add/SKILL.md:53-54,61` 의 `curl -X PATCH /api/tasks/{id}`(FastAPI:8001)는 v3 Electron/Firestore write 경로가 아님. 첫 티켓 "우선순위/설명
   변경" 요청이 실store 를 안 침. `project` vs `project_id` 키도 불일치(create 는 무해히 드롭). (§3-A 7)

---

## 부록 A. 검증 방법 (재현용)

- 코드트레이스: v3 소스(worktree HEAD, 3.0.17). 병렬 3개 서브에이전트로 구간 분담
  (티켓생성→dispatch / 에이전트작업→submit / 완료판정→회수) 후 파일:라인 교차검증.
- shipped 3.0.18: `Marblo-3.0.18-arm64-mac.zip` → app.asar `strings` 정적 대조(§0).
  **라이브 앱 실행/부착 없음** — Playwright/Electron 부착 금지 준수.
- 상호참조: `beta-churn-root-cause-analysis-2026-07-21.md`,
  `onboarding-first10-funnel-instrumentation.md`.

## 부록 B. FINE 판정(병목 아님) 요약

데이터검증·의존성·projection·모델디폴트(§3-A), writeAndSubmit/submitWithRetry·stale-PTY 가드·
injectMessage fix·pending once-only(§3-B), submit_for_review 화이트리스트 wake·완료 footer
task_id 주입·최소콜 1회(§3-C), 회수 lastTaskId fix(§5).
