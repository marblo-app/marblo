---
name: tf-hold
description: 작업을 일시 중단하고 현재 상태를 정리합니다. 혼란스럽거나 방향 전환이 필요할 때 씁니다.
disable-model-invocation: true
allowed-tools: Bash, Read, Glob, Grep
---

# Marblo 일시 중단

> 정신없이 진행하다가 한 발 물러서서 상황을 정리합니다.
> 작업을 멈추고, 현황을 파악하고, 다음 행동을 결정합니다.

---

## ⛔ 필수 규칙: Marblo MCP 전용

> **절대 Claude Code 내장 도구(TaskCreate, TaskList, TaskUpdate, TaskGet)를 사용하지 마세요.**
> 태스크 조회/기록은 반드시 **Marblo MCP 도구**를 사용합니다:
> `get_all_tasks`, `get_task_activities`, `check_feedback`, `add_activity`

---

## Step 1: 현황 스냅샷

`get_all_tasks`로 전체 태스크를 조회하고 상태별로 정리합니다.

### 출력 형식

```
⏸️  작업 일시 중단 — 현황 정리
━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 전체 현황:
   ✅ DONE:        {n}개
   🔄 IN_PROGRESS: {n}개
   👀 REVIEW:      {n}개
   📋 TODO:        {n}개
   ❌ FAILED:      {n}개
   🚫 BLOCKED:     {n}개
   ━━━━━━━━━━━━━━━
   진행률: {done}/{total} ({percent}%)

🔄 진행 중이던 작업:
   • TASK-003: AI 요약 API
     마지막 활동: "routes/summarize.py 생성 중" (2분 전)

👀 리뷰 대기:
   • TASK-002: 유저 API — 리뷰 필요

❌ 문제 발생:
   • TASK-006: Docker 설정 — "port 8001 already in use"
```

---

## Step 2: 진행 중 태스크 상세 확인

IN_PROGRESS 태스크가 있으면 `get_task_activities`로 어디까지 했는지 확인합니다.

- 마지막 활동 로그
- 생성/수정한 파일 목록
- PM 피드백 유무 (`check_feedback`)

---

## Step 3: 다음 행동 제안

상황에 따라 적절한 행동을 제안합니다:

| 상황 | 제안 |
|------|------|
| REVIEW가 쌓여있음 | "리뷰부터 처리하면 다음 태스크가 풀립니다" → `/tf-review` |
| FAILED가 있음 | "이 문제를 먼저 해결해야 합니다" → `/tf-fix` |
| 방향을 바꾸고 싶음 | "새 태스크를 추가하거나 우선순위를 바꿀 수 있습니다" → `/tf-add` |
| 에이전트가 막혔음 | "직접 이어받을 수 있습니다" → `/tf-handoff` |
| 다 괜찮음 | "이어서 진행합니다" → `/tf-resume` |

---

## Step 4: 중단 메모 (선택)

필요하면 진행 중 태스크에 중단 이유를 기록합니다:

```
add_activity: "⏸️ 작업 중단 — [사유]. 여기까지 진행: [내용]"
```

> 다음에 `/tf-resume`으로 이어할 때 이 메모가 컨텍스트 복원에 도움됩니다.
