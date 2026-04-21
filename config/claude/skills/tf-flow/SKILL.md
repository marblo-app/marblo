---
name: tf-flow
description: 에이전트 파이프라인 플로우를 설계하고 생성합니다. 노드 기반 워크플로 자동화.
allowed-tools: Bash, Read, Glob, Grep
---

# Marblo 플로우 설계

> 에이전트 파이프라인을 플로우 그래프로 설계합니다.
> 코드 생성 → 리뷰 → 테스트 → 배포 같은 자동화 워크플로를 구축합니다.

---

## 필수 규칙: Marblo MCP 전용

> **절대 Claude Code 내장 도구(TaskCreate, TaskList, TaskUpdate, TaskGet)를 사용하지 마세요.**
> 플로우 관리는 반드시 **Marblo MCP 도구**를 사용합니다:
> `create_flow`, `get_flows`, `update_flow`
> 태스크 조회: `get_all_tasks`, `get_available_tasks`

---

## 플로우란?

플로우는 노드(작업 단위)와 엣지(연결)로 구성된 파이프라인입니다.

```
[Input] → [LLM 분석] → [Agent 코딩] → [Branch] →─┬─ [Pass] → [Output]
                                                    └─ [Fail] → [Agent 수정]
```

---

## 노드 타입 (v3 UI 호환)

**반드시 아래 7개 타입만 사용하세요. 다른 타입은 UI에서 인식되지 않습니다.**

| 타입 | 설명 | 색상 | config 필드 |
|------|------|------|------------|
| `input` | 플로우 시작점 (데이터/텍스트 입력) | cyan | `inputType` |
| `llm` | LLM API 호출 | purple | `model`, `temperature`, `maxTokens`, `prompt` |
| `agent` | AI 에이전트 실행 | blue | `agentName`, `role`, `model`, `taskDescription`, `timeout` |
| `api` | 외부 API 호출 | green | `url`, `method`, `headers`, `body` |
| `human` | 사람 승인 게이트 | orange | `approver`, `instructions` |
| `branch` | 조건 분기 | yellow | `condition` |
| `output` | 플로우 종료점 | cyan | (없음) |

### 노드 구조 (FlowNode)

```json
{
  "id": "n1",
  "type": "agent",
  "position": { "x": 250, "y": 120 },
  "data": {
    "label": "백엔드 API 구현",
    "config": {
      "agentName": "backend-auth",
      "role": "backend",
      "model": "claude",
      "taskDescription": "인증 API 엔드포인트 구현",
      "timeout": 30
    }
  }
}
```

### 엣지 구조 (FlowEdge)

```json
{
  "id": "e1",
  "source": "n1",
  "target": "n2"
}
```

### LLM model 옵션

| 모델 ID | 이름 |
|---------|------|
| `claude-opus-4-6` | Opus 4.6 |
| `claude-sonnet-4-6` | Sonnet 4.6 |
| `claude-haiku-4-5` | Haiku 4.5 |
| `gpt-4o` | GPT-4o |
| `gpt-4o-mini` | GPT-4o Mini |
| `o3` | o3 |
| `o4-mini` | o4-mini |
| `gemini-2.5-pro` | Gemini 2.5 Pro |
| `gemini-2.5-flash` | Gemini 2.5 Flash |

### Agent role 옵션

`backend` | `frontend` | `test` | `devops`

### Agent model 옵션 (spawn용)

`claude` | `gemini` | `gpt` | `custom`

---

## Step 1: 요구사항 분석

사용자의 파이프라인 요구를 파악합니다:

```
어떤 플로우를 만들까요?

  예시:
  • "코드 작성 → 테스트 → PR" (CI/CD)
  • "LLM 리뷰 → 사람 승인 → 머지" (코드 리뷰)
  • "분석 → 백엔드/프론트 병렬 → 통합 테스트" (멀티 에이전트)
  • "데이터 수집 → 전처리 → LLM 분석 → 결과 출력" (데이터 파이프라인)
```

---

## Step 2: 플로우 구조 설계

노드와 엣지를 설계하고 사용자에게 보여줍니다:

```
플로우 설계:

  이름: feature-login-flow

  노드:
  ┌─────────────────────────────────────────────┐
  │ n1. [input]   요구사항 입력                  │
  │ n2. [llm]     태스크 분석 (Opus 4.6)        │
  │ n3. [agent]   백엔드 인증 API (backend)      │
  │ n4. [agent]   로그인 폼 UI (frontend)        │ ← n2→n3, n2→n4 병렬
  │ n5. [agent]   통합 테스트 (test)             │ ← n3→n5, n4→n5
  │ n6. [human]   PM 승인                       │
  │ n7. [output]  완료                          │
  └─────────────────────────────────────────────┘

  이 구조로 생성할까요?
```

---

## Step 3: 플로우 생성

확인을 받으면 `create_flow`를 호출합니다:

