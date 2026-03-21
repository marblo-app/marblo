---
name: tf-start
description: PRD 기반으로 태스크를 생성하고 에이전트를 스폰해서 프로젝트를 시작합니다. /tf-plan 이후에 사용합니다.
disable-model-invocation: true
allowed-tools: Bash, Read, Glob, Grep, Write, Edit
argument-hint: [프로젝트명]
---

# Marblo 프로젝트 킥오프

> `/tf-plan`으로 PRD + 태스크 계획이 확정된 후 실행합니다.
> PRD가 없으면 먼저 `/tf-plan`을 안내합니다.

---

## ⛔ 필수 규칙: Marblo MCP 전용

> **절대 Claude Code 내장 도구(TaskCreate, TaskList, TaskUpdate, TaskGet)를 사용하지 마세요.**
> 반드시 **Marblo MCP 도구**만 사용합니다:
> - 태스크 일괄 생성: `create_tasks_bulk` (한 번의 호출로 전체 태스크를 한꺼번에 생성)
> - 태스크 단건 생성: `create_task`
> - 태스크 조회: `get_all_tasks`, `get_available_tasks`
> - 태스크 작업: `claim_task`, `update_task_status`, `add_activity`, `submit_for_review`
> - 기타: `check_feedback`, `get_task_activities`, `get_agent_skill`, `get_task_dependencies`
>
> **Claude Code 내장 TaskCreate로 개별 등록하면 안 됩니다.** Marblo 대시보드에 표시되지 않습니다.
> **`create_tasks_bulk`를 사용하면 한 번의 호출로 모든 태스크가 일괄 등록됩니다.**

---

## Pre-flight 체크

시작 전에 확인합니다:

1. **PRD 확인**: `docs/PRD.md` 또는 이전 대화에서 확정된 계획이 있는지 확인
   - 없으면: "먼저 `/tf-plan`으로 계획을 세워주세요." 안내 후 중단
   - 있으면: PRD를 읽고 태스크 목록 추출

2. **환경 확인**:
   - Marblo MCP 연결 확인: `get_all_tasks` 호출 테스트
   - 프로젝트 디렉토리 존재 확인
   - 기존 태스크가 있으면 충돌 여부 확인

3. **사용자 최종 확인**:
   ```
   📋 생성할 태스크: {N}개
   📦 프로젝트: {project_name}

   TASK-001: [제목] (backend, priority: 5)
   TASK-002: [제목] (backend, priority: 4, depends_on: TASK-001)
   ...

   이대로 생성하고 시작할까요?
   ```

---

## Phase 1: 프로젝트명 확인 + 태스크 일괄 생성

### 1-1. 프로젝트명 확인

PRD에 명시된 프로젝트명을 사용합니다. 없으면 사용자에게 확인합니다.
**이 프로젝트명이 모든 태스크의 `project` 필드에 일관되게 들어갑니다.**

### 1-2. 태스크 목록 → `create_tasks_bulk` JSON 변환

PRD의 태스크 계획을 **하나의 `create_tasks_bulk` 호출**로 변환합니다.

각 태스크에 필수 필드:
   - `title`: 명확한 제목
   - `description`: 구체적인 작업 내용 + 완료 기준
   - `role`: backend / frontend / test / devops
   - `priority`: 5(긴급) ~ 1(낮음)
   - `depends_on`: 의존성 (TASK-NNN 형식)
   - `scope`: 수정할 파일 경로 (충돌 방지)
   - `project`: **Phase 0에서 확정한 프로젝트명** (모든 태스크 동일)

### 1-3. 일괄 생성 실행

**반드시 Marblo MCP의 `create_tasks_bulk`를 한 번 호출해서 모든 태스크를 한꺼번에 생성합니다.**

```
⛔ 잘못된 방법: Claude Code의 TaskCreate를 13번 개별 호출
✅ 올바른 방법: Marblo MCP의 create_tasks_bulk를 1번 호출
```

### 1-4. 생성 결과 확인

- 전부 성공했는지
- 의존성 매핑이 올바른지
- `get_all_tasks`로 대시보드에 등록되었는지 확인

---

## Phase 2: 에이전트 스폰 + 작업 시작

1. `get_agent_skill`로 각 역할의 스킬 파일을 로드합니다:
   - backend → `skills/backend_agent.md`
   - frontend → `skills/frontend_agent.md`
   - test → `skills/test_agent.md`
   - devops → `skills/devops_agent.md`

2. `get_available_tasks`로 즉시 처리 가능한 태스크를 확인합니다.
   - 의존성이 없거나 이미 충족된 태스크

3. Team Leader로서 에이전트를 스폰합니다:
   - 각 에이전트에게 스킬 파일 + 태스크 정보 전달
   - scope로 파일 영역 분리 → 병렬 작업 가능

4. 작업 루프:
   ```
   for each available task:
     1. claim_task (agent_id 지정)
     2. update_task_status → IN_PROGRESS
     3. 실제 코딩 작업 수행
     4. add_activity로 진행 기록 (파일 생성, 테스트 결과 등)
     5. submit_for_review
     6. 다음 available 태스크 확인
   ```

5. 작업 진행 중 보고:
   ```
   🚀 프로젝트 킥오프 완료
   ━━━━━━━━━━━━━━━━━━━
   생성된 태스크: {N}개
   즉시 시작 가능: {M}개
   에이전트 스폰: backend, frontend

   현재 진행 중:
   - TASK-001: DB 스키마 설계 (Backend Agent)

   대기 중:
   - TASK-002: 유저 API (TASK-001 완료 대기)
   - TASK-003: 메인 UI (TASK-002 완료 대기)
   ```

---

## Phase 3: 모니터링

작업 진행 중 지속적으로 확인합니다:

1. 태스크 완료 시 → 의존성 풀린 다음 태스크 자동 시작
2. REVIEW 올라오면 → 사용자에게 알림
3. FAILED 발생 시 → 원인 분석 + 사용자에게 보고
4. 중간 `check_feedback`으로 PM 피드백 확인

> 사용자가 중간에 멈추고 싶으면 `/tf-hold`를 안내합니다.
