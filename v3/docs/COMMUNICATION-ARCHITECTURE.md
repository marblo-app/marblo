# Marblo v3 통신·시스템 아키텍처

> 오케스트레이터 ↔ marblo MCP ↔ 에이전트 ↔ 보드(칸반)가 **어떻게 통신하는지**를 한 문서로 정리한다.
> 핵심 결론부터: **v3 데스크톱은 전부 Electron 기반 로컬 프로세스로 구현돼 있고, 이 런타임 루프에 Docker는 필요 없다.** 외부 의존은 상태 동기/영속용 **Firestore(Firebase SaaS)** 하나뿐이다.
>
> _작성 2026-06-19. 근거: `v3/electron/bridge-server.ts`, `pty-manager.ts`, `pending-instruction-listener.ts`, `mcp-server/{index,tools,firebase}.ts`, `agent-config.ts`._

---

## 0. 한 장 요약

```
┌──────────────────────── Electron 메인 프로세스 = 허브 (단일 앱) ────────────────────────┐
│                                                                                         │
│   bridge-server.ts  ──  localhost HTTP 서버 (127.0.0.1:<port>)                          │
│        port 는 ~/.marblo/bridge-port 파일에 기록(discovery)                              │
│        ├─ AgentManager        에이전트 프로세스 생명주기(spawn/reuse/kill/status)         │
│        ├─ PtyManager          각 에이전트 = node-pty 로 띄운 CLI, 터미널 탭에 attach       │
│        ├─ OrchestratorManager 오케 세션(자체도 하나의 CLI + PTY)                          │
│        └─ PendingInstructionListener  Firestore → 로컬 PTY 주입(크로스머신)               │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
        ▲ HTTP (localhost)                                  │ PTY stdin/stdout (로컬 파이프)
        │                                                   ▼
   ┌────┴───────────────┐                       ┌─────────────────────────────────┐
   │ marblo MCP (stdio) │◀── 자식 프로세스 ────│ 에이전트 CLI (claude / gpt(codex))│
   │ node dist-mcp/     │  각 에이전트 전용     │  = 터미널 탭 1개                 │
   │ index.js           │  claude-mcp-<id>.json │                                 │
   └────────────────────┘  (agent-config 생성)  └─────────────────────────────────┘
        │ MCP 툴 호출이 localhost HTTP 로 bridge 를 때림
        ▼
   Firestore (Firebase) ── 태스크 · projection · pendingInstructions · 익명 auth · 재시작 복원
```

- **에이전트는 컨테이너가 아니다.** 그냥 로컬에서 돌아가는 CLI 프로세스(`claude` 또는 `codex`)이고, Electron이 `node-pty`로 터미널에 붙여 띄운다.
- **에이전트는 보드를 직접 모른다.** 자기 옆에 붙은 **marblo MCP(stdio) 서버**를 통해서만 보드와 대화한다. MCP 서버는 그 호출을 **localhost HTTP로 bridge-server에 전달**한다.
- **Firestore는 "공유 진실원 + 크로스머신 우편함"** 역할이다. 통신의 실시간 경로는 localhost HTTP/PTY지만, 영속·동기·다른 기기 전달은 Firestore가 맡는다.

---

## 1. 구성 요소

| 요소                           | 파일                                               | 역할                                                                     |
| ------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------ |
| **Electron 메인**              | `electron/main.ts`                                 | 앱 부팅. 아래 매니저들과 bridge-server를 띄운다.                         |
| **bridge-server**              | `electron/bridge-server.ts`                        | **localhost HTTP 허브.** 외부(MCP/렌더러)의 요청을 받아 매니저로 라우팅. |
| **AgentManager**               | `electron/agent-manager.ts`                        | 에이전트 spawn/reuse/restart/kill, 상태 관리.                            |
| **PtyManager**                 | `electron/pty-manager.ts`                          | 각 에이전트 CLI의 PTY 생성·write·attach·종료 처리.                       |
| **OrchestratorManager**        | `electron/orchestrator-manager.ts`                 | 오케 세션(자체도 CLI+PTY). 완료 통지를 오케 PTY에 주입.                  |
| **PendingInstructionListener** | `electron/pending-instruction-listener.ts`         | Firestore `pendingInstructions` 큐 → 로컬 PTY 주입(크로스머신).          |
| **marblo MCP 서버**            | `electron/mcp-server/*` → 빌드 산출물 `dist-mcp/*` | 에이전트가 호출하는 stdio MCP. 툴 호출을 bridge HTTP로 변환.             |
| **에이전트 설정 생성**         | `electron/agent-config.ts`                         | 에이전트별 `claude-mcp-<id>.json`(MCP 설정) 생성, CLI 바이너리 해석.     |

