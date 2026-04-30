---
name: tf-work
description: 태스크를 claim하고 스킬 파일 규칙에 따라 코딩하면서 진행 상황을 자동 기록합니다
disable-model-invocation: true
allowed-tools: Bash, Read, Glob, Grep, Write, Edit
---

# Marblo 태스크 작업

> 태스크를 하나 잡아서 스킬 파일 규칙대로 코딩합니다.
> 모든 진행 상황이 자동으로 Marblo에 기록됩니다.

---

## ⛔ 필수 규칙: Marblo MCP 전용

> **절대 Claude Code 내장 도구(TaskCreate, TaskList, TaskUpdate, TaskGet)를 사용하지 마세요.**
> 태스크 조회/상태변경/기록은 반드시 **Marblo MCP 도구**를 사용합니다:
> `get_available_tasks`, `claim_task`, `update_task_status`, `add_activity`,
> `submit_for_review`, `check_feedback`, `get_task_activities`, `get_agent_skill`

---

## Step 1: 태스크 선택

1. `get_available_tasks`로 처리 가능한 태스크를 확인합니다.
2. 여러 개면 사용자에게 선택지를 보여줍니다:
   ```
   📋 작업 가능한 태스크:
   1. TASK-003: AI 요약 API (backend, priority: 4) ← 추천 (높은 priority)
   2. TASK-004: URL 입력 화면 (frontend, priority: 4)
   3. TASK-008: Docker 설정 (devops, priority: 2)

   어떤 태스크를 작업할까요? (번호 또는 '1' 자동 선택)
   ```

---

## Step 2: 태스크 시작

1. `claim_task`로 태스크를 claim합니다.
2. `update_task_status` → IN_PROGRESS로 변경합니다.
3. `get_agent_skill`로 해당 role의 스킬 파일을 로드합니다.
4. 태스크의 scope 필드를 확인해서 작업 범위를 파악합니다.

```
🔧 작업 시작:
   태스크: TASK-003 — AI 요약 API
   역할: backend
   scope: backend/routes/summarize.py, backend/services/ai.py
   스킬 규칙: FastAPI + async/await, pytest 필수, HTTPException 에러 처리
```

---

## Step 3: 코딩 + 자동 기록

작업하면서 자동으로 `add_activity`를 호출합니다:

### 기록 타이밍

| 시점 | 기록 예시 |
|------|----------|
| 파일 생성 | "backend/routes/summarize.py 생성 — POST /api/summarize 엔드포인트" |
| 주요 로직 완성 | "Claude API 연동 완료 — 프롬프트 템플릿 + 스트리밍 응답" |
| 테스트 작성 | "test_summarize.py — 3개 테스트 작성" |
| 테스트 실행 | "pytest 결과: 3/3 pass" |
| 이슈 발생 | "⚠️ API 타임아웃 — 30s → 60s로 변경" |
| 결정 사항 | "요약 길이 500자로 제한 (토큰 절약)" |

### 기록 형식

```
[동작] [대상] — [상세 내용]
```

예시:
- "생성 backend/routes/summarize.py — POST /api/videos/{id}/summarize"
- "수정 backend/models.py — summary 컬럼 추가 (Text, nullable)"
- "테스트 3/3 pass — 정상 요약, 빈 자막, 긴 자막 케이스"

---

## Step 4: 완료 + 리뷰 제출

1. 스킬 파일의 완료 기준을 확인합니다:
   - 코드 작성 완료?
   - 테스트 통과?
   - 에러 핸들링?
2. `check_feedback`으로 PM 피드백이 있는지 확인합니다.
3. `submit_for_review`로 리뷰를 제출합니다.

```
✅ 작업 완료:
   TASK-003: AI 요약 API → REVIEW 제출

   산출물:
   • backend/routes/summarize.py (신규)
   • backend/services/ai.py (신규)
   • tests/test_summarize.py (신규)
   • backend/models.py (수정 — summary 컬럼)

   테스트: 3/3 pass
```
