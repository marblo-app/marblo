---
name: tf-on
description: TaskForce 상시 모드 ON. 이후 모든 작업이 자동으로 태스크포스 티켓을 거칩니다.
disable-model-invocation: true
allowed-tools: Bash, Read, Glob, Grep, Write, Edit
argument-hint: [프로젝트명]
---

# TaskForce 상시 모드 활성화

> **이 스킬을 실행하면 상태 파일을 생성하고, 이후 매 프롬프트마다 Hook이 자동으로 TaskForce 규칙을 주입합니다.**
> 1회 주입이 아니라, Hook이 매번 강제하므로 컨텍스트가 길어져도 잊지 않습니다.

---

## ⛔ 필수 규칙: TaskForce MCP 전용

> **절대 Claude Code 내장 도구(TaskCreate, TaskList, TaskUpdate, TaskGet)를 사용하지 마세요.**
> 모든 태스크 관련 작업은 반드시 **TaskForce MCP 도구**를 사용합니다:
> `get_all_tasks`, `get_available_tasks`, `claim_task`, `update_task_status`,
> `add_activity`, `submit_for_review`, `create_task`, `create_tasks_bulk`,
> `check_feedback`, `acknowledge_feedback`

---

## Step 1: 프로젝트 확인

1. 사용자가 프로젝트명을 지정했으면 해당 프로젝트 사용.
   지정하지 않았으면 `get_all_tasks`로 현재 활성 프로젝트 목록을 보여주고 선택하게 합니다.

2. 선택된 프로젝트의 전체 태스크를 조회하고 간략히 보여줍니다.

---

## Step 2: 상태 파일 생성

Bash로 다음을 실행합니다:

```bash
echo '{"project":"PROJECT_NAME"}' > ~/.claude/taskforce-mode.json
```

(PROJECT_NAME은 실제 프로젝트명으로 치환)

---

## Step 3: 활성화 확인

```
🔛 TaskForce 상시 모드 — {project_name}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  📊 현재 상태:
  ✅ DONE: {n}개  🔄 IN_PROGRESS: {n}개  👀 REVIEW: {n}개
  📋 TODO: {n}개  ❌ FAILED: {n}개

  🔛 상시 모드 활성화 완료
  → 상태 파일: ~/.claude/taskforce-mode.json
  → 매 프롬프트마다 Hook이 자동으로 TaskForce 규칙을 주입합니다.
  → 해제: /tf-off 또는 "상시 모드 꺼줘"
```

---

## Step 4: 상시 모드 규칙

**아래 규칙은 Hook이 매 프롬프트마다 주입하므로 자동 적용됩니다.**

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

---

## 비활성화 (/tf-off)

사용자가 `/tf-off` 또는 "상시 모드 꺼줘"를 말하면:

```bash
rm -f ~/.claude/taskforce-mode.json
```

```
🔴 TaskForce 상시 모드 OFF
  상태 파일 삭제됨. 다음 프롬프트부터 일반 리마인더만 동작합니다.
```