> ⚠️ **MCP 서버는 소스(`mcp-server/*.ts`)가 아니라 컴파일 산출물(`dist-mcp/*.js`)로 실행된다.** `.mcp.json` → `node v3/dist-mcp/index.js`. 그래서 `mcp-server`를 고치면 반드시 `npm run build:mcp` + 부팅 확인을 해야 런타임에 반영된다.

---

## 2. bridge-server HTTP 엔드포인트

bridge는 `127.0.0.1:<port>`에서 듣는 평범한 Node `http` 서버다(`bridge-server.ts`). 포트는 매 부팅 시 동적으로 잡고 **`~/.marblo/bridge-port` 파일에 적어** 자식 MCP/외부 세션이 발견하게 한다.

| 메서드·경로                 | 용도                                                          |
| --------------------------- | ------------------------------------------------------------- |
| `GET /health`               | 헬스체크(브리지 생존 확인).                                   |
| `GET /agents`               | 에이전트 목록·실시간 상태(쿼리스트링 필터).                   |
| `POST /spawn-agent`         | 새 에이전트 CLI 프로세스 스폰.                                |
| `POST /reuse-agent`         | idle 에이전트의 PTY에 새 지시 주입(재사용).                   |
| `POST /dispatch-task`       | 스마트 디스패치(reuse/restart/spawn/logical 자동 결정).       |
| `POST /kill-agent`          | 에이전트 종료.                                                |
| `POST /set-agent-status`    | 에이전트 상태 갱신.                                           |
| `POST /reap-worktree`       | DONE/머지된 워크트리 정리.                                    |
| `POST /notify-orchestrator` | **완료 통지** — 오케 PTY에 메시지 주입(완료 루프의 핵심).     |
| `POST /inject-message`      | 특정 에이전트/오케 PTY에 메시지 주입(렌더러·크로스머신 경로). |

이 엔드포인트들의 **호출자**는 두 부류다:

1. **marblo MCP 서버** — 에이전트가 부른 MCP 툴을 HTTP로 변환해서 때림.
2. **Electron 렌더러(UI)** — `preload.ts`의 IPC(`bridge:injectMessage` 등)를 거쳐 때림.

---

## 3. 통신 경로 4가지

### 3-1. 에이전트 → 보드 (MCP stdio → bridge HTTP)

에이전트는 보드 API를 직접 모른다. 자기 전용 MCP 서버를 통한다.

```
에이전트 CLI ──(MCP 툴 호출: claim_task / add_activity / submit_for_review …)──▶ marblo MCP(stdio)
                                                                                      │
                                            tools.ts 가 매 호출 process.env.MARBLO_BRIDGE_PORT 를 읽어
                                                                                      ▼
                                                          POST http://127.0.0.1:<port>/dispatch-task 등
                                                                                      │
                                                                                      ▼
                                                              bridge-server → AgentManager/PtyManager/보드
```

- MCP 서버는 bridge 포트를 **env(`MARBLO_BRIDGE_PORT`, 부모가 주입)** 또는 **discovery 파일(`~/.marblo/bridge-port`, 외부 Claude Code 세션이 글로벌 MCP로 띄운 경우)** 에서 얻는다.
- `tools.ts`는 **매 호출마다** env를 다시 읽으므로, 포트만 최신으로 유지되면 다음 호출이 자동으로 재연결된다(§6 회복력 참고).

### 3-2. 오케 디스패치 → 에이전트 스폰

