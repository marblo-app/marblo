# Marblo Project Status

세션 일자: 2026-04-30 ~ 2026-05-02
대상 브랜치: `main` (Marblo / TaskForce.AI 저장소)

> 이 문서는 한 작업 세션의 변경분을 한 번에 검토할 수 있도록 정리한 것입니다.
> 적용을 위해서는 **앱 종료 → `cd v3 && npm run dev` 재기동**이 반드시 필요합니다 (Electron main + 렌더러 양쪽에 변경 있음).

---

## 0. 한눈에 (TL;DR)

| 영역                             | 변경                                                                                        | 상태                                |
| -------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------- |
| 슬래시 커맨드 자동완성           | tf-\* 18개 + gstack 49개 wrapper 생성 (project + 글로벌)                                    | 적용됨 — 새 Claude 창에서 즉시 동작 |
| 터미널 스크롤 안정화             | WebGL 비활성 기본값, slash menu / redraw에 `wantBottom` 래칭, 사용자 의도 보존              | 재시작 후 적용                      |
| Inter-agent 메시지 Enter 안 쳐짐 | `PtyManager.writeAndSubmit(text)` — 텍스트와 `\r` 분리 송신, 7개 호출 지점 일괄 전환        | 재시작 후 적용                      |
| 멀티윈도우 완전 격리 (Phase 1)   | `OrchestratorManager` per-project, PTY → owner 윈도우 라우팅, mainWindow 덮어쓰기 fix       | 재시작 후 적용                      |
| 멀티윈도우 완전 격리 (Phase 2)   | window↔project 매핑, agent 라우팅, BridgeServer projectId 라우팅, MCP `MARBLO_PROJECT` 동봉 | 재시작 후 적용                      |

타입체크: renderer / electron / mcp-server 3종 모두 통과 (단, 사전 존재하던 `lucide-react` / `monaco-editor` / `onboarding/` 미설치 모듈 에러는 무관 이슈로 제외).

---

## 1. 슬래시 커맨드 자동완성 (`/tf-*`, `/gstack`)

### 배경

- `.claude/skills/`에만 등록돼 있던 skill들은 Claude Code의 `/` 자동완성 메뉴에 노출되지 않음 (skills은 모델이 description 매칭으로 호출)
- 슬래시 커맨드는 `.claude/commands/*.md` 파일에 있어야 메뉴에 뜸

### 적용한 변경

- 마블로 프로젝트 `.claude/commands/`: tf-\* 18개 wrapper
- 글로벌 `~/.claude/commands/`: gstack 49개 + tf-\* 18개 (총 71개. 기존 brainstorm/deploy-check/execute-plan/write-plan 4개는 보존)
- 형식: thin wrapper

  ```md
  ---
  description: "<원본 SKILL.md description>"
  disable-model-invocation: true
  ---

  Invoke the `<skill-name>` skill and follow it exactly as presented to you
  ```

- description은 frontmatter에서 추출 (YAML block scalar `|` / `>` 처리 포함)

### 알아둘 점

- `marblo/v3/.claude/`가 별도 존재해서 v3 디렉터리에서 Claude Code를 띄우면 `marblo/.claude/commands/`를 못 봄 → tf 커맨드를 글로벌에도 둔 이유
- 이 사실은 메모리 (`marblo_v3_claude_dir_quirk.md`)에 저장됨
- `/review` 글로벌 wrapper는 Claude Code 빌트인 `/review`를 가리지만 사용자 CLAUDE.md에 의도된 우선순위로 명시돼 있음

---

## 2. 터미널 스크롤 안정화

### 증상

1. 오케스트레이터 / 에이전트 터미널에서 작업 시 채팅 내역이 갑자기 맨 위로 튐
2. 슬래시 메뉴 (`/`) 띄울 때 특히 심함
3. (이전) 한국어 IME 타이핑 시 viewport scroll-up

### 원인

