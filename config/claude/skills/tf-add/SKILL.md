---
name: tf-add
description: 진행 중인 프로젝트에 새 태스크 추가 또는 기존 태스크 수정(우선순위, 설명 등)
allowed-tools: Bash, Read, Glob, Grep, Write, Edit
---

# Marblo 태스크 추가 / 수정

> 진행 중인 프로젝트에 새 태스크를 추가하거나, 기존 태스크를 수정합니다.
> "태스크 추가해줘", "우선순위 바꿔줘", "설명 수정해줘" 등 모두 이 스킬로 처리합니다.

---

## ⛔ 필수 규칙: Marblo MCP 전용

> **절대 Claude Code 내장 도구(TaskCreate, TaskList, TaskUpdate, TaskGet)를 사용하지 마세요.**
> 태스크 생성/조회는 반드시 **Marblo MCP 도구**를 사용합니다:
> `create_task`, `create_tasks_bulk`, `get_all_tasks`, `get_available_tasks`
>
> 새 태스크의 `project` 필드는 기존 태스크와 동일한 프로젝트명을 사용하세요.

---

## 단계

1. `get_all_tasks`로 현재 프로젝트의 태스크 목록을 확인합니다.
2. 사용자에게 새로 추가할 작업을 물어봅니다.
3. 기존 태스크와의 의존성을 분석합니다:
   - 어떤 태스크가 먼저 완료되어야 하는지 (depends_on)
   - 어떤 태스크와 파일 영역이 겹치는지 (scope)
4. `create_task` 또는 `create_tasks_bulk`로 태스크를 생성합니다.
5. 생성된 태스크의 의존성이 이미 충족되었으면 바로 작업 시작 가능함을 알립니다.

## 예시

```
사용자: "결제 기능도 추가하고 싶어"
→ 기존 태스크 확인
→ TASK-009: 결제 API (backend, depends_on: TASK-001)
→ TASK-010: 결제 UI (frontend, depends_on: TASK-009)
→ TASK-001이 이미 DONE이면 → TASK-009 바로 available
```

---

## 기존 태스크 수정

사용자가 기존 태스크의 수정을 요청하면 (우선순위, 설명, scope 등):

1. `get_all_tasks`로 현재 태스크 목록을 보여줍니다.
2. 수정 대상 태스크를 사용자에게 확인합니다.
3. 수정 내용에 따라 처리:
   - **우선순위 변경**: `curl -X PATCH` 로 백엔드 API 직접 호출
   - **설명/scope 변경**: `curl -X PATCH` 로 백엔드 API 직접 호출
   - **의존성 변경**: 태스크 재생성이 필요할 수 있음 (기존 삭제 → 새로 생성)
4. `add_activity`로 "수정: [변경 내용]" 기록

```
예시:
  사용자: "TASK-003 우선순위를 5로 올려줘"
  → PATCH /api/tasks/{id} body: {"priority": 5}
  → add_activity: "우선순위 변경: 3 → 5"
```

---

## 주의사항

- 기존 태스크와 scope가 겹치지 않도록 주의
- 이미 IN_PROGRESS인 태스크에 의존성을 걸면 대기가 길어질 수 있음
- priority를 적절히 설정해서 기존 작업 흐름에 맞추기
- 수정 시 `project` 필드는 변경하지 않기 (프로젝트 병합은 대시보드의 Merge 기능 사용)
