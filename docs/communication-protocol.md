# Marblo 통신 프로토콜 아키텍처

> **요약**: 특허 청구항 1/7/9 가 정의하는 "동일한 표준화된 통신프로토콜"의 구체적 구현은 **MCP를 주(主)로 하고, 4개의 채널이 역할 분담**하는 구조다. MCP 자체는 도구 호출 인터페이스이고, 그것을 실어 나르는 transport (stdio), 결과를 영속화하는 storage (Firestore), 다른 에이전트로 라우팅하는 hop (Bridge HTTP), 그 hop의 마지막 1차 (PTY stdin) — 이렇게 네 단계가 묶여서 청구항이 말하는 협업 체계를 형성한다.

본 문서는 사내 개발자, 외부 개발자, 특허 심사관/라이센스 협상 상대방 모두가 같은 어휘로 마블로의 통신 구조를 이해할 수 있게 하기 위해 작성되었다.

---

## 1. 한 장 다이어그램

```
┌──────────────────────────────────────────────────────────────────────┐
│  Electron Main Process                                               │
│  ┌────────────────────────────┐    ┌────────────────────────────┐    │
│  │ AgentManager / PtyManager  │    │ BridgeServer (HTTP)        │    │
│  │  - 에이전트 spawn / 격리   │    │  - /dispatch-task          │    │
│  │  - PTY stdin/out 관리      │    │  - /inject-message         │    │
│  │  - writeAndSubmit (text+CR)│◀──▶│  - /notify-orchestrator    │    │
│  └────────────────────────────┘    └────────────────────────────┘    │
│           ▲                                       ▲                  │
│           │ (d) PTY stdin 주입                    │ (c) Bridge HTTP  │
│           │                                       │                  │
└───────────┼───────────────────────────────────────┼──────────────────┘
            │                                       │
   ┌────────┴────────┐                  ┌───────────┴──────────────┐
   │ Agent CLI       │  (a) MCP stdio   │ Marblo MCP Server        │
   │ (Claude/Codex/  │◀────────────────▶│ (per-agent Node 자식)    │
   │  Gemini)        │   JSON-RPC       │  - tools.ts (24개 도구)  │
   │ + LLM API       │                  │  - state-machine         │
   └─────────────────┘                  └──────────┬───────────────┘
                                                   │ (b) Firestore SDK
                                                   ▼
                                        ┌──────────────────────────┐
                                        │ Firestore                │
                                        │  - tasks (태스크보드)    │
                                        │  - activities            │
                                        │  - agents, comments      │
                                        │  - pendingInstructions   │
                                        └──────────────────────────┘
                                                   ▲
                                                   │ (실시간 onSnapshot)
                                                   │
                                        ┌──────────────────────────┐
                                        │ Renderer (KanbanBoard,   │
                                        │  AgentDashboard)         │
                                        └──────────────────────────┘
```

---

## 2. 4개의 채널

### (a) MCP stdio — 에이전트가 도구를 부르는 표준 인터페이스

- **무엇을 나르나**: JSON-RPC 2.0 메시지. `tools/list`, `tools/call`, `prompts/list` 등 MCP 표준 메서드.
- **transport**: 표준입력/표준출력 (stdin/stdout). MCP server 가 자식 프로세스로 `node dist-mcp/index.js` 형태로 spawn 됨.
- **사용 모델**: Claude Code / Codex / Gemini CLI **모두 MCP 표준 지원** → 단일 transport 로 이종 모델 통일.
- **코드 위치**:
  - 서버 진입점: `v3/electron/mcp-server/index.ts` — `server.connect(new StdioServerTransport())`
  - 도구 정의: `v3/electron/mcp-server/tools.ts` (24개 도구)
  - 클라이언트 측 config:
    - Claude: `--mcp-config /tmp/.../claude-mcp-<agentId>.json` — `agent-config.ts:generateClaudeConfig`
    - Codex: `[mcp_servers.marblo]` 블록 in `$CODEX_HOME/config.toml` — `agent-config.ts:generateGPTConfig`
    - Gemini: `mcpServers.marblo` 키 in `$HOME/.gemini/settings.json` — `agent-config.ts:generateGeminiConfig`