- xterm DOM 렌더러가 큰 redraw (slash 드롭다운 등)에서 viewport scrollTop을 0으로 리셋
- WebGL 렌더러도 같은 종류의 viewport 글리치를 유발 (커밋 `2d0001d`로 기본 비활성)
- 이전 fix는 매 write에서 `wasAtBottom()`을 매번 다시 읽었는데, 렌더러 reset이 false로 잘못 만들어서 진동 (내려갔다 위로 올라갔다 반복)

### 적용한 변경 (`OrchestratorTerminal.tsx` + `TerminalView.tsx` 동일 로직)

- **`wantBottom` 플래그 (default true)** — 렌더러 상태와 분리해서 사용자 의도만 추적
- wheel / PageUp / PageDown / Home / End / Shift+Arrow → 300ms `userScrolling` 윈도우
- `terminal.onScroll` → `isUserScrolling()`이고 `viewportY < baseY`면 `wantBottom = false`, 다시 baseY 복귀하면 `true`
- 매 `pty.onData` chunk → write → `wantBottom`이면 1 RAF 후 `scrollToBottom()`
- 사용자가 스크롤백 위로 올린 경우 보존 (latched), 다시 바닥으로 돌아오면 자동으로 sticky 복귀
- cleanup에 wheel/keydown/onScrollDispose 추가

### 효과

- 렌더러가 viewport를 0으로 리셋해도 다음 RAF에서 자동 복구
- 사용자 PageUp / wheel-up은 절대 강제로 끌어내리지 않음
- slash 메뉴 떴다 사라질 때도 viewport 안정

---

## 3. 에이전트 ↔ 오케스트레이터 메시지 Enter 안 쳐짐

### 원인

- `ptyManager.write(id, text + '\r')`처럼 텍스트와 `\r`을 한 chunk로 보내면 Claude Code (및 Ink 기반 CLI 일반)가 paste-buffer로 처리해서 `\r`이 메시지의 일부가 됨 → submit 안 됨

### 적용한 변경

- `PtyManager.writeAndSubmit(id, text, delayMs=150)` 헬퍼 추가:
  ```ts
  session.process.write(text);
  setTimeout(() => session.process.write("\r"), delayMs);
  ```
- 7개 호출 지점 모두 전환:
  - `bridge-server.ts` ×5: `notify_orchestrator`, `reuse_agent`, dispatch 재사용, inject (agent), inject (orchestrator fallback)
  - `main.ts`: Flow → 기존 에이전트 위임 `taskMessage`
  - `agent-manager.ts`: 신규 에이전트 초기 prompt (readiness 패턴 매칭 후)
  - `orchestrator-manager.ts`: 오케스트레이터 신규 세션 initial prompt (이전 inline split을 헬퍼로 정리)

### 효과

- 에이전트가 오케스트레이터에게 메시지 보내면 Enter까지 자동 입력
- 오케스트레이터 → 에이전트도 동일
- 신규 세션 initialPrompt도 readiness 후 정확히 submit

---

## 4. 멀티윈도우 완전 격리 (창마다 독립 프로젝트)

### 코드 리뷰에서 드러난 결함 4종 (이전 코드)

1. PTY 데이터가 `mainWindow`에만 송신 (line 693, 700, 769)
2. `mainWindow`이 새 창 생성마다 마지막 창으로 덮어씌워짐 → 이전 창은 PTY 이벤트 단절
3. `OrchestratorManager`가 글로벌 싱글톤 → B창의 launch가 A창 세션을 stop
4. `AgentManager`도 글로벌 싱글톤 → 한 창에서 spawn한 에이전트가 다른 창 list에도 보임

### Phase 1 — Orchestrator per-project + PTY 라우팅

**`electron/main.ts`**

