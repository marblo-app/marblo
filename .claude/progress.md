# Marblo - Progress

## Completed

### Phase 0 PRD v1.1 — Sprint A 코드베이스 검증 반영 (2026-04-29)
v3 코드베이스 사전 점검 결과를 PRD에 반영. 기존 부분 추상화 발견(`flow-engine/types.ts:LLMProvider`, `flow-engine/llm-provider.ts:createLLMProvider`, `pty-manager.ts:PtyManager`, `fs-manager.ts:FsManager`, `mcp-server/`)으로 Sprint A 작업량 3-4일 → 2-3일 단축. 두 LLM 클라이언트(`orchestrator/llm-client.ts` ↔ `flow-engine/llm-provider.ts`) 통합은 Sprint A 범위 외로 명시. 선결 조건(현재 INP/터미널 perf 수정 commit 정리, MM TerminalView 정리, `feat/adapter-foundation` 브랜치) 명문화.

**진행 결정:** 현재 진행 중인 INP/터미널 perf 수정 작업(13개 modified files)을 먼저 commit 정리 + main 머지 후, 별도 브랜치에서 Sprint A 착수.

**수정 파일:** `docs/03_marblo_phase0_foundation_prd.md` (v1.0 → v1.1)

### Phase 0 PRD 작성 — 6월 런칭 + Enterprise In-place 토대 (2026-04-29)
Core PRD v1.0의 Week 1-4 모노레포 빅뱅 마이그레이션 계획을 솔로 capacity + 6월 hard deadline에 맞춰 **in-place 점진적 준비**로 재설계. Phase 0(2026-05) must-do는 3개 Sprint로 한정.

**전략 결정:**
- 모노레포 마이그레이션, Gateway Agent, Control Plane, OPA, PII Scanner, Helm 등 Enterprise 본 기능은 첫 PoC 계약 이후로 **명시적 deferred**
- 5월에는 v3 in-place에서 인터페이스/훅/이벤트 토대만 추출 (총 6-9일 작업)
- Sprint A: Adapter 인터페이스 (LLM/MCP/FS/Terminal) — 3-4일
- Sprint B: PolicyHook 포인트 + NoOpPolicyHook — 1-2일
- Sprint C: 이벤트 스키마 + 로컬 JSONL 로깅 — 2-3일
- 6월 런칭은 Week 5-6 베타·결제·라이선스로 일정 그대로

**신규 파일:** `docs/03_marblo_phase0_foundation_prd.md`

### PTY data setImmediate batching 롤백 — INP 회귀 제거 (2026-04-29)
사용자 보고: "처음 최적화했을 때(WebGL + scrollToBottom)보다 지금이 더 느려졌다", 일반 native 터미널은 정상 → 우리 코드의 회귀.

**원인:** main.ts의 `setupPtyForwarding`에 추가한 same-tick `setImmediate` coalescing이 매 PTY chunk마다 1 Node tick의 latency를 추가하고, 같은 tick에 모인 chunk들을 join하면서 xterm refresh 1회당 처리량 증가 → 다음 keystroke의 inputDelay 상승.

**수정:** setImmediate batching 완전 제거. PTY chunk 즉시 `mainWindow.webContents.send` 직접 송신으로 복귀. (이전 시도들의 교훈 주석 남김)

**수정 파일:** `v3/electron/main.ts`

### Canvas2D 렌더러 시도 후 WebGL 복귀 (2026-04-29)
WebGL → Canvas2D 전환했으나 INP inputDelay 80-260ms로 동일. **렌더러 선택이 병목이 아님**을 확정. Canvas는 사용자 체감상 약간 더 느림. WebGL로 복귀.

**결론:** 남은 100-200ms inputDelay는 xterm.js + Electron의 Mac mini 환경 baseline. 우리가 코드로 잘라낼 수 있는 영역 종료. 누적 9단계 최적화로 264ms → 150-200ms 개선 달성. 추가 절감하려면 Electron 의존성 자체를 떠나거나 더 빠른 하드웨어 필요.

**수정:** `OrchestratorTerminal`·`TerminalView`의 `CanvasAddon` → `WebglAddon` 복귀 (canvas-addon은 dependency로 남기되 미사용).

**수정 파일:** `v3/src/components/orchestrator/OrchestratorTerminal.tsx`, `v3/src/components/terminal/TerminalView.tsx`

### cursorBlink off — RAF queue 압력 감소 (2026-04-29)
PTY IPC 60Hz throttle 시도(미적용 후 롤백 — per-frame xterm refresh 비용 증가로 presentation latency 악화 → INP 더 나빠짐). 진단 데이터 재해석: `LONGTASK` 부재 + `inputDelay` 100-300ms 패턴은 50ms 미만 task가 다수 누적되는 시나리오. 그 중 하나로 cursorBlink의 500ms 주기 RAF refresh 제거.