### (b) Firestore SDK — 태스크보드 영속 저장소

- **무엇을 나르나**: 태스크 도큐먼트, 활동 로그, 에이전트 상태, 코멘트, pending instructions.
- **transport**: Firebase JS SDK 의 gRPC/HTTP. 모든 MCP server 인스턴스 + 모든 Renderer 윈도우가 같은 Firestore 프로젝트 (`marblo-2253d`) 공유.
- **사용 시점**:
  - MCP tool 핸들러가 직접 Firestore CRUD 호출 → 태스크보드 즉시 갱신
  - Renderer 가 `onSnapshot` 으로 실시간 구독 → 칸반/타임라인 자동 동기화
- **코드 위치**:
  - Firestore 초기화: `v3/electron/mcp-server/firebase.ts`
  - 도구별 CRUD: `v3/electron/mcp-server/tools.ts` (예: `claim_task` line 519-560 → `updateDoc(doc(db, "tasks", task_id), {...})`)
  - 상태 머신 가드: `v3/electron/mcp-server/state-machine.ts` (TODO/CLAIMED/IN_PROGRESS/REVIEW/BLOCKED/FAILED/DONE 7개)

### (c) Bridge HTTP — MCP server (자식) ↔ Electron main 간 IPC

- **무엇을 나르나**:
  - `POST /dispatch-task`: 새 에이전트 spawn 또는 기존 에이전트 reuse 결정 요청
  - `POST /inject-message`: 사용자 액션 (칸반보드 조작) → 담당 에이전트 PTY 로 신규지시 라우팅
  - `POST /notify-orchestrator`: 에이전트 작업 진행 상황을 오케스트레이터에게 자동 통지
- **transport**: localhost HTTP. 포트는 `~/.marblo/bridge-port` 파일로 자동 발견 (MCP server 가 시작 시 읽음).
- **왜 필요한가**: MCP server (자식 프로세스) 는 stdio 로 자기 부모 에이전트와만 통신. PTY 조작이나 다른 에이전트 spawn 같은 작업은 Electron main 의 권한이 필요해서, HTTP IPC 가 가장 단순한 다리.
- **코드 위치**:
  - 서버: `v3/electron/bridge-server.ts`
  - 핸들러: `handleDispatchTask` (line 384), `handleInjectMessage` (line 1048+), `handleNotifyOrchestrator` (line 523+)
  - 발신: `v3/electron/mcp-server/tools.ts:notifyOrchestrator()` (line 66) — 모든 `update_task_status` / 의존성 해소 시 자동 호출

### (d) PTY stdin (writeAndSubmit) — 다른 에이전트로의 신규지시 주입

- **무엇을 나르나**: 자유 형식 텍스트 (예: `"[Task Update] X CLAIMED → IN_PROGRESS (...)"` , `"[PM Feedback] 이 부분도 추가해주세요"`).
- **transport**: `node-pty` 의 `proc.write()`. **text 본문과 trailing `\r` 을 150ms gap 으로 분리** 송신 — Claude Code 의 paste-buffer가 CR 을 메시지 본문에 흡수해서 submit 안 되는 문제 회피.
- **수신 측 동작**: 에이전트는 stdin 으로 들어오는 텍스트를 "사용자가 키보드로 친 것"으로 인식 → **실행 중단/재시작 없이 기존 대화 컨텍스트 위에서 처리** (특허 청구항 5의 핵심 비침습 신규지시).
- **코드 위치**:
  - `v3/electron/pty-manager.ts:writeAndSubmit()` (line 66)
  - `v3/electron/agent-manager.ts:composeInitialPrompt()` — 첫 prompt 합성 (skill prepend + mcp\_\_ prefix 제거)
  - 회귀 가드: `v3/tests/e2e/non-invasive-injection.test.ts`

---

## 3. 실제 시퀀스 — 한 에이전트가 태스크 진행할 때

예: **Codex 에이전트가 `claim_task → add_activity → submit_for_review` 수행하고, 그 결과 오케스트레이터가 후속 결정**