```
오케(또는 사람) ──dispatch_task──▶ MCP ──POST /dispatch-task──▶ AgentManager
                                                                   ├─ reuse 가능한 idle 에이전트 있으면 PTY에 지시 주입
                                                                   └─ 없으면 새 CLI 프로세스 스폰 + PTY 탭 attach
   스폰 시 agent-config.ts 가 그 에이전트 전용 claude-mcp-<id>.json 을 만들어 붙인다
   (그 안에 command:"node" dist-mcp/index.js + MARBLO_BRIDGE_PORT + MARBLO_AGENT_ID …)
```

### 3-3. 완료 루프 (가장 중요 — 오케가 "끝났다"를 아는 유일한 경로)

```
에이전트가 작업 끝 → submit_for_review / update_task_status (MCP 툴) 호출
        │
        ▼
mcp-server/tools.ts 가 자동으로 ──POST /notify-orchestrator──▶ bridge
        │
        ▼
OrchestratorManager 가 오케 PTY stdin 에 완료 메시지를 주입  ← 오케가 비로소 완료를 인지
```

> ✦ **함의:** 에이전트가 일을 다 해도 `submit_for_review`/`update_task_status`를 안 부르면 **오케는 완료를 절대 모른다.** 그래서 디스패치 지시에는 "완료 시 이 툴을 불러라"가 항상 들어가야 한다(`bridge-server.ts`가 디스패치 지시에 완료 프로토콜 푸터를 자동 append 하는 것도 이 때문).

### 3-4. 크로스머신 지시 (Firestore → PTY)

같은 기기가 아니거나 PTY 직접 쓰기가 안 되는 경우, 지시를 Firestore 큐에 넣어 전달한다.

```
add_pending_instruction (MCP) ──▶ Firestore `pendingInstructions` 컬렉션에 doc 추가(isDelivered=false)
                                                  │  (onSnapshot 실시간 구독)
                                                  ▼
해당 에이전트를 호스팅하는 marblo 앱의 PendingInstructionListener 가 그 doc 을 집어
    ├─ 트랜잭션으로 isDelivered=true 원자적 플립(중복 전달 방지)
    └─ 로컬 PTY stdin 에 메시지 주입
```

- `pending-instruction-listener.ts`는 **새로 추가된 doc만(`change.type === "added"`)** 반응한다. Firestore가 재구독 시 전체 스냅샷을 다시 주기 때문에, `deliveredDocIds` Set + 트랜잭션으로 멱등성을 보장한다.

---

## 4. PTY attach / 주입(재주입) 흐름 — 깊게

에이전트는 Ink 기반 TUI(Claude Code/Codex/Gemini)다. 여기에 "메시지를 보내고 제출(Enter)"시키는 건 생각보다 까다롭다. `pty-manager.ts`가 이를 처리한다.

### 4-1. 단순 write vs writeAndSubmit

- `write(id, data)` — 그냥 PTY stdin에 바이트를 흘린다.
- `writeAndSubmit(...)` — **메시지를 넣고 별도의 Enter 키스트로크로 제출**한다. 단순히 `text + "\r"`를 한 번에 쓰면 Ink TUI가 **paste-buffer로 묶어버려** CR이 본문 줄바꿈으로 접히고 제출이 안 된다.

### 4-2. Bracketed paste + 제출 재시도(submit-with-retry)

```
1) bracketedPaste=true(기본): 텍스트를 ESC[200~ … ESC[201~ 로 감싸 "이건 붙여넣기"라고 TUI에 알림(실행 안 됨)
2) 짧은 delay 후 CR("\r")을 별도로 전송
3) PTY 출력을 SUBMIT_VERIFY_MS(600ms) 동안 감시해 "턴이 시작됐다"는 신호(SUBMIT_SIGNAL)를 확인
4) 신호가 없으면 CR을 재전송(최대 SUBMIT_MAX_ATTEMPTS=3회)
   - 이미 제출된/빈 컴포저에 CR이 더 떨어져도 무해(no-op) → 과전송은 안전
```

> 왜 이렇게까지? 부하가 큰 상황(Electron 메인 바쁨, 여러 에이전트가 동시에 PTY 출력 스트리밍)에서 **고정 딜레이 하나만 믿으면 타이밍 레이스**가 난다 — CR이 paste 버퍼에 접혀 메시지가 composer에 그대로 남고, 사용자가 직접 Enter를 눌러야 하는 증상이 된다. 그래서 "보내고-확인하고-필요하면 재전송"으로 막는다.

