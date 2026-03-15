---
name: tf-resume
description: 중단된 작업이나 새 세션에서 이전 작업을 이어서 진행합니다. 컨텍스트를 자동 복원합니다.
disable-model-invocation: true
allowed-tools: Bash, Read, Glob, Grep, Write, Edit
argument-hint: [프로젝트명]
---

# TaskForce 작업 재개

> 중단했던 작업을 이어서 합니다.
> 새 세션이어도 TaskForce 태스크 현황 + 활동 로그로 컨텍스트를 복원합니다.

---

## ⛔ 필수 규칙: TaskForce MCP 전용

> **절대 Claude Code 내장 도구(TaskCreate, TaskList, TaskUpdate, TaskGet)를 사용하지 마세요.**
> 태스크 조회/기록/상태변경은 반드시 **TaskForce MCP 도구**를 사용합니다:
> `get_all_tasks`, `get_available_tasks`, `get_task_activities`, `check_feedback`,
> `add_activity`, `submit_for_review`, `claim_task`, `update_task_status`

---

## Step 1: 컨텍스트 복원

1. `get_all_tasks`로 프로젝트 전체 현황을 조회합니다.
2. 상태별로 분류하고 현재 위치를 파악합니다.
3. 프로젝트의 PRD가 있으면 읽습니다 (`docs/PRD.md`).

### 복원 우선순위

```
1순위: IN_PROGRESS 태스크 → 내가 작업 중이던 것, 이어서 진행
2순위: REVIEW 태스크    → 리뷰 처리하면 다음 태스크가 풀림
3순위: FAILED 태스크    → 복구 필요
4순위: TODO 태스크      → 새로 시작 가능한 것
```

---

## Step 2: 이어받을 태스크 확인

### IN_PROGRESS가 있을 때

`get_task_activities`로 마지막 활동을 확인합니다:

```
📍 이어서 할 작업:
   TASK-003: AI 요약 API

   지금까지 한 것:
   • routes/summarize.py 생성 완료
   • Claude API 연동 코드 작성 중
   • 마지막 활동: "프롬프트 템플릿 작성 중" (3시간 전)

   남은 것:
   • 에러 핸들링
   • pytest 테스트 작성
   • submit_for_review

   이어서 진행할까요?
```

### REVIEW가 있을 때

```
👀 리뷰 대기 중:
   TASK-002: 유저 API — 3시간 전 제출

   먼저 리뷰하면 TASK-004, TASK-005가 풀립니다.
   리뷰부터 할까요? → /tf-review
```

### PM 피드백 확인

`check_feedback`으로 중간에 온 피드백이 있는지 확인합니다:
- 피드백이 있으면 내용을 보여주고 반영 여부를 물어봅니다.

---

## Step 3: 작업 재개

사용자가 선택한 태스크를 이어서 진행합니다:

1. `add_activity`로 "▶️ 작업 재개" 기록
2. 이전 작업물(코드, 파일) 확인
3. 남은 작업 수행
4. 완료 시 `submit_for_review`

---

## 새 세션 컨텍스트 복원 팁

Claude Code를 새로 열면 이전 대화가 없습니다. 이 스킬이 하는 것:

1. **TaskForce 태스크 현황** → 전체 프로젝트 상태 파악
2. **활동 로그** → 어디까지 했는지 파악
3. **PM 피드백** → 중간에 온 지시사항 확인
4. **PRD 파일** → 프로젝트 전체 맥락 복원
5. **scope 필드** → 어떤 파일을 수정하고 있었는지 파악

> TaskForce 태스크 자체가 "프로젝트의 기억"입니다.
> 대화가 리셋되어도 태스크 현황과 활동 로그가 컨텍스트를 유지합니다.
