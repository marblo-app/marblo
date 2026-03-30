---
name: tf-spawn-agents
description: 태스크를 확인하고 적합한 에이전트를 스폰하여 작업을 시작합니다
allowed-tools: Bash, Read, Glob, Grep, Write, Edit
---

# Marblo 에이전트 스폰

> 생성된 태스크를 확인하고 적합한 에이전트 라인업을 제안합니다.
> 사용자 확인 후 에이전트를 스폰하고 작업을 시작합니다.

---

## ⛔ 필수 규칙: Marblo MCP 전용

> **절대 Claude Code 내장 도구(TaskCreate, TaskList, TaskUpdate, TaskGet)를 사용하지 마세요.**
> 태스크 조회/업데이트는 반드시 **Marblo MCP 도구**를 사용합니다:
> `get_all_tasks`, `get_available_tasks`, `claim_task`, `update_task_status`,
> `add_activity`, `submit_for_review`, `get_agent_skill`

---

## Phase 1: 태스크 확인 + 에이전트 라인업 제안

1. `get_all_tasks`로 프로젝트의 전체 태스크 조회
2. `get_available_tasks`로 즉시 시작 가능한 태스크 확인
3. 역할별로 필요한 에이전트 파악

### 에이전트 라인업 제안

```
🤖 에이전트 라인업 제안
━━━━━━━━━━━━━━━━━━━━━

📋 전체 태스크: {N}개 | 즉시 시작 가능: {M}개

제안 에이전트:
  1. Backend Agent  — TASK-001, TASK-002, TASK-003 담당
  2. Frontend Agent — TASK-004, TASK-005 담당
  3. Test Agent     — TASK-006 담당 (TASK-003 완료 후 시작)

병렬 작업 가능:
  - Backend Agent + Frontend Agent (scope 분리됨)

순차 대기:
  - Test Agent → Backend 완료 후 시작

이대로 스폰할까요?
```

**반드시 사용자 확인을 받은 후에만 스폰합니다.**

---

## Phase 2: 에이전트 스폰

1. `get_agent_skill`로 각 역할의 스킬 파일 로드:
   - backend → `skills/backend_agent.md`
   - frontend → `skills/frontend_agent.md`
   - test → `skills/test_agent.md`
   - devops → `skills/devops_agent.md`
   - flutter → `skills/flutter_agent.md`

2. 에이전트별 작업 지시 구성:
   - 담당 태스크 목록
   - scope (수정할 파일 영역)
   - 의존성 정보
   - 스킬 파일 내용

3. Team Leader로서 에이전트 스폰:
   - 각 에이전트에 스킬 + 태스크 정보 전달
   - scope로 파일 영역 분리 → 병렬 작업

---

## Phase 3: 작업 루프

```
for each available task:
  1. claim_task (agent_id 지정)
  2. update_task_status → IN_PROGRESS
  3. 실제 코딩 작업 수행
  4. add_activity로 진행 기록
  5. submit_for_review
  6. 다음 available 태스크 확인
```

---

## Phase 4: 진행 보고

```
🚀 에이전트 스폰 완료
━━━━━━━━━━━━━━━━━━━

스폰된 에이전트: {N}개
  - Backend Agent  → TASK-001 작업 중
  - Frontend Agent → TASK-004 작업 중

현재 진행 중:
  🔄 TASK-001: DB 스키마 설계 (Backend Agent)
  🔄 TASK-004: 메인 UI 레이아웃 (Frontend Agent)

대기 중:
  📋 TASK-002: 유저 API (TASK-001 완료 대기)
  📋 TASK-003: 결제 API (TASK-001 완료 대기)
  📋 TASK-006: 통합 테스트 (TASK-003 완료 대기)

💡 진행 상황 확인: `/tf-status`
```

---

## Phase 5: 모니터링

작업 진행 중 지속적으로 확인:

1. 태스크 완료 시 → 의존성 풀린 다음 태스크 자동 시작
2. REVIEW 올라오면 → 사용자에게 알림
3. FAILED 발생 시 → 원인 분석 + 보고
4. `check_feedback`으로 PM 피드백 확인

> 중간에 멈추려면 `/tf-hold`를 사용하세요.