- `Map<projectId, OrchestratorManager> orchestrators` + `getOrchestrator(projectId)` 지연 생성
- `getAnyOrchestrator()` — 파일 IO 전용 (resolveSessionId / listSessions / saveSessionLabel)
- `getOrchestratorForSender(senderId)` — sender → 매니저 역조회
- `Map<ptySessionId, webContentsId> ptyOwners` + `sendToOwner(ownerId, channel, ...)`
- `setupPtyForwarding`이 owner에만 `pty:data` / `pty:exit` 전달
- IPC `orchestratorSession:launch / stop / status` — sender 윈도우 매핑 자동 라우팅 (preload API 호환 유지)
- `orchestrator:statusChanged`도 sendToOwner
- 첫 창에서만 `mainWindow` 세팅, 이후 창에서는 덮어쓰지 않음
- 윈도우 close 시 그 창 소유 PTY/orchestrator/owner 매핑 cleanup
- `stopAllOrchestrators()` 헬퍼 (quit / window-all-closed)

**`electron/bridge-server.ts`**

- `setOrchestratorManager(manager)` → `setOrchestratorLookup(projectId => manager|null)`
- `notify_orchestrator` / inject(오케스트레이터 fallback) projectId 기반 라우팅

### Phase 2 — Agent / Bridge / MCP 라우팅 마무리

**A. 윈도우 ↔ 프로젝트 매핑** (`electron/main.ts` + preload + Layout)

- `Map<webContentsId, projectId> windowProjects`
- 신규 IPC `window:registerProject(projectId)` (빈 문자열로 등록 해제)
- `electronAPI.window.registerProject(...)` 노출
- `Layout.tsx`: `currentProject?.id` 변경 useEffect로 자동 등록
- 헬퍼: `sendToProject(projectId, channel, ...args)` (매칭 윈도우 없으면 broadcast fallback)

**B. AgentManager 프로젝트 필터** (`electron/agent-manager.ts`)

- `listAgentsByProject(projectId)` — `launchConfig.env.MARBLO_PROJECT` 매칭
- IPC `agent:list(projectId?)` — explicit 우선, sender registered fallback

**C. 프로젝트 스코프 이벤트** (`electron/main.ts`)

- `agent:statusChanged / restartAttempt / restartFailed`가 owner 윈도우에만 송신
- `projectIdForAgent(agentId)` 헬퍼로 라우팅

**D. BridgeServer 라우팅** (`electron/bridge-server.ts`)

- `SpawnAgentRequest` / `DispatchTaskRequest`에 `projectId?` 옵셔널
- `dispatchTask`가 `listAgentsByProject(params.projectId)` — reusable / restartable / spawn 제약 모두 해당 프로젝트 에이전트만 고려
- `setAgentSpawnedHook(hook)` API — main에서 PTY 소유권 + spawn 알림 가로채 owner 윈도우에만 라우팅
- main이 hook을 wire — bridge가 spawn한 에이전트도 owner 윈도우에만 노출

**E. MCP server → bridge** (`electron/mcp-server/tools.ts`)

- `notify_orchestrator / spawn_agent / reuse_agent / dispatch_task` 호출 body에 `MARBLO_PROJECT`를 `projectId`로 동봉
- 각 에이전트의 MCP는 spawn 시점에 그 프로젝트의 env가 주입돼 있어 자연스럽게 자기 프로젝트로 라우팅

### 동작 시나리오 (재시작 후 검증 포인트)

1. 창 A에서 프로젝트 P1 열고 오케스트레이터 시작
2. 창 B 열기 (새 창) — 창 A는 영향 없음 (mainWindow 안 흔들림)
3. 창 B에서 프로젝트 P2 선택 → 오케스트레이터 시작 → 창 A의 P1 세션 그대로
4. 창 B에서 에이전트 spawn — 창 A의 agent 목록에 안 보임
5. 에이전트가 `dispatch_task` / `notify_orchestrator` 호출 시 자기 프로젝트로만 라우팅
6. 같은 프로젝트를 두 창에 띄우면 인스턴스 공유 (의도된 동작 — 연속성 유지)
7. 창 닫기 → 그 창 소유 PTY / orchestrator / 매핑 정리

