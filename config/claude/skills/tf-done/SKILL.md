---
name: tf-done
description: 프로젝트 완료 정리. 결과 요약 + DONE 태스크 아카이브 + 회고를 진행합니다.
disable-model-invocation: true
allowed-tools: Bash, Read, Glob, Grep
argument-hint: [프로젝트명]
---

# TaskForce 프로젝트 완료

> 모든 태스크가 DONE이거나, 프로젝트를 마무리하고 싶을 때 사용합니다.
> 결과를 정리하고, 완료된 태스크를 아카이브하고, 간단한 회고를 합니다.

---

## ⛔ 필수 규칙: TaskForce MCP 전용

> **절대 Claude Code 내장 도구(TaskCreate, TaskList, TaskUpdate, TaskGet)를 사용하지 마세요.**
> 태스크 조회/기록은 반드시 **TaskForce MCP 도구**를 사용합니다:
> `get_all_tasks`, `get_task_activities`, `add_activity`

---

## Step 1: 프로젝트 현황 최종 확인

`get_all_tasks`로 프로젝트 전체 태스크를 조회합니다.

### 완료 판정

```
📊 프로젝트: {project_name} — 최종 현황
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ✅ DONE:        {n}개
  🔄 IN_PROGRESS: {n}개
  👀 REVIEW:      {n}개
  📋 TODO:        {n}개
  ❌ FAILED:      {n}개

  완료율: {done}/{total} ({percent}%)
```

### 미완료 태스크가 있을 때

- REVIEW → "리뷰 먼저 처리하세요 → `/tf-review`"
- IN_PROGRESS → "진행 중인 작업이 있습니다. 마무리하거나 `/tf-hold`"
- FAILED → "실패한 태스크가 있습니다 → `/tf-fix` 또는 취소"
- TODO → "아직 시작 안 한 태스크가 있습니다. 계속할까요, 취소할까요?"

사용자에게 선택지:
1. 미완료 태스크를 취소하고 프로젝트 마무리
2. 돌아가서 남은 작업 처리

---

## Step 2: 프로젝트 결과 요약

### 산출물 정리

태스크별 scope와 활동 로그를 기반으로 생성된 파일을 정리합니다:

```
📦 프로젝트 산출물
━━━━━━━━━━━━━━━━

  생성된 파일:
  • backend/routes/users.py (TASK-001)
  • backend/routes/summarize.py (TASK-003)
  • frontend/components/UrlInput.tsx (TASK-004)
  • tests/test_users.py (TASK-001)
  • ...

  총 파일: {n}개 (신규 {n} + 수정 {n})
```

### 프로젝트 타임라인

```
📅 타임라인
━━━━━━━━━━

  시작: {first_task_claimed_at}
  완료: {last_task_done_at}
  소요: {duration}

  태스크별:
  • TASK-001: DB 스키마 — 15분
  • TASK-002: 유저 API — 32분
  • ...
```

---

## Step 3: 회고 (선택)

사용자에게 간단한 회고를 제안합니다:

```
💬 프로젝트 회고
━━━━━━━━━━━━━━━

  ✅ 잘 된 것:
  • [에이전트가 순조롭게 처리한 태스크들]
  • [의존성 관리가 잘 된 부분]

  ⚠️ 개선할 점:
  • [FAILED된 태스크 원인]
  • [스킬 파일 수정이 필요한 부분]
  • [태스크 분해가 너무 크거나 작았던 것]

  💡 다음 프로젝트에 반영:
  • [스킬 파일에 추가할 규칙]
  • [태스크 분해 개선 포인트]
```

---

## Step 4: 아카이브

사용자 확인 후 DONE 태스크를 아카이브합니다:

```
이 프로젝트의 완료된 태스크를 아카이브할까요?
아카이브하면 대시보드에서 숨겨지고 "{project}:archived"로 이동합니다.
```

승인 시:
- `POST /api/tasks/archive?project={project_name}` 호출 (curl 사용)
- 결과: `"{n}개 태스크 아카이브 완료"`

```
🎉 프로젝트 완료!
━━━━━━━━━━━━━━━━

  프로젝트: {project_name}
  완료 태스크: {n}개 → 아카이브됨
  산출물: {n}개 파일

  수고하셨습니다!
```
