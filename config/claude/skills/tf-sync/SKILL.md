---
name: tf-sync
description: 현재 코드 상태와 Marblo 티켓을 동기화합니다. 누락된 업데이트를 잡아내고 티켓을 최신 상태로 맞춥니다.
disable-model-invocation: true
allowed-tools: Bash, Read, Glob, Grep
---

# Marblo 티켓 동기화

> 에이전트가 티켓 업데이트 없이 코딩만 진행한 경우,
> 실제 코드 상태와 티켓 상태를 맞춰줍니다.

---

## ⛔ 필수 규칙: Marblo MCP 전용

> **절대 Claude Code 내장 도구(TaskCreate, TaskList, TaskUpdate, TaskGet)를 사용하지 마세요.**
> 태스크 조회/상태변경/기록은 반드시 **Marblo MCP 도구**를 사용합니다:
> `get_all_tasks`, `update_task_status`, `add_activity`, `submit_for_review`, `claim_task`

---

## 언제 쓰나

- 에이전트가 코드는 작성했는데 `add_activity`나 `submit_for_review`를 안 한 경우
- 직접 코딩했는데 티켓 업데이트를 깜빡한 경우
- 세션이 중간에 끊겨서 티켓 상태가 실제와 안 맞는 경우
- "지금 티켓이랑 실제 진행 상태가 맞나?" 확인하고 싶을 때

---

## Step 1: 현재 상태 수집

두 가지를 동시에 확인합니다:

### 1-1. Marblo 티켓 현황

`get_all_tasks`로 전체 태스크를 조회합니다.
각 태스크의 상태, scope(파일 경로), 마지막 activity를 정리합니다.

### 1-2. 실제 코드 상태

각 태스크의 scope에 명시된 파일들의 실제 존재 여부를 확인합니다:
- 파일이 존재하는가?
- 최근에 수정되었는가? (`git diff`, `git log`)
- 테스트 파일이 있는가?

---

## Step 2: 불일치 감지

티켓 상태와 실제 코드를 비교해서 불일치를 찾습니다:

### 감지 패턴

```
🔍 불일치 감지 결과:
━━━━━━━━━━━━━━━━━━

⚠️ 코드는 있는데 티켓이 TODO:
   TASK-003: AI 요약 API
   → backend/routes/summarize.py 이미 존재 (87줄)
   → tests/test_summarize.py 이미 존재 (3개 테스트)
   → 추천: IN_PROGRESS 또는 REVIEW로 업데이트

⚠️ 티켓이 IN_PROGRESS인데 활동 로그 없음:
   TASK-004: URL 입력 화면
   → 마지막 활동: 없음
   → frontend/components/UrlInput.tsx 존재 (42줄)
   → 추천: add_activity로 현재 상태 기록

⚠️ 티켓이 IN_PROGRESS인데 코드가 완성됨:
   TASK-002: 유저 API
   → backend/routes/users.py 존재 + 테스트 pass
   → 추천: submit_for_review

✅ 정상:
   TASK-001: DB 스키마 — DONE, models.py 존재
   TASK-005: 인사이트 카드 — TODO, 파일 없음 (아직 시작 안 함)
```

---

## Step 3: 동기화 실행

사용자에게 불일치 목록을 보여주고 하나씩 처리합니다:

### 3-1. 각 불일치에 대해 선택지 제시

```
TASK-003: AI 요약 API (현재: TODO → 코드 이미 존재)

  1. REVIEW로 업데이트 (코드 완성됨)
  2. IN_PROGRESS로 업데이트 (아직 작업 중)
  3. 활동 로그만 추가 (상태는 유지)
  4. 건너뛰기

  어떻게 할까요?
```

### 3-2. 선택에 따라 실행

- **REVIEW로 업데이트:**
  1. `update_task_status` → IN_PROGRESS (TODO에서 바로 REVIEW 불가)
  2. `add_activity`: "동기화: 코드 이미 완성됨 — [파일 목록]"
  3. `submit_for_review`

- **IN_PROGRESS로 업데이트:**
  1. `claim_task` (TODO인 경우)
  2. `update_task_status` → IN_PROGRESS
  3. `add_activity`: "동기화: 작업 진행 중 — [현재 상태]"

- **활동 로그만 추가:**
  1. `add_activity`: "동기화: [파일] 존재 확인, [현재 상태 요약]"

---

## Step 4: 동기화 결과 요약

```
🔄 동기화 완료
━━━━━━━━━━━━━

  업데이트됨:  3개
  건너뜀:      1개
  이미 정상:   4개

  현재 상태:
  ✅ DONE:        2개
  👀 REVIEW:      2개  ← 리뷰 필요!
  🔄 IN_PROGRESS: 1개
  📋 TODO:        3개

  💡 다음: /tf-review로 REVIEW 2개 처리
```

---

## 자동 감지 기준

| 티켓 상태 | 코드 상태 | 판정 |
|----------|----------|------|
| TODO | 파일 없음 | ✅ 정상 |
| TODO | 파일 존재 | ⚠️ 누락 — 업데이트 필요 |
| IN_PROGRESS | 파일 존재 + 활동 로그 있음 | ✅ 정상 |
| IN_PROGRESS | 파일 존재 + 활동 로그 없음 | ⚠️ 로그 누락 |
| IN_PROGRESS | 파일 존재 + 테스트 pass | ⚠️ REVIEW 제출 필요 |
| REVIEW | 파일 존재 | ✅ 정상 |
| DONE | 파일 존재 | ✅ 정상 |
| DONE | 파일 없음 | ⚠️ 코드 삭제됨? 확인 필요 |