---

## 5. 재시작 가이드

```bash
# 1) 앱 완전 종료
Cmd+Q

# 2) 기존 dev 서버 종료
Ctrl+C  (npm run dev 띄웠던 터미널)

# 3) 재기동
cd v3 && npm run dev
```

> Vite HMR로는 `OrchestratorTerminal.tsx`의 `initializedRef.current` 가드 때문에 useEffect가 재실행되지 않음.
> Electron main 프로세스는 dev 모드에서도 자동 재시작 안 함.
> 따라서 **완전 재기동 필수**.

---

## 6. 알려진 잔여 / 차후 작업 (이번 세션 산출물의 후속)

- **Flow auto-spawn (`handleAgentDelegation`)** — flow 노드에 projectId 메타데이터 없어서 broadcast 그대로 둠. flow 기능 본격 사용하게 되면 노드 컨피그에 projectId 추가하고 라우팅 적용 필요.
- **`/inject-message` / `/set-agent-status` 엔드포인트** — MCP 툴이 직접 안 부르거나 agentId 단일 키 라우팅이라 projectId 라우팅 미적용. 차후 필요 시 추가.
- **같은 프로젝트를 두 창에 띄운 케이스** — 의도된 공유지만, 두 창에서 동시에 오케스트레이터에 입력하면 PTY 입력이 섞일 수 있음. 현재 설계에서는 정상.
- **`/review` 슬래시 커맨드** — gstack wrapper가 빌트인을 가림. 의도된 우선순위.

---

## 7. 발매 전 TODO (2026-06 hard deadline)

> 출처: `docs/03_marblo_phase0_foundation_prd.md`. 본 섹션은 그 PRD의 일정/Sprint를 운영용 체크리스트로 옮긴 것.
> 우선순위: **P0** = 발매 차단, **P1** = 강력히 원함, **P2** = 가능하면.

### 7.1 Phase 0 Sprint A — Adapter 인터페이스 추출 (P0)

- [ ] `v3/src/adapters/interfaces/LLMAdapter.ts`
- [ ] `v3/src/adapters/interfaces/MCPAdapter.ts`
- [ ] `v3/src/adapters/interfaces/FileSystemAdapter.ts`
- [ ] `v3/src/adapters/interfaces/TerminalAdapter.ts`
- [ ] `v3/src/adapters/interfaces/RequestMetadata.ts` (공통)
- [ ] `v3/src/adapters/standard/DirectLLMAdapter.ts` — 기존 LLM 호출 로직 그대로 옮김
- [ ] `v3/src/adapters/standard/DirectMCPAdapter.ts`
- [ ] `v3/src/adapters/standard/LocalFSAdapter.ts`
- [ ] `v3/src/adapters/standard/PtyTerminalAdapter.ts` (Patent Pending 주석)
- [ ] 호출자 리팩토링 — 인터페이스 의존, AdapterRegistry/DI로 주입
- [ ] v3 smoke test 통과 (오케스트레이터 / 에이전트 spawn / 칸반 / 플로우)
- [ ] **단축 가능**: 기존 `LLMProvider` / `LLMClient` / `PtyManager` / `FsManager` 재활용 (래핑 + `RequestMetadata` 주입 위주)

### 7.2 Phase 0 Sprint B — Hook 포인트 + NoOpPolicyHook (P0)

- [ ] `v3/src/adapters/interfaces/PolicyHook.ts` — `preRequest` / `postResponse` / `onError`
- [ ] `HookDecision<T>` 타입 (allow / deny / transform)
- [ ] `v3/src/adapters/standard/NoOpPolicyHook.ts`
- [ ] 4개 Direct Adapter 모두 Hook 경유 패턴 일관 적용
- [ ] await 누락 검증

### 7.3 Phase 0 Sprint C — 이벤트 스키마 + JSONL 로깅 (P1, 데드라인 시 축소 가능)

