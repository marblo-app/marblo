---
name: tf-resume
description: 중단된 프로젝트를 이어서 진행합니다. 전체 컨텍스트 복원 → 계획 재점검 → 작업 재개까지 원스톱으로 처리합니다.
disable-model-invocation: true
allowed-tools: Bash, Read, Glob, Grep, Write, Edit
argument-hint: [프로젝트명]
---

# TaskForce 프로젝트 재개

> 새 세션, 또는 며칠 후 돌아왔을 때 — 프로젝트를 완전히 복원하고 이어서 진행합니다.
> 티켓 현황 + 활동 로그 + PRD + 코드 상태를 종합해서 "지금 뭘 해야 하는지"를 알려줍니다.

---

## ⛔ 필수 규칙: TaskForce MCP 전용

> **절대 Claude Code 내장 도구(TaskCreate, TaskList, TaskUpdate, TaskGet)를 사용하지 마세요.**
> 태스크 조회/기록/상태변경은 반드시 **TaskForce MCP 도구**를 사용합니다:
> `get_all_tasks`, `get_available_tasks`, `get_task_activities`, `check_feedback`,
> `add_activity`, `submit_for_review`, `claim_task`, `update_task_status`,
> `create_task`, `create_tasks_bulk`

---

## Phase 1: 전체 컨텍스트 복원

**5가지 소스**를 모두 읽고 종합합니다. 순서대로 진행합니다.

### 1-1. 프로젝트 문서 읽기

아래 파일들을 순서대로 찾아서 읽습니다:

1. **PRD** → `docs/PRD.md` (프로젝트 목표, 기능 목록, 기술 스택)
2. **CLAUDE.md** → 프로젝트 루트 (프로젝트별 규칙, 관례)
3. **자동 메모리** → `.claude/projects/*/memory/MEMORY.md` (이전 세션에서 학습한 패턴, 결정사항)
4. **사용자 지정 문서** → 사용자에게 물어봅니다:
   ```
   📖 추가로 읽어야 할 문서가 있나요?
   (예: docs/NOTES.md, docs/ARCHITECTURE.md, 또는 '없음')
   ```

### 1-2. 티켓 현황 전체 조회

`get_all_tasks`로 프로젝트 전체 태스크를 조회합니다.

```
📍 프로젝트 복원: {project_name}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ✅ DONE:        {n}개  {task titles}
  🔄 IN_PROGRESS: {n}개  {task titles}
  👀 REVIEW:      {n}개  {task titles}
  📋 TODO:        {n}개  {task titles}
  ❌ FAILED:      {n}개  {task titles}
  ━━━━━━━━━━━━━━━
  진행률: {done}/{total} ({percent}%)
```

### 1-3. 마지막 작업 내용 확인

IN_PROGRESS, REVIEW, 최근 DONE 태스크의 `get_task_activities`로 마지막 활동을 확인합니다:

```
📝 최근 활동:
  • TASK-003 (IN_PROGRESS): "routes/summarize.py 생성 — POST /api/summarize" — 2일 전
  • TASK-002 (REVIEW): "pytest 5/5 pass" — 3일 전
  • TASK-001 (DONE): "DB 스키마 완료" — 4일 전
```

### 1-4. PM 피드백 확인

`check_feedback`으로 중간에 온 PM 피드백을 확인합니다:

```
💬 미확인 PM 피드백: {n}건
  • TASK-003: "파서 구현내용 설명해줄래?" — 1일 전
```

### 1-5. 컨텍스트 종합 브리핑

수집한 모든 정보를 종합해서 사용자에게 브리핑합니다:

```
📍 컨텍스트 복원 완료
━━━━━━━━━━━━━━━━━━━

  📄 PRD: {프로젝트 한 줄 요약}
  📊 진행률: {done}/{total} ({percent}%)
  📝 마지막 작업: {최근 활동 요약}
  💬 미확인 피드백: {n}건
  📖 메모리: {주요 결정사항/패턴 요약}

  ⏱️ 마지막 작업일: {last_activity_date}
```

---

## Phase 2: 상황 진단 + 다음 행동 결정

현재 상태를 분석해서 사용자에게 선택지를 제시합니다:

### 케이스 A: 순조롭게 진행 중 (FAILED/BLOCKED 없음)

```
💡 현재 상황: 순조로움
━━━━━━━━━━━━━━━━━━━━

  바로 할 수 있는 것:
  1. 📋 REVIEW {n}개 처리 → /tf-review  (처리하면 다음 태스크 풀림)
  2. 🔧 IN_PROGRESS 이어서 작업 → 바로 코딩 시작
  3. 📋 TODO에서 새 태스크 시작 → /tf-work

  어떻게 할까요?
```

### 케이스 B: 문제 있음 (FAILED/BLOCKED 존재)

```
⚠️ 현재 상황: 문제 있음
━━━━━━━━━━━━━━━━━━━━━

  ❌ FAILED: TASK-006 — "port already in use"
  🚫 BLOCKED: TASK-007 — TASK-006 완료 대기

  추천:
  1. 문제 먼저 해결 → /tf-fix
  2. 문제 태스크 건너뛰고 다른 작업 진행
  3. 문제 태스크 취소 → /tf-fix (삭제)
```

### 케이스 C: 계획 재점검 필요

아래 경우 계획 재점검을 제안합니다:
- 전체 진행률이 50% 이상인데 남은 TODO가 비현실적
- FAILED가 3개 이상
- PM 피드백에 방향 전환 지시가 있음
- 사용자가 "계획 다시 보자"고 요청

