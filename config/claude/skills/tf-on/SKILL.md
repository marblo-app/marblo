---
name: tf-on
description: TaskForce 상시 모드 ON. 이후 모든 작업이 자동으로 태스크포스 티켓을 거칩니다.
disable-model-invocation: true
allowed-tools: Bash, Read, Glob, Grep, Write, Edit
argument-hint: [프로젝트명]
---

# TaskForce 상시 모드 활성화

> **이 스킬을 실행하면 이 세션의 모든 작업이 TaskForce MCP를 거칩니다.**
> 일반 대화 중에도, 코드 수정 중에도, 디버깅 중에도 — 항상 티켓을 의식합니다.

---

## ⛔ 필수 규칙: TaskForce MCP 전용

> **절대 Claude Code 내장 도구(TaskCreate, TaskList, TaskUpdate, TaskGet)를 사용하지 마세요.**
> 모든 태스크 관련 작업은 반드시 **TaskForce MCP 도구**를 사용합니다:
> `get_all_tasks`, `get_available_tasks`, `claim_task`, `update_task_status`,
> `add_activity`, `submit_for_review`, `create_task`, `create_tasks_bulk`,
> `check_feedback`, `acknowledge_feedback`

---

## Step 1: 프로젝트 확인 + 현황 로드

1. 사용자가 프로젝트명을 지정했으면 해당 프로젝트 사용.
   지정하지 않았으면 `get_all_tasks`로 현재 활성 프로젝트 목록을 보여주고 선택하게 합니다.

2. 선택된 프로젝트의 전체 태스크를 조회하고 간략히 보여줍니다:

```
🔛 TaskForce 상시 모드 — {project_name}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  📊 현재 상태:
  ✅ DONE: {n}개  🔄 IN_PROGRESS: {n}개  👀 REVIEW: {n}개
  📋 TODO: {n}개  ❌ FAILED: {n}개

  🔛 상시 모드가 활성화되었습니다.
  이제부터 모든 작업이 자동으로 태스크포스를 거칩니다.
```

---

## Step 2: 상시 모드 규칙 (이 세션 전체에 적용)

**아래 규칙을 이 세션이 끝날 때까지 항상 따릅니다.**

### 규칙 1: 모든 코드 작업 = 티켓 연결

사용자가 무엇을 요청하든, 먼저 관련 태스크가 있는지 확인합니다:

- **관련 태스크가 있으면** → `claim_task` (TODO면) 또는 `add_activity`로 작업 기록
- **관련 태스크가 없으면** → 새 태스크를 `create_task`로 생성한 후 작업
- **단순 질문/대화면** → 티켓 불필요, 그냥 답변

판단 기준:
```
코드를 수정/생성하는가?        → 티켓 필요
버그를 수정하는가?             → 티켓 필요
설정을 변경하는가?             → 티켓 필요
단순 질문에 답하는가?          → 티켓 불필요
파일을 읽기만 하는가?          → 티켓 불필요
```

### 규칙 2: 작업 시작/완료 시 상태 업데이트

```
작업 시작 시: update_task_status → IN_PROGRESS (또는 claim → IN_PROGRESS)
작업 중:     add_activity로 주요 진행 기록 (파일 생성, 테스트 결과 등)
작업 완료 시: submit_for_review (리뷰 필요) 또는 add_activity (부분 완료)
```

### 규칙 3: 자연스럽게 흘려보내지 않기

사용자가 "이것도 해줘", "저것도 바꿔줘" 같이 추가 요청을 할 때:

1. 기존 태스크의 범위 내인가? → 같은 태스크에 `add_activity`
2. 새로운 작업인가? → `create_task`로 새 태스크 생성 후 진행
3. **절대 티켓 없이 코드를 수정하지 않습니다.**

### 규칙 4: 주기적 현황 보고

- 태스크 완료 시마다 간략 현황 표시:
```
✅ TASK-003 완료 → 진행률: 5/12 (42%)
```
- 3개 이상 작업 연속 시, 중간에 한 번 전체 현황 요약

### 규칙 5: PM 피드백 주시

- 태스크 시작 전 `check_feedback`으로 미확인 피드백 확인
- 피드백이 있으면 사용자에게 알림:
```
💬 미확인 피드백 {n}건 — /tf-feedback으로 확인하세요
```

---

## 비활성화

상시 모드를 끄려면 사용자가 다음 중 하나를 말합니다:
- `/tf-off`
- "태스크포스 모드 꺼줘"
- "상시 모드 해제"

비활성화 시:
```
🔴 TaskForce 상시 모드 OFF
  이 세션에서 {n}개 태스크 처리, {n}개 활동 기록됨.
```