### 4-3. onExit 레이스 가드 (중요 안전장치)

PTY id는 결정적(`agent-<id>`)이고 재시작 시 **같은 id를 그대로 재사용**한다. 그래서 죽은 **옛 프로세스의 onExit**가 새 세션이 이미 그 id를 차지한 **뒤에** 발화할 수 있다.

```js
session.process.onExit(({ exitCode }) => {
  // THIS 정확한 세션이 아직 그 id를 점유할 때만 맵에서 제거.
  // id 문자열만 비교하면 교체된 새 세션을 지워버려, 살아있는 프로세스가
  // 고아가 되고 이후 모든 write()/writeAndSubmit() 가 조용히 유실된다.
  if (this.sessions.get(id) === session) {
    this.sessions.delete(id);
  }
  callback(exitCode);
});
```

이 가드가 없으면 "오케/에이전트 재오픈 후 입력이 먹통(무음 유실)"이 된다. _현재 HEAD에는 이 가드가 들어가 있다._ 인계 티켓에서 "2차 용의선"으로 적힌 영역이며, 증상이 재현되면 이 레이어와 `orchestrator-manager.ts`의 resume 경로를 함께 본다.

---

## 5. 포트 발견(discovery)과 부팅 순서

1. Electron 부팅 → bridge-server가 동적 포트로 listen → **`~/.marblo/bridge-port`에 포트 기록**.
2. 에이전트 스폰 시 `agent-config.ts`가 그 포트를 `MARBLO_BRIDGE_PORT` env로 자식 MCP에 주입.
3. 외부(글로벌 등록된) Claude Code 세션의 MCP는 env가 없으니 **discovery 파일을 읽어** 포트를 얻는다.
4. MCP 서버는 Firestore 익명 인증(`authReady`)을 거친 뒤 stdio transport를 연결한다.

---

## 6. 회복력(resilience) — 2026-06-19 안정화 반영

세션 도중 MCP가 끊기던 문제를 두 층위로 방어한다.

### 6-1. MCP 프로세스 생존 (`mcp-server/index.ts`, `firebase.ts`)

- **전역 핸들러:** `process.on("unhandledRejection")` / `("uncaughtException")` — **로깅만 하고 프로세스 생존.** 단 한 번의 비치명 에러로 stdio transport 전체가 끊기지 않게.
  - ★ **반드시 stderr만 사용.** stdout으로 한 줄이라도 흘리면 JSONRPC 프레임이 오염돼 strict 클라이언트(Codex 등)가 연결을 끊는다.
- **포트 리프레셔:** bridge가 다른 포트로 재기동되면 discovery 파일은 갱신되지만 우리 env는 stale해진다. **3초 주기로 파일을 재읽어 env를 최신 포트로 맞춰** 다음 호출이 자동 재연결되게 한다(`.unref()`로 종료 안 막음). _단, 부모가 직접 주입한 포트는 신뢰원이라 덮어쓰지 않는다 → 그 경우 재연결은 부모(Electron)의 자식 재스폰이 책임진다._
- **auth 타임아웃:** `authReady`는 절대 reject하지 않고 10초 타임아웃 가드. 인증이 지연/실패해도 서버는 기동(개별 Firestore 호출이 각자 에러 처리).

### 6-2. ★ 단일 장애점: spawn하는 `node` 바이너리 (오늘 사고의 진짜 원인)

- Electron 메인은 **모든 자식(MCP/에이전트)을 `command:"node"`로 spawn**한다(`agent-config.ts:740`). 이 `node`는 PATH 첫 항목으로 해석된다.
- **2026-06-19 사고:** `brew`가 icu4c를 74→78로 업그레이드하자, icu4c 74에 링크돼 컴파일된 homebrew node(22.6.0)가 **dyld 로드 불가**가 됐다(`libicui18n.74.dylib` 없음). → `node`로 뜨던 MCP 자식이 **spawn 즉시 사망** → marblo MCP 리커넥트 `-32000`. 코드와 무관한 toolchain 깨짐.
- **즉시 복구:** `brew reinstall node`. **근본 fix:** spawn node를 PATH 의존이 아니라 **검증된 절대경로로 pin**(예: `ELECTRON_RUN_AS_NODE=1` + `process.execPath`, 또는 실행 검증을 통과한 node) — 이게 `resolveClaudeBinary()`의 node 판이고, 별도 티켓으로 진행 중이다.

