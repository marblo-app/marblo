---
name: tf-create-tasks
description: 분석 결과를 기반으로 Marblo MCP에 태스크를 일괄 생성합니다
allowed-tools: Bash, Read, Glob, Grep
---

# Marblo 태스크 생성

> `/tf-analyze` 분석 결과를 기반으로 태스크를 생성합니다.
> 사용자 확인을 받은 후 `create_tasks_bulk`로 일괄 생성합니다.

---

## ⛔ 필수 규칙: Marblo MCP 전용

> **절대 Claude Code 내장 도구(TaskCreate, TaskList, TaskUpdate, TaskGet)를 사용하지 마세요.**
> 반드시 **Marblo MCP의 `create_tasks_bulk`**를 사용합니다.
>
> ```
> ⛔ 잘못된 방법: Claude Code의 TaskCreate를 개별 호출
> ✅ 올바른 방법: Marblo MCP의 create_tasks_bulk를 1번 호출
> ```

---

## Phase 1: 태스크 목록 구성

이전 분석 결과(대화 컨텍스트 또는 `docs/PRD.md`)를 기반으로 태스크를 구성합니다.

### 태스크 카드 형식

```
TASK-001: [제목]
  role: backend | frontend | test | devops
  priority: 5(긴급) ~ 1(낮음)
  depends_on: [TASK-NNN, ...]
  scope: [수정할 파일 경로들]
  완료 기준: [어떻게 되면 끝인지]
```

### 분해 원칙

1. **크기**: 태스크 1개 = 1~2시간 분량
2. **단위**: API 엔드포인트 1개 = 태스크 1개
3. **의존성**: 반드시 순서가 있는 것만 depends_on
4. **scope**: 파일 영역 분리 → Git 충돌 방지
5. **검증**: 각 태스크에 완료 기준 명시

---

## Phase 2: 사용자 확인

```
📋 생성할 태스크: {N}개
📦 프로젝트: {project_name}

TASK-001: [제목] (backend, priority: 5)
TASK-002: [제목] (backend, priority: 4, depends_on: TASK-001)
TASK-003: [제목] (frontend, priority: 4)
...

이대로 생성할까요?
```

**반드시 사용자 확인을 받은 후에만 생성합니다.**

---

## Phase 3: 일괄 생성

1. **프로젝트명 확인**: 모든 태스크에 동일한 project 필드 사용
2. **`create_tasks_bulk` 호출**: 한 번의 호출로 전체 태스크 생성
3. **생성 결과 확인**:
   - `get_all_tasks`로 대시보드 등록 확인
   - 의존성 매핑 확인
   - 누락된 태스크 없는지 확인

---

## Phase 4: 결과 보고

```
✅ 태스크 생성 완료
━━━━━━━━━━━━━━━━━━

📦 프로젝트: {project_name}
📋 생성된 태스크: {N}개

  backend:  {n}개
  frontend: {n}개
  test:     {n}개
  devops:   {n}개

🔗 의존성 체인:
  TASK-001 → TASK-002 → TASK-004
  TASK-001 → TASK-003 → TASK-005

즉시 시작 가능: {M}개 (의존성 없음)

💡 다음 단계: `/tf-spawn-agents`로 에이전트를 배치하세요.
```