```
🔄 계획 재점검 추천
━━━━━━━━━━━━━━━━━

  현재 PRD 대비 진행 상태:
  • 핵심 기능 A: ✅ 완료
  • 핵심 기능 B: 🔄 50% (TASK-003 진행 중)
  • 핵심 기능 C: 📋 미시작 (TASK-005, 006, 007)

  선택지:
  1. 이대로 계속 진행
  2. 계획 수정 (태스크 추가/삭제/재우선순위) → Phase 3로
  3. 처음부터 다시 계획 → /tf-plan
```

---

## Phase 3: 계획 재점검 + 수정

사용자가 계획 수정을 선택했거나, 상황 진단에서 재점검이 필요한 경우.

### 3-1. PRD 대비 현 상태 매핑

PRD의 핵심 기능 목록과 현재 태스크를 매핑합니다:

```
📋 PRD 대비 현재 상태:
━━━━━━━━━━━━━━━━━━━━

  핵심 기능 1: DB 스키마 설계
  → TASK-001 ✅ DONE

  핵심 기능 2: 유저 API + 인증
  → TASK-002 ✅ DONE
  → TASK-003 🔄 IN_PROGRESS (50%)

  핵심 기능 3: AI 요약
  → TASK-004 📋 TODO
  → TASK-005 📋 TODO

  핵심 기능 4: 프론트엔드 UI
  → ⚠️ 태스크 없음! PRD에는 있는데 태스크로 분해되지 않음

  PRD에 없는 태스크:
  → TASK-006: Docker 설정 (FAILED) — PRD 범위 밖?
```

### 3-2. 기존 태스크 정리

각 남은 태스크에 대해 사용자 결정:

```
📋 남은 태스크 재평가:
  1. TASK-004: AI 요약 API (TODO, priority: 3) → [유지 / 수정 / 삭제]
  2. TASK-005: 요약 프롬프트 (TODO, priority: 3) → [유지 / 수정 / 삭제]
  3. TASK-006: Docker 설정 (FAILED)            → [재시도 / 삭제]
```

사용자 결정에 따라:
- **유지**: 그대로 둠
- **수정**: priority, description, scope 변경 (PATCH API 호출)
- **삭제**: `curl -X DELETE http://localhost:8001/api/tasks/{id}` 호출
- **재시도**: `update_task_status` → TODO(retry)

### 3-3. 새 태스크 추가

PRD에 있지만 태스크가 없는 기능, 또는 새로 필요한 작업:

```
📌 추가할 태스크:
  NEW-1: 메인 화면 UI (frontend, priority: 4, depends_on: TASK-003)
  NEW-2: 에러 페이지 (frontend, priority: 2)
  NEW-3: E2E 테스트 (test, priority: 2, depends_on: NEW-1)

  create_tasks_bulk로 일괄 생성할까요?
```

**반드시 `create_tasks_bulk` 한 번 호출로 일괄 생성합니다.** (개별 TaskCreate 금지)

### 3-4. 수정된 계획 확인

```
🔄 계획 수정 결과:
━━━━━━━━━━━━━━━━

  삭제: 1개 (TASK-006)
  수정: 1개 (TASK-004: priority 3→5)
  추가: 3개 (NEW-1, NEW-2, NEW-3)
  유지: 2개

  전체 남은 태스크: {n}개
  예상 진행 순서:
  1. TASK-003 (IN_PROGRESS) → 이어서 진행
  2. TASK-004 (TODO, priority: 5) → 다음
  3. NEW-1 (TODO, depends_on: TASK-003) → TASK-003 완료 후
  ...

  이대로 진행할까요?
```

---

## Phase 4: 작업 재개

계획이 확정되면 실제 작업을 시작합니다:

1. `add_activity`로 "▶️ 작업 재개 — [재개 요약]" 기록
2. 우선순위에 따라 작업 시작:
   - PM 피드백 있으면 → 먼저 확인/답변 (`/tf-feedback`)
   - REVIEW 있으면 → 리뷰 처리 (다음 태스크 풀림)
   - IN_PROGRESS 있으면 → 이어서 코딩
   - TODO만 있으면 → `claim_task` → 새 작업 시작
3. 이전 작업물(코드, 파일) 확인 후 이어서 진행
4. 완료 시 `submit_for_review`

---

## 새 세션 컨텍스트 복원 원리

Claude Code를 새로 열면 이전 대화가 없습니다. 이 스킬이 복원하는 것:

| 소스 | 복원하는 정보 |
|------|-------------|
| `docs/PRD.md` | 프로젝트 전체 목표, 기능 목록, 기술 스택 |
| `CLAUDE.md` | 프로젝트별 규칙, 관례 |
| `.claude/.../memory/` | 이전 세션에서 학습한 패턴, 결정사항, 디버깅 경험 |
| 사용자 지정 문서 | 아키텍처 문서, 노트 등 추가 맥락 |
| `get_all_tasks` | 전체 프로젝트 상태 (뭐가 끝났고 뭐가 남았는지) |
| `get_task_activities` | 어디까지 했는지 (마지막 작업 내용) |
| `check_feedback` | 중간에 온 PM 지시사항 |
| scope 필드 | 어떤 파일을 수정하고 있었는지 |
| depends_on | 다음에 풀리는 태스크가 뭔지 |

> **TaskForce 태스크 + PRD + 메모리 = 프로젝트의 완전한 기억.**
> 대화가 리셋되어도, 세션이 바뀌어도, 이 세 가지가 컨텍스트를 유지합니다.