> 진단 순서(재발 시): ① `lsof -nP -iTCP:$(cat ~/.marblo/bridge-port) -sTCP:LISTEN` 로 bridge 생존 확인(살아있으면 포트/코드 정상) → ② `node dist-mcp/index.js`에 initialize 한 줄 파이프해서 stderr에 dyld 에러 뜨는지 확인 → ③ `/opt/homebrew/bin/node -v`가 dyld 에러면 node 깨진 것.

---

## 7. Firestore의 역할 (왜 외부 의존이 이것 하나인가)

| 용도                  | 설명                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| **공유 진실원**       | 태스크/보드 상태, projection(파생 뷰)을 저장. UI·MCP·다른 기기가 같은 데이터를 본다.                 |
| **크로스머신 우편함** | `pendingInstructions` 큐로 다른 기기의 에이전트에게 지시 전달(§3-4).                                 |
| **재시작 복원**       | 앱을 껐다 켜도 프로젝트/세션 상태를 복원.                                                            |
| **fallback**          | bridge가 죽으면 `get_agents`가 Firestore로 폴백.                                                     |
| **인증**              | MCP는 별도 프로세스라 Auth 컨텍스트가 없어 **익명 인증**으로 보안 규칙의 `isAuthenticated()`를 통과. |

실시간 협업 경로(같은 기기)는 localhost HTTP/PTY라 빠르고, Firestore는 그 위에 **영속·동기·크로스머신**을 얹는 레이어다.

---

## 8. Docker가 필요 없는 이유

- v3 데스크톱의 오케/에이전트/MCP 루프는 **전부 로컬 프로세스**다: Electron 1개 + 그 자식인 CLI(claude/codex) 프로세스들 + 각 CLI의 자식인 node(MCP) 프로세스들. 컨테이너·오케스트레이터(k8s/compose) 없음.
- 격리는 **컨테이너가 아니라 git worktree**로 한다(에이전트마다 `/tmp/wt-*` 또는 `.marblo/worktrees/*`에서 작업 → 파일 충돌 방지).
- 레포에 `v3/docker-compose.prod.yml`이 있긴 하나, 그건 **옛 marblo 웹 제품의 FastAPI 백엔드**(postgres/redis/celery, :8001)용이다. **v3 데스크톱 런타임과 완전 무관**하며 데스크톱을 돌리는 데 필요 없다.

---

## 부록 A. "에이전트가 멈춰 보일 때" 체크리스트

1. **idle인데 지시 안 받음** — dispatch 직후 자동전달이 불안정할 수 있다. `add_pending_instruction`(또는 `reuse_agent`)로 PTY에 직접 주입하고 `get_agents`로 `working` 확인.
2. **메시지가 composer에 남고 제출 안 됨** — §4-2 submit-with-retry가 처리하지만, 극단적 부하에선 잔존 가능. 재주입.
3. **재오픈 후 입력 먹통(무음 유실)** — §4-3 onExit 레이스 가드 영역. HEAD에 방어돼 있으니 증상 지속 시 stale `dist-electron` 빌드 의심(`npm run dev` 재빌드).
4. **marblo MCP 끊김/-32000** — §6-2. bridge 생존부터 확인하고 node 바이너리를 의심.

## 부록 B. 핵심 파일 인덱스

- `electron/bridge-server.ts` — HTTP 허브 + 엔드포인트 + 완료 푸터 append
- `electron/pty-manager.ts` — PTY write/writeAndSubmit/bracketed-paste/submit-retry/onExit 가드
- `electron/pending-instruction-listener.ts` — Firestore → PTY 크로스머신 주입
- `electron/agent-config.ts` — 에이전트별 MCP 설정 생성 + CLI 바이너리 해석(`resolveClaudeBinary`)
- `electron/mcp-server/{index,tools,firebase}.ts` — 에이전트↔보드 stdio MCP(빌드→`dist-mcp/`)
- `electron/orchestrator-manager.ts` — 오케 세션·완료 통지 주입·resume
