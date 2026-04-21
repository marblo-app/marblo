---
name: tf-spawn
description: 물리적 에이전트를 스폰합니다. Electron 터미널 탭에 독립 PTY 세션으로 생성됩니다.
allowed-tools: Bash, Read, Glob, Grep
---

# Marblo 물리 에이전트 스폰

> Electron 앱의 독립 터미널 탭에서 실행되는 물리적 에이전트를 스폰합니다.
> 각 에이전트는 자신만의 PTY 세션, MCP 연동, 칸반 보드 추적을 갖습니다.

---

## ⛔ 필수 규칙: Marblo MCP 전용

> **절대 Claude Code 내장 도구(TeamCreate, Task)를 사용하지 마세요.**
> 에이전트 스폰은 반드시 **Marblo MCP의 `spawn_agent`** 도구를 사용합니다.
> 태스크 조회는 `get_all_tasks`, `get_available_tasks`를 사용합니다.

---

## /tf-spawn vs /tf-agent 차이

| | /tf-spawn (이 명령어) | /tf-agent |
|--|----------------------|-----------|
| 실행 위치 | Electron 독립 터미널 탭 | Claude Code 내부 서브에이전트 |
| PTY 세션 | 독립 PTY (agent-{id}) | 없음 (논리적) |
| 칸반 연동 | 카드 클릭 → 터미널 연결 | 없음 |
| 모델 선택 | Claude, Gemini, GPT, Custom | Claude만 |
| 용도 | 장시간 독립 코딩 작업 | 빠른 조사/탐색 |

---

## Step 1: 태스크 확인

`get_available_tasks`로 스폰할 에이전트가 처리할 태스크를 확인합니다.

```
📋 Available 태스크:
   backend: 3개 (TASK-001, TASK-003, TASK-007)
   frontend: 2개 (TASK-004, TASK-005)
   test: 1개 (TASK-009)
```

---

## Step 2: 에이전트 라인업 제안

태스크 수와 역할에 따라 에이전트 구성을 제안합니다:

```
🤖 에이전트 라인업 제안:
━━━━━━━━━━━━━━━━━━━━━━━

  1. 🟣 backend-auth   (claude)  → TASK-001, TASK-003
  2. 🔵 frontend-ui    (gemini)  → TASK-004, TASK-005
  3. 🟢 backend-api    (gpt)     → TASK-007

  총 3개 에이전트. 진행할까요?
```

### 규모별 가이드

| 태스크 수 | 에이전트 수 | 전략 |
|----------|-----------|------|
| 1-2개 | 1개 | 단일 에이전트 |
| 3-5개 | 2-3개 | 역할별 분할 |
| 6개+ | 3-5개 | 역할별 분할 + 의존성 순서 |

### 제약
- 한 번에 최대 **5개** 에이전트
- 같은 role은 최대 **2개**

---

## Step 3: 사용자 확인 후 스폰

확인을 받으면 `spawn_agent`를 호출합니다:

```
spawn_agent({
  name: "backend-auth",
  model: "claude",
  role: "backend",
  initial_prompt: "너는 backend 에이전트다.\n1. get_agent_skill('backend') 호출하여 스킬 파일 숙지\n2. get_available_tasks('backend') 호출하여 태스크 확인\n3. 첫 번째 태스크를 claim하고 작업 시작\n4. 완료 후 다음 태스크 진행"
})
```

각 에이전트가 스폰되면:
1. Electron에 새 터미널 탭이 열림
2. 에이전트가 자동으로 스킬 파일 로드 → 태스크 claim → 코딩 시작
3. 칸반 보드에서 진행 상황 실시간 추적 가능
4. 칸반 카드 클릭 시 해당 에이전트의 터미널로 이동

---

## Step 4: 스폰 결과 확인

```
✅ 에이전트 스폰 완료:
━━━━━━━━━━━━━━━━━━━━

  🟣 backend-auth   → 터미널 탭 #3 (실행 중)
  🔵 frontend-ui    → 터미널 탭 #4 (실행 중)
  🟢 backend-api    → 터미널 탭 #5 (실행 중)

  💡 칸반 보드에서 진행 상황을 확인하세요.
  💡 에이전트 카드를 클릭하면 터미널로 이동합니다.
```

---

## 인자로 직접 지정

```
/tf-spawn claude backend backend-auth
/tf-spawn gemini frontend frontend-ui
```

인자가 있으면 확인 단계를 건너뛰고 바로 스폰합니다.