**수정:** OrchestratorTerminal과 TerminalView의 `cursorBlink: true → false`. cursor는 stationary로 표시. 입력 시 cursor 위치는 정상 갱신.

**수정 파일:** `v3/src/components/orchestrator/OrchestratorTerminal.tsx`, `v3/src/components/terminal/TerminalView.tsx`

### INP 진단 도구 강화 (2026-04-29)
"멈췄다 한꺼번에 써지는" 타이핑 패턴은 main thread가 200-300ms 블록되는 long task 문제. 정확한 원인 추적용 PerformanceObserver 강화.

1. **`[LONGTASK]` 옵저버 강화**: `entry.attribution`을 함께 출력 — 어느 script/container가 멈춤을 일으켰는지 판별 가능.
2. **`[INP-SLOW]` 옵저버 신규**: Event Timing API(`type: 'event', durationThreshold: 100`)로 keydown/keyup/input의 INP를 input delay / processing / presentation 3구간으로 분해 출력. inputDelay가 크면 키 이벤트 도달 전 다른 task가 main thread 점유, processing이 크면 xterm 내부 또는 우리 핸들러 문제, presentation이 크면 핸들러 후 paint까지 다른 task 끼어듦.

**수정 파일:** `v3/src/App.tsx`

### xterm 패키지 마이그레이션 — WebGL 호환성 확보 (2026-04-29)
WebGL addon이 `Cannot read properties of undefined (reading 'createElement')` 에러로 silent fallback DOM 모드로 동작 중이던 문제 수정.

**원인:** `xterm@5.3.0`(구 패키지명) ↔ `@xterm/addon-webgl@0.19.0`(신 패키지, @xterm/xterm@6 가정) 간 internal API 불일치.

**수정:**
- `xterm` → `@xterm/xterm@^5.5.0` (신 namespace, v5 라인) 마이그레이션
- `@xterm/addon-webgl` 0.19 → 0.18 (peer @xterm/xterm@^5.0.0)
- import 경로: `xterm` → `@xterm/xterm`, `xterm/css/xterm.css` → `@xterm/xterm/css/xterm.css`
- 구 `xterm` 패키지 제거

**수정 파일:** `v3/package.json`, `v3/src/components/orchestrator/OrchestratorTerminal.tsx`, `v3/src/components/terminal/TerminalView.tsx`

### Orchestrator 터미널 INP 추가 최적화 — store 구독 granular + PTY IPC 배치 (2026-04-29)
INP 264ms 스파이크 추가 개선. 출력 burst 시 IPC 이벤트 폭주 + Zustand 전체 store 구독으로 인한 React 재렌더링이 paint 블록의 주범.

1. **OrchestratorPanel granular Zustand selectors**: `const { ... } = useOrchestratorStore()` (전체 구독) → 슬라이스별 `useOrchestratorStore((s) => s.X)` 7개. 임의 store 변경 시마다 발생하던 재렌더링 차단.
2. **Main 프로세스 PTY 데이터 IPC 배치 (setImmediate)**: 기존 청크당 1회 `mainWindow.webContents.send` → 같은 Node.js tick 내 청크를 `pendingPtyData` Map에 모아 setImmediate 한 번에 합쳐 송신. Claude Code 출력 burst 시 IPC 이벤트 100+개/초 → 1-2개/tick으로 축소. renderer main thread 점유 감소 → keystroke paint 지연 완화.

**수정 파일:** `v3/src/components/orchestrator/OrchestratorPanel.tsx`, `v3/electron/main.ts`

### Orchestrator 터미널 타이핑 딜레이 추가 최적화 — IPC 단방향 + replay 즉시 라이브 + fit 디바운스 (2026-04-29)
WebGL + scrollToBottom 제거에 이어 잔여 레이턴시 제거.

1. **pty:write IPC 단방향화**: `ipcRenderer.invoke` → `ipcRenderer.send`, `ipcMain.handle` → `ipcMain.on`. 키 입력당 Promise round-trip(약 1-3ms) 제거. preload는 호환성 위해 `Promise.resolve()` 즉시 반환.
2. **pty:replay 1.5초 버퍼 윈도우 제거**: 기존 코드는 replay 후 1500ms 동안 신규 PTY 데이터를 buffer에만 쌓고 라이브 송신을 차단 → 패널 expand 직후 1.5초간 입력 echo가 보이지 않음. 이제 replay 호출 즉시 `ptyBuffers.delete()`로 라이브 모드 전환. `replayTimers` Map 삭제. StrictMode 보호는 renderer의 `disposed` 플래그로 충분.
3. **panelHeight fit() 디바운스 (50ms)**: 패널 높이 드래그 중 매 프레임마다 `fitAddon.fit()`이 호출되어 PTY를 재리사이즈하던 문제 해결. setTimeout 50ms 디바운스로 드래그 종료 후 1회만 fit.