- [ ] `v3/src/events/types.ts` — `MarbloEvent`, `EventType`
- [ ] UUID v7 생성기
- [ ] `v3/src/events/emitter.ts` — append-only JSONL writer
- [ ] OS별 경로: `~/Library/Application Support/Marblo/events/{date}.jsonl` 등
- [ ] 비동기 fire-and-forget queue, fsync 1초/100건 주기
- [ ] 발행 지점: `agent.spawned`, `agent.terminated`, `llm.request/response`, `mcp.invoked`, `terminal.executed`, `task.created/updated`
- [ ] 모든 이벤트에 `eventId / eventType / timestamp / version=1` 필드
- [ ] **축소 옵션**: 데드라인 압박 시 5종(llm.request/response, agent.spawned/terminated, task.updated)만

### 7.4 결제 / 라이선스 (P0)

- [ ] Stripe 통합 (글로벌 / Pro 19,000원/월, Team 29,000원/월)
- [ ] Toss 통합 (한국)
- [ ] 라이선스 키 발급 백엔드
- [ ] 라이선스 검증 클라이언트
- [ ] Free → Pro / Pro → Team 업그레이드 플로우
- [ ] 결제 영수증 / 인보이스 / 환불 / 취소 처리
- [ ] 프로젝트 1개 제한 (Free 티어) 적용

### 7.5 온보딩 / 가입 흐름 (P0)

- [ ] 첫 실행 환영 화면
- [ ] BYOK 키 입력 단계 (Anthropic / OpenAI / Google)
- [ ] 첫 프로젝트 / 첫 오케스트레이터 가이드
- [ ] 결제 단계 — Free 시작 / Pro 즉시 업그레이드
- [ ] _참고: `v3/src/components/onboarding/`에 작업 진행 중 (untracked)_

### 7.5b Harness — 번들 + 스토어 (P0 일부, P1 일부)

> 컨셉: tf-\* 슬래시 + Marblo MCP 같은 "Marblo가 동작하기 위해 필수"인 항목은 앱 설치 시 자동으로 사용자 `~/.claude/`에 복사.
> 그 외 superpowers / gstack / 차후 외부 패키지는 Harness 탭에서 카드 클릭 한 번으로 설치/제거.

**필수 번들 (P0)**:

- [x] `v3/electron/bundle-installer.ts` — 앱 시작 시 idempotent 설치
  - tf-\* 18개 commands → `~/.claude/commands/` ✅
  - tf-\* skills → `~/.claude/skills/` ✅
  - Marblo MCP 등록 → `~/.claude.json` mcpServers.marblo ✅ (port-discovery 파일 `~/.marblo/bridge-port` 메커니즘 도입)
- [x] 버전 마커 (`~/.claude/.marblo-bundle-version`) — 앱 버전 변경 시에만 덮어씀, 사용자 커스텀 보존
- [ ] electron-builder `extraResources`에 bundled-harness 디렉터리 포함 (production 빌드용 — 차후)
- [x] 첫 실행 + 매 업데이트 시 자동 검증

**Harness 큐레이팅 카탈로그 (P0/P1 혼합)**:

- [ ] `v3/electron/harness-catalog.ts` — 큐레이팅된 패키지 목록 (id / name / 설명 / 설치 소스 / type)
- [ ] 초기 카탈로그: `superpowers` (Anthropic skills), `gstack` (Marblo creator's skill set), 필수 MCP들 (예: filesystem, github, context7)
- [ ] IPC: `harness:list` / `harness:install(pkgId)` / `harness:uninstall(pkgId)` / `harness:status`
- [ ] 설치 동작: git clone → `~/.claude/skills/<name>/` 또는 MCP면 `~/.claude.json`에 머지
- [ ] 제거 동작: 디렉터리 / MCP entry 삭제

**Harness UI (P1)**:

- [x] `v3/src/components/harness/HarnessStore.tsx` — 모달 + 탭 양쪽 렌더 지원 (`onClose` prop)
- [x] 카드 그리드 (이름 / 설명 / Install / Installed / Update available)
- [x] 진행 상태 표시 (다운로드 / 설치 중)
- [x] 진입점: TabBar `harness` 탭 + 단축키 `Cmd/Ctrl+Shift+H`
- [x] `GuideTab` — 첫 번째 탭, tf 슬래시 / Marblo MCP / 멀티윈도우 / Harness 사용법 한 페이지

**Custom URL 설치 (P1, 베타 후)**:

- [ ] GitHub URL 입력 → 신뢰 경고 모달 → git clone
- [ ] 설치된 외부 패키지 추적

**Enterprise 화이트리스트 (Phase 1, 6월 후)**:

- [ ] 관리자가 허용한 패키지만 노출 (Harness 정책 훅 — Phase 0 PolicyHook 확장)

### 7.6 배포 인프라 (P0)

- [ ] electron-builder mac/win/linux 빌드 검증
- [ ] **macOS code signing + notarization** — Apple Developer ID 필요
- [ ] **Windows code signing** — EV 인증서 권장 (SmartScreen reputation)
- [ ] Linux AppImage / .deb / .rpm
- [ ] 자동 업데이트 (Updater 클래스 production-ready 검증)
- [ ] 다운로드 페이지 / CDN
- [ ] 첫 가동 시 권한 요청 (PTY / FS) UX 점검

### 7.7 보안 / 안정성 (P0)

- [ ] **API 키 암호화 at rest** — 현재 `~/.marblo/api-keys.json` 평문. macOS Keychain / Windows Credential Manager / Linux libsecret 연동
- [ ] CSP 강화 (`webPreferences`)
- [ ] sandbox / contextIsolation 점검
- [ ] 로컬 IPC 권한 화이트리스트
- [ ] 크래시 리포팅 (Sentry 등) — 옵트인
- [ ] `before-quit` cleanup 회귀 (멀티윈도우 변경 후 재검증)
- [ ] electron 최신 안정 버전 확인 (CVE 대응)

### 7.8 안정화 / QA (P0)

- [ ] 멀티윈도우 시나리오 회귀 테스트 (이번 세션 변경분 검증)
- [ ] 한국어 IME 회귀 테스트 (Chromium 업데이트 영향)
- [ ] 메모리 leak 감사 (PTY / xterm / 이벤트 emitter)
- [ ] 16개 동시 에이전트 스트레스 테스트 (Core PRD non-functional 요구사항)
- [ ] 자동 재시작 (sleep / wake / crash) 시나리오
- [ ] 베타 사용자 5-10명 dogfooding 1주

### 7.9 UX / 누락된 기능 (P1)

- [ ] 설정 화면 (API 키 / 모델 프리셋 / 텔레메트리 옵트인)
- [ ] 비용 대시보드 (per agent / per project)
- [ ] 에이전트 헬스 표시 (`onHealthStatus` 활용)
- [ ] 에러 메시지 정제 (사용자 친화적 문구)
- [ ] 단축키 가이드 / Help 메뉴
- [ ] 다국어 (한 / 영) — 글로벌 타겟이면 P0

### 7.10 콘텐츠 / 출시 (P1)

- [ ] 랜딩 페이지 / 가격 페이지
- [ ] 사용자 문서 (Getting Started, FAQ, 트러블슈팅)
- [ ] 데모 영상 (YouTube)
- [ ] Product Hunt 런칭 페이지 + 자료
- [ ] 강의 / 튜토리얼 콘텐츠
- [ ] 특허 출원 진행 ("Patent Pending" 표기 근거)
- [ ] B2B 영업 자료 (Enterprise PRD 요약 deck)

### 7.11 기술 부채 / 정리 (P2)

- [ ] 두 LLM 클라이언트 통합 (`orchestrator/llm-client.ts` ↔ `flow-engine/llm-provider.ts`) — Sprint A 범위 외, 6월 후
- [ ] Flow auto-spawn projectId 라우팅 (이번 세션 잔여)
- [ ] `/inject-message` / `/set-agent-status` projectId 라우팅 (필요 시)
- [ ] 진단용 환경변수 정리 (`VITE_DISABLE_TELEMETRY`, `VITE_DISABLE_TERMINAL_PANEL`, `VITE_USE_WEBGL` 등 — 출시 전에 점검)
- [ ] `monaco-editor`, `lucide-react` 누락 의존성 정리 (typecheck 잡음)
- [ ] 모노레포 마이그레이션 (PoC 직전 또는 6월 런칭 후)

### 7.12 Phase 1 (Enterprise — 6월 이후, 참고용)

- Gateway Agent (Go) / Control Plane (Go + Next.js) / OPA Rego 정책 엔진 / PII Scanner (Hyperscan) / SSO·SAML·OIDC / K8s Helm / 한국 특화 MCP 번들

### 7.13 6월 런칭 일정 (Phase 0 PRD)

| 주차     | 기간        | 주요 작업                               | 게이트              |
| -------- | ----------- | --------------------------------------- | ------------------- |
| Week 1   | 4/29 ~ 5/4  | 현재 기능 개선 finalize + Sprint A 시작 | v3 작업 머지        |
| Week 2   | 5/5 ~ 5/11  | Sprint A 완료 + Sprint B                | Direct 구현체 4종   |
| Week 3   | 5/12 ~ 5/18 | Sprint C + 결제 시작                    | 이벤트 로깅 동작    |
| Week 4   | 5/19 ~ 5/25 | 라이선스 + 온보딩                       | Free→Pro 업그레이드 |
| Week 5   | 5/26 ~ 6/1  | 베타 + 안정화 + 콘텐츠                  | 베타 피드백         |
| **런칭** | **6월**     | Product Hunt + 영상 + B2B 영업 개시     | 첫 결제             |

**중단 기준**: 5/18까지 Sprint A/B 완료 안 되면 Sprint C 폐기 → 결제·라이선스에 모든 자원 투입.

---

## 8. 변경 파일 목록

### 신규

- `~/.claude/commands/*.md` × 49 (gstack)
- `~/.claude/commands/tf-*.md` × 18
- `marblo/.claude/commands/tf-*.md` × 18
- `~/.claude/projects/-Users-.../memory/marblo_v3_claude_dir_quirk.md`
- `~/.claude/projects/-Users-.../memory/MEMORY.md`
- `marblo/docs/project_status.md` (이 문서)

### 수정

- `v3/electron/main.ts` — orchestrator/agent/PTY/window 라우팅 전반
- `v3/electron/orchestrator-manager.ts` — initialPrompt를 `writeAndSubmit`으로 정리
- `v3/electron/agent-manager.ts` — `listAgentsByProject`, `writeAndSubmit` 적용
- `v3/electron/bridge-server.ts` — orchestratorLookup, agentSpawnedHook, projectId 라우팅, `writeAndSubmit`
- `v3/electron/pty-manager.ts` — `writeAndSubmit` 헬퍼 추가
- `v3/electron/preload.ts` — `electronAPI.window.registerProject` 노출, `agent.list(projectId?)`
- `v3/electron/mcp-server/tools.ts` — bridge 호출 body에 `projectId` 동봉
- `v3/src/vite-env.d.ts` — `WindowAPI` 추가, `agent.list(projectId?)` 시그니처
- `v3/src/components/Layout.tsx` — currentProject 등록 useEffect
- `v3/src/components/orchestrator/OrchestratorTerminal.tsx` — `wantBottom` 래칭 + 사용자 스크롤 추적
- `v3/src/components/terminal/TerminalView.tsx` — 동일 로직

### 가져온 외부 변경

- `2d0001d v3: Disable WebGL renderer by default (viewport scroll glitch)` — origin/main에서 fast-forward pull