```
create_flow({
  name: "feature-login-flow",
  project_id: "my-project",
  description: "로그인 기능 구현 파이프라인",
  nodes: "[{\"id\":\"n1\",\"type\":\"input\",\"position\":{\"x\":250,\"y\":0},\"data\":{\"label\":\"요구사항 입력\",\"config\":{\"inputType\":\"text\"}}},{\"id\":\"n2\",\"type\":\"llm\",\"position\":{\"x\":250,\"y\":120},\"data\":{\"label\":\"태스크 분석\",\"config\":{\"model\":\"claude-opus-4-6\",\"temperature\":0.5,\"prompt\":\"요구사항을 분석해주세요\"}}},{\"id\":\"n3\",\"type\":\"agent\",\"position\":{\"x\":80,\"y\":260},\"data\":{\"label\":\"백엔드 인증 API\",\"config\":{\"role\":\"backend\",\"model\":\"claude\"}}},{\"id\":\"n4\",\"type\":\"agent\",\"position\":{\"x\":420,\"y\":260},\"data\":{\"label\":\"로그인 폼 UI\",\"config\":{\"role\":\"frontend\",\"model\":\"claude\"}}},{\"id\":\"n5\",\"type\":\"agent\",\"position\":{\"x\":250,\"y\":400},\"data\":{\"label\":\"통합 테스트\",\"config\":{\"role\":\"test\",\"model\":\"claude\"}}},{\"id\":\"n6\",\"type\":\"human\",\"position\":{\"x\":250,\"y\":530},\"data\":{\"label\":\"PM 승인\",\"config\":{\"approver\":\"PM\"}}},{\"id\":\"n7\",\"type\":\"output\",\"position\":{\"x\":250,\"y\":650},\"data\":{\"label\":\"완료\",\"config\":{}}}]",
  edges: "[{\"id\":\"e1\",\"source\":\"n1\",\"target\":\"n2\"},{\"id\":\"e2\",\"source\":\"n2\",\"target\":\"n3\"},{\"id\":\"e3\",\"source\":\"n2\",\"target\":\"n4\"},{\"id\":\"e4\",\"source\":\"n3\",\"target\":\"n5\"},{\"id\":\"e5\",\"source\":\"n4\",\"target\":\"n5\"},{\"id\":\"e6\",\"source\":\"n5\",\"target\":\"n6\"},{\"id\":\"e7\",\"source\":\"n6\",\"target\":\"n7\"}]"
})
```

**position 배치 가이드:**
- x: 중앙 기준 250, 병렬 노드는 80(좌) / 420(우)
- y: 각 레이어 간격 120~140px
- 시작: y=0, 끝: 마지막 레이어

---

## Step 4: 태스크 연결 (선택)

플로우의 각 노드를 Marblo 태스크와 연결할 수 있습니다:

```
플로우 ↔ 태스크 연결:

  노드 n3 (backend-auth)  → TASK-001
  노드 n4 (frontend-form) → TASK-004
  노드 n5 (integration)   → TASK-009

  태스크의 flowId, flowNodeId가 업데이트됩니다.
```

---

## 플로우 관리

### 현재 플로우 확인
```
/tf-flow status
```
→ `get_flows`로 프로젝트의 모든 플로우 목록 표시

### 플로우 상태 변경
```
/tf-flow run    → 플로우 시작 (draft → running)
/tf-flow pause  → 일시 중지
/tf-flow done   → 완료 처리
```
→ `update_flow`에서 status 필드 변경

---

## 프리셋 플로우 예시

### 1. CI/CD 파이프라인
```
[Input] → [Agent: 코드 생성] → [API: 린트] → [Agent: 테스트]
  → [Branch: 통과?] → Pass: [Agent: PR 생성] → [Output]
                    → Fail: [Agent: 수정] → (코드 생성으로 돌아감)
```

### 2. 코드 리뷰
```
[Input: PR/Diff] → [LLM: AI 리뷰] → [Branch: 이슈?]
  → 없음: [Human: PM 승인] → [Output]
  → 있음: [Agent: 수정 제안] → [Output]
```

### 3. 멀티 에이전트 협업
```
[Input] → [LLM: 분석] →─┬─ [Agent: Backend]  ─┐
                         └─ [Agent: Frontend] ─┤
                           [Agent: 통합 테스트] ←┘
                           → [Human: PM 확인] → [Output]
```

---

## 주의사항

- **노드 타입은 7개만 허용**: `input`, `llm`, `agent`, `api`, `human`, `branch`, `output`
- 노드 ID는 `n1`, `n2` 등 고유하게 지정
- 엣지 ID는 `e1`, `e2` 등 고유하게 지정
- 순환 의존성 주의 (의도적 루프는 branch → 이전 노드로만)
- 태스크와 연결하면 칸반 보드에서 Flow 뱃지 표시
- v3 앱의 Flows 탭에서 시각적으로 편집 가능