**수정 파일:** `v3/electron/preload.ts`, `v3/electron/main.ts`, `v3/src/components/orchestrator/OrchestratorTerminal.tsx`

### dev 모드 remote-debugging-port 동적 할당 (2026-04-29)
재시작 시 `bind() failed: Address already in use (48)` 에러 제거. 9222 하드코딩 → 0(OS 자동 할당)으로 변경. 이전 Electron 프로세스가 macOS TIME_WAIT로 포트를 잡고 있어도 충돌 없음.

**수정 파일:** `v3/electron/main.ts`

### Orchestrator/Terminal 타이핑 딜레이 개선 — WebGL 렌더러 + scrollToBottom 제거 (2026-04-29)
xterm.js DOM 렌더러로 인한 타이핑 지연 해결. Claude Code 출력 burst 시에도 입력 echo가 즉각 표시되도록 개선.

1. **WebGL 렌더러 도입**: `@xterm/addon-webgl@^0.19.0` 추가, OrchestratorTerminal·TerminalView에서 `terminal.open()` 직후 loadAddon. WebGL 미지원 환경은 try/catch로 DOM fallback. `onContextLoss` 핸들러로 GPU context 손실 대비.
2. **핫패스 scrollToBottom 제거**: PTY 데이터 청크마다 호출하던 `scrollToBottom()` 삭제. xterm은 viewport가 bottom일 때 자동 스크롤하므로 명시 호출이 redundant + layout thrashing 유발했음.
3. **userScrolledUp 추적/onScroll 리스너 제거**: 자동 스크롤 동작과 중복되는 피드백 루프 제거.
4. 리사이즈/탭 활성화/패널 높이 변경 시의 scrollToBottom은 의도적 anti-jump 용도라 유지.

**수정 파일:** `v3/package.json`, `v3/src/components/orchestrator/OrchestratorTerminal.tsx`, `v3/src/components/terminal/TerminalView.tsx`

### BigQuery 텔레메트리 ML 준비도 Phase 1 (2026-04-19)
ML 기반 자동화(모델 선택, 프로세스 최적화, 비용 예측, 이상 탐지)를 위한 데이터 파이프라인 기반 구축.

1. **BigQuery 스키마 확장**: events에 10개 ML 컬럼 추가, cost_logs에 4개 컬럼 추가, 신규 3개 테이블(agent_heartbeats, task_outcomes, flow_executions) 생성
2. **Cloud Functions 확장**: logTaskOutcome, logHeartbeat, logFlowExecution 3개 함수 추가 + 기존 함수에 신규 컬럼 처리 반영
3. **미연결 이벤트 브릿지**: Flow(started/nodeExecuted/completed), Session(started/ended), token:usage 텔레메트리 연결
4. **Task outcome 집계**: DONE 전환 시 task_outcomes 테이블에 자동 기록
5. **Agent heartbeat**: 30초 주기 heartbeat 전송 → agent_heartbeats 테이블 (hang/무한루프 감지용)

**신규 파일:** `.claude/progress.md`, `docs/bigquery-ml-readiness.md`
**수정 파일:** `v3/functions/src/index.ts`, `v3/src/services/telemetryService.ts`, `v3/src/hooks/useFlowExecution.ts`, `v3/src/App.tsx`, `v3/electron/telemetry.ts`, `v3/electron/main.ts`, `v3/electron/agent-manager.ts`, `v3/src/hooks/useCostWriter.ts`, `v3/src/services/taskService.ts`, `v3/src/vite-env.d.ts`

### BigQuery 텔레메트리 ML 준비도 감사 문서 (2026-04-19)
현재 파이프라인 분석, 4가지 ML 목표별 갭 분석, 스키마 확장안, 4단계 로드맵 문서 작성.

**신규 파일:** `docs/bigquery-ml-readiness.md`

## In Progress
- Phase 2: 데이터 축적 + 기초 분석 (BigQuery ML 대시보드, baseline 수립)

## Remaining / TODO
- Phase 3: ML 모델 학습 + 추론 (모델 추천기, 비용 예측기, 이상 탐지)
- Phase 4: 프로세스 자동화 통합 (추천→자동 배정, 피드백 루프)
- ~~Cloud Functions 배포~~ (2026-04-19 완료, 20개 함수 전체 배포 성공)

## Issues / Tech Debt
- `task_outcomes.taskType`이 아직 null로 기록됨 — 태스크 메타데이터에 taskType 필드 추가 필요
- `task_outcomes.model`이 null — 에이전트 컨텍스트에서 모델 정보를 task 완료 시점에 전달하는 로직 필요
- heartbeat의 `tokensAccumulated`/`costAccumulated`가 0으로 고정 — CostTracker의 누적값을 연동해야 정확한 값 전달 가능