```
┌─ Codex CLI (PTY 자식, gpt-5.4)
│   "이 태스크 받을게. claim_task 호출."
│   ↓ (a) MCP JSON-RPC over stdio
│   {"method":"tools/call","params":{"name":"claim_task","arguments":{...}}}
│
├─ Marblo MCP server (per-agent Node 자식)
│   ├─ (b) Firestore: updateDoc(doc(db,"tasks",id), {status:"CLAIMED",...})
│   │
│   └─ (c) Bridge HTTP: POST /notify-orchestrator
│        body: {"message":"[Task Update] X CLAIMED →...", "projectId":"..."}
│
├─ Bridge server (Electron main)
│   ├─ AgentManager.getAgentByName(orchestratorName) → 오케스트레이터 PTY 식별
│   └─ (d) ptyManager.writeAndSubmit(orchestratorPty, "[Task Update] ...")
│
└─ Orchestrator (Claude PTY)
    stdin 으로 "[Task Update] ..." 받음 → 새 사용자 입력으로 인식
    → 의사결정 루프 안에서 다른 에이전트한테 dispatch_task 호출 등 후속
```

같은 시퀀스가 Claude / Gemini 에이전트한테도 **100% 동일** (MCP JSON-RPC가 모델 무관) — 청구항 1의 "동일한 표준화된 통신프로토콜" 의 구체적 매핑.

---

## 4. 사용자 액션 (칸반보드 조작) → 에이전트 시퀀스

특허 명세서 단락 296-297 의 양방향 동기화 **하향 경로**:

```
┌─ 사용자 (KanbanBoard / TaskDetailModal 에서 코멘트 추가)
│   ↓ React onClick
│   handleSendActivity() in TaskDetailModal.tsx:231
│
├─ Renderer
│   ├─ Firestore: addComment(...) — 댓글 도큐 저장 (다른 윈도우 동기화)
│   └─ window.electronAPI.bridge.injectMessage({
│        targetAgent: task.claimedBy,
│        tag: "PM Feedback",
│        message: <user text>,
│        ...
│      })
│
├─ Preload bridge → IPC
│   ipcRenderer.invoke("bridge:injectMessage", params)
│
├─ Main IPC handler (main.ts:1651)
│   └─ fetch http://127.0.0.1:<port>/inject-message  ← (c) Bridge HTTP
│
├─ BridgeServer.handleInjectMessage (bridge-server.ts:1048+)
│   ├─ agentManager.getAgentByName(targetAgent) → PTY 식별
│   └─ (d) ptyManager.writeAndSubmit(pty, "[PM Feedback] task=... \n<text>")
│
└─ 담당 에이전트 PTY
    stdin 으로 신규지시 받음 → 기존 작업 유지 + 신규지시 반영
```

---

## 5. 채널을 4개로 나눈 설계 이유

| 채널                | 이게 없으면                                                                  | 왜 분리됐나                                                                                     |
| ------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **(a) MCP stdio**   | 에이전트가 도구 못 부름                                                      | 모델별 SDK 차이를 단일 표준 (MCP JSON-RPC) 으로 흡수 — Claude/Codex/Gemini 다 native 지원       |
| **(b) Firestore**   | 칸반/대시보드/타임라인 실시간 동기화 안 됨, 멀티윈도우/외부 사용자 공유 불가 | 에이전트의 도구 호출 결과가 영속되어야 사용자 + 다른 에이전트가 그 상태 위에서 작업 가능        |
| **(c) Bridge HTTP** | MCP server (자식) 가 PTY/agent state 에 못 닿음                              | MCP server 의 권한은 stdio + Firestore 만. PTY 조작과 다른 에이전트 spawn 은 Electron main 권한 |
| **(d) PTY stdin**   | 신규지시가 새 세션을 만듦 → 컨텍스트 손실                                    | 에이전트 입장에서 "사용자 키보드 입력" 으로 보여야 청구항 5 의 비침습 주입 성립                 |

---

## 6. 특허 청구항 ↔ 코드 매핑

