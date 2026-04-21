# Marblo v3 - Progress

## Completed

### Smart Agent Dispatch — 이종 에이전트 스마트 디스패치 시스템 (2026-04-18)
오케스트레이터의 에이전트 배정 로직 정교화. Bridge Server를 단일 진실 소스로 사용.

**핵심 변경:**
1. **dispatch_task MCP 도구** — reuse/restart/spawn/logical 자동 결정 (스코어링 알고리즘)
2. **GET /agents Bridge 엔드포인트** — AgentManager 실시간 데이터 직접 반환
3. **get_agents 실시간화** — Bridge 먼저 조회, Firestore fallback
4. **이종 모델 스코어링** — Claude/Gemini/Codex 태그 기반 최적 모델 선택
5. **에이전트 자동 정리** — kill_agent, cleanup_agents MCP 도구
6. **Firestore 동기화** — agent:syncStatus IPC로 Bridge→Renderer→Firestore 상태 동기화
7. **enabledModels 프로젝트 설정** — Project 타입 확장 + 환경변수 주입

**수정 파일:**
- `electron/agent-manager.ts` — setStatus(), restart(initialPrompt) 확장
- `electron/bridge-server.ts` — GET /agents, POST /dispatch-task, POST /kill-agent, 스코어링 로직
- `electron/mcp-server/tools.ts` — dispatch_task, kill_agent, cleanup_agents, get_agents 실시간
- `electron/preload.ts` — onSyncStatus 리스너
- `electron/main.ts` — enabledModels 환경변수 주입/정리
- `src/stores/agentStore.ts` — agent:syncStatus 리스너 (이름 매칭)
- `src/types/project.ts` — enabledModels 필드
- `src/vite-env.d.ts` — onSyncStatus 타입
- `skills/orchestrator_agent.md` — dispatch_task 중심 워크플로우 재작성

### Dependency Resolution + Agent Reuse + Auto-Claim (2026-04-17)
3가지 핵심 이슈 해결:

**1. 의존성 자동 해소 (Dependency Resolution)**
- 기존: `DAGResolver.watch()`가 존재하지만 Electron main에서 호출되지 않아 `dependsOnCompleted`가 영원히 false
- 수정: `update_task_status` MCP 도구에 인라인 의존성 해소 로직 추가
- 태스크가 DONE 되면 `dependsOn`으로 연결된 모든 태스크를 확인, 모든 의존성 충족 시 `dependsOnCompleted: true` 설정
- 새로 해소된 태스크에 대해 오케스트레이터에 알림 발송

**2. 에이전트 자동 Claim**
- 기존: 에이전트가 `claim_task`를 건너뛰고 바로 작업 → 태스크가 TODO에 남음
- 수정: `submit_for_review`에서 `claimedBy`가 없으면 자동으로 현재 에이전트 ID로 claim

**3. 에이전트 재사용 (Agent Reuse)**
- 기존: `spawn_agent`가 항상 새 에이전트 생성
- 수정: `reuse_agent` MCP 도구 추가 — 기존 idle 에이전트의 PTY stdin에 새 지시 전송
- Bridge Server에 `/reuse-agent` 엔드포인트 추가
- AgentManager에 `getAgentByName()` 헬퍼 추가
- 오케스트레이터 스킬 파일에 "재사용 우선 정책" 추가: get_agents → idle 확인 → reuse_agent → 부족하면 spawn

**수정 파일:**
- `electron/mcp-server/tools.ts` — 의존성 해소 로직 + auto-claim + reuse_agent 도구
- `electron/bridge-server.ts` — /reuse-agent 엔드포인트
- `electron/agent-manager.ts` — getAgentByName() 메서드
- `skills/orchestrator_agent.md` — 에이전트 재사용 우선 정책, /tf-spawn 업데이트

### Chat/Messaging System (2025-04-14)
프로젝트 채팅, 태스크 코멘트, 에이전트 알림, @멘션 기능 구현

**신규 파일:**
- `src/types/chat.ts` — ChatMessage, TaskComment, ChatMessageType 인터페이스
- `src/services/chatService.ts` — Firestore chatMessages CRUD + 실시간 구독
- `src/services/commentService.ts` — Firestore taskComments CRUD + 실시간 구독
- `src/stores/chatStore.ts` — Zustand 채팅 스토어 (messages, unreadCount)
- `src/components/chat/ProjectChat.tsx` — 프로젝트 채팅 UI (메시지 리스트, @멘션 자동완성, PTY 주입)
- `src/services/agentNotificationService.ts` — 에이전트 이벤트 채팅 알림

**수정 파일:**
- `src/types/index.ts` — chat 타입 re-export 추가
- `src/components/sidebar/Sidebar.tsx` — "채팅" 탭 + unread 배지 추가
- `src/components/board/TaskDetailModal.tsx` — Comments/Activity 2탭 분리
- `src/components/Layout.tsx` — agent:spawned 시 채팅 알림 발송
- `src/stores/agentStore.ts` — getAgentByName() 헬퍼 + restart 알림
- `src/services/taskService.ts` — REVIEW/DONE 전환 시 채팅 알림

**Firestore 컬렉션:**
- `chatMessages` — projectId 기준 프로젝트 채팅
- `taskComments` — taskId 기준 태스크 코멘트

### Kanban Board Simplification (2025-04-14)
칸반 보드 7컬럼 → 5컬럼으로 단순화 (BLOCKED/FAILED 컬럼 제거)

**수정 파일:**
- `src/components/board/KanbanBoard.tsx` — COLUMN_STATUSES 5개, FALLBACK_COLUMN으로 BLOCKED/FAILED → IN_PROGRESS에 표시
- `src/components/board/TaskCard.tsx` — BLOCKED/FAILED 태스크에 좌측 보더 색상 + 상태 배지 추가

### MCP Server Bug Fixes (2025-04-14)
Marblo MCP 서버 3가지 이슈 수정

**수정 파일:**
- `electron/mcp-server/tools.ts`:
  - `create_tasks_bulk`: `tasks` (배열) + `tasks_json` (문자열) 둘 다 지원
  - `update_task_status`: `force: true` 옵션 추가 (상태 머신 건너뛰기)
  - `get_all_tasks`: `all_projects: true` 옵션 추가 (전체 프로젝트 태스크 조회)

### Firestore Fixes (2025-04-14)
- `firestore.rules` — chatMessages, taskComments 보안 규칙 추가 + 배포
- `src/services/firestore.ts` — subscribeToCollection에 에러 핸들러 추가

---

## In Progress

(없음)

---

## Remaining / TODO

- Firestore 인덱스 생성 필요: `chatMessages` (projectId + createdAt desc)
- 채팅 메시지 삭제/수정 기능
- 코멘트 삭제 기능
- @멘션 시 대상이 실행 중이 아닐 때 UI 에러 피드백
- 채팅 메시지 검색

---

## Issues / Tech Debt

- `agentNotificationService`가 dynamic import로 사용됨 (순환 의존성 방지) — 추후 의존성 구조 정리 필요
- Vite 빌드 시 chunk size 경고 (1.4MB) — code splitting 검토 필요
