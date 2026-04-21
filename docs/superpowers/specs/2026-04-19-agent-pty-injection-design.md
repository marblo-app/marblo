# Agent PTY Message Injection System

## Overview

Marblo 에이전트에 실시간 메시지를 PTY stdin으로 주입하는 통합 시스템.
PM 피드백, 오케스트레이터 디스패치, 칸반 보드 조작 3가지 시나리오를 커버한다.

## Design Decisions

- 에이전트 오프라인 시 → 오케스트레이터 PTY로 폴백
- 메시지 포맷 → 태그 기반 (`[PM Feedback]`, `[Task Reassigned]` 등)
- 칸반 조작 범위 → 전부 (상태/배정/취소/우선순위/설명)
- 의존성 완료 → 오케스트레이터 경유 유지 (기존 구현)

## Architecture

모든 PTY 주입은 bridge-server의 `POST /inject-message` 통합 엔드포인트를 사용한다.

```
Renderer (UI)  →  IPC (bridge:injectMessage)  →  bridge-server
                                                   ├─ agent online  → ptyManager.write(agent.ptySessionId)
                                                   └─ agent offline → ptyManager.write(orchestrator.ptySessionId)
```

### Endpoint: POST /inject-message

```typescript
interface InjectMessageRequest {
  targetAgent: string;       // agent name or "orchestrator"
  tag: string;               // message tag
  message: string;           // body text
  taskId?: string;           // related task ID
}
```

### Message Format

```
[PM Feedback] task="태스크 제목" taskId=abc123
이거 TypeScript 대신 Python으로 바꿔
```

Orchestrator fallback:
```
[PM Feedback → Forwarded] agent="백엔드-에이전트" task="태스크 제목" taskId=abc123
에이전트 오프라인. 원본: 이거 TypeScript 대신 Python으로 바꿔
```

### Tags

| Tag | Trigger |
|-----|---------|
| `PM Feedback` | TaskDetailModal activity tab에서 PM이 메시지 전송 |
| `Task Status Changed` | 칸반 드래그 또는 상태 버튼으로 상태 변경 |
| `Task Reassigned` | TaskDetailModal에서 에이전트 재배정 |
| `Task Cancelled` | 태스크 취소 |
| `Priority Changed` | 우선순위 변경 |
| `Task Updated` | 제목/설명 수정 |

## Scenarios

### 1. PM Feedback (TaskDetailModal)

1. PM이 activity 탭에서 메시지 작성
2. Firestore `activities` 컬렉션에 저장
3. `hasPmFeedback: true` 설정
4. `bridge:injectMessage` IPC 호출 → 에이전트 PTY에 `[PM Feedback]` 주입

### 2. Dependency Completion (기존 유지)

현재 구현 그대로: `update_task_status` MCP → `notifyOrchestrator` → 오케스트레이터 PTY.
변경 없음.

### 3. Kanban Board Manipulation

모든 칸반 조작 후 `bridge:injectMessage` IPC 호출:
- 드래그 상태 변경: `[Task Status Changed]`
- 에이전트 재배정: `[Task Reassigned]` (이전 에이전트 + 새 에이전트 모두)
- 취소: `[Task Cancelled]`
- 우선순위 변경: `[Priority Changed]`
- 제목/설명 수정: `[Task Updated]`

## Files to Change

| File | Change |
|------|--------|
| `electron/bridge-server.ts` | `POST /inject-message` endpoint |
| `electron/main.ts` | `bridge:injectMessage` IPC handler |
| `electron/preload.ts` | `bridge.injectMessage()` API |
| `src/vite-env.d.ts` | `BridgeAPI` type |
| `src/components/board/TaskDetailModal.tsx` | PM feedback injection + hasPmFeedback |
| `src/services/taskService.ts` | inject calls after task mutations |
| `src/components/board/KanbanBoard.tsx` | inject on drag-drop |