| 특허 표현                                                                | 마블로 구현                                                                                                                         |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 청구항 1: "동일한 표준화된 통신프로토콜" (단락 108)                      | (a) MCP JSON-RPC over stdio. `mcp-server/index.ts`                                                                                  |
| 청구항 1: "PTY 격리"                                                     | per-agent isolated config (CODEX_HOME, $HOME, --mcp-config) — `agent-config.ts` 의 generateClaudeConfig/GPT/Gemini                  |
| 청구항 5: "PTY 표준입력에 신규지시 입력 시 실행 중단 없이 컨텍스트 유지" | (d) `pty-manager.ts:writeAndSubmit` (text+CR 분리) + 회귀 테스트 `tests/e2e/non-invasive-injection.test.ts`                         |
| 청구항 7: 5개 도구셋 (조회/수락/상태변경/기록/검토요청)                  | (a)+(b). MCP tools: `get_available_tasks` / `claim_task` / `update_task_status` / `add_activity` / `submit_for_review` (`tools.ts`) |
| 청구항 9: 매칭점수 = 역할매칭 + 부하균등 + 비용효율                      | `dispatch-scoring.ts` 의 `scoreAgents()` + `costEfficiencyScore()`                                                                  |
| 청구항 10: 칸반 7개 상태                                                 | `mcp-server/state-machine.ts` 의 TaskStatus union + `components/board/KanbanColumn.tsx`                                             |
| 단락 99: "종류와 역할이 서로 다른 복수 에이전트" 동시 운용               | `dispatch-scoring.ts MODEL_TAG_BONUSES` + `agent-config.ts` 모델별 분기                                                             |
| 단락 228: "오케스트레이터가 자동 생성한 신규지시"                        | (b)→(c)→(d). `update_task_status` 핸들러 (tools.ts:610) → `notifyOrchestrator(...)` → bridge → orchestrator PTY                     |
| 단락 296-297: 양방향 동기화 하향 경로                                    | renderer → IPC → bridge POST /inject-message → PTY stdin (위 §4 시퀀스)                                                             |

---

## 7. 새 모델 / 새 통신 표준 추가 시 영향 범위

특허 명세서가 "MCP를 포함할 수 있고 어느 하나에 한정하지 않는다" 라고 적은 이유는, **(a) 만 다른 표준으로 갈아끼워도 (b)(c)(d) 는 그대로 동작**하기 때문이다. 구체적으로:

- 신규 모델 추가 (예: Anthropic ACP, 자체 JSON-RPC):
  - `agent-config.ts buildCLICommand` 에 case 추가 + 그 모델의 transport 설정만 작성
  - `tools.ts` / `bridge-server.ts` / `pty-manager.ts` 는 무수정
- 신규 도구 추가:
  - `tools.ts` 에 핸들러만 추가 → 모든 모델이 즉시 사용 가능
- 신규 storage backend (예: Postgres):
  - `mcp-server/firebase.ts` 만 교체 → 도구 핸들러 시그니처는 그대로

이 layering 이 특허 청구항 1 의 "신규 에이전트 추가 및 교체 시 동일한 협업체계에 편입" 효과 (단락 110) 를 코드 레벨에서 달성한다.

---

## 8. cross-reference

- 특허 본문: `docs/IP_review.md`
- 특허 보정 요청: `docs/IP_amendment_request.md`
- 핵심 코드:
  - `v3/electron/mcp-server/` — MCP server, tools, state-machine, firebase
  - `v3/electron/bridge-server.ts` — HTTP 게이트웨이
  - `v3/electron/pty-manager.ts` — PTY 격리 + writeAndSubmit
  - `v3/electron/agent-config.ts` — 모델별 isolated config
  - `v3/electron/dispatch-scoring.ts` — 청구항 9 매칭점수
- 회귀 테스트:
  - `v3/tests/e2e/non-invasive-injection.test.ts` — 청구항 5
  - `v3/tests/unit/dynamic-spawn.test.ts` — 청구항 3
  - `v3/tests/e2e/heterogeneous-collab.test.ts` — 단락 99 + 228
  - `v3/tests/unit/dispatch-scoring.test.ts` — 청구항 9
