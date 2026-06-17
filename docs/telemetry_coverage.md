# Telemetry Coverage & Moat 자문자답

작성일: 2026-05-06
대상 커밋: `a0ba44b` (Telemetry — fill spawn prompt meta + task_outcome model/cost)

이 문서는 **현재 시점에 어떤 신호가 어디까지 흐르는지**, 그리고 **에이전트 추천 등 모트 기능 구현 관점에서 충분한지**를 한 페이지에 모은 스냅샷이다. 추가 구현 결정용이 아니라 현황 점검용.

---

## 1. 데이터 파이프라인 한눈에 보기

```
┌────────────────────┐    ┌──────────────┐    ┌──────────────────┐
│ electron/main      │───▶│ IPC events    │───▶│ renderer service │
│ - agent-manager    │    │ telemetry:*   │    │ - telemetryService│
│ - cost-tracker     │    │ cost:update   │    │ - useCostWriter   │
│ - audit wrapper    │    │ etc.          │    │ - taskService     │
└────────────────────┘    └──────────────┘    └────────┬─────────┘
                                                       │
                  ┌────────────────────────────────────┼────────────────────────────────────┐
                  ▼                                    ▼                                    ▼
        ┌──────────────────┐                ┌──────────────────┐                ┌──────────────────┐
        │ Firestore        │                │ Firebase Cloud   │                │ 로컬 파일         │
        │ (live)           │                │ Functions        │                │ ~/.marblo/        │
        │ - agents/        │                │ - logTelemetry   │                │ - app-state.json  │
        │ - tasks/         │                │ - logCost        │                │ - api-keys.json   │
        │ - activities/    │                │ - logHeartbeat   │                │                   │
        │ - audit_logs/    │                │ - logTaskOutcome │                │ ~/.claude/        │
        │ - flow_runs/     │                │ - logFlow        │                │ - sessions JSONL  │
        └──────────────────┘                └────────┬─────────┘                └──────────────────┘
                                                     ▼
                                          ┌──────────────────┐
                                          │ BigQuery         │
                                          │ marblo_telemetry │
                                          │ - events         │
                                          │ - cost_logs      │
                                          │ - agent_heartbeats│
                                          │ - task_outcomes  │
                                          │ - flow_executions│
                                          └──────────────────┘
```

스위치 (2026-06-17 갱신 — 로컬 온리 정합):

- **디폴트 OFF.** 1차 텔레메트리(Firebase Functions→BigQuery + useCostWriter 의 Firestore cost roll-up + taskService task_outcome)는 **기본적으로 외부 송신하지 않는다.** 6/23 빌드는 로컬 온리(PIPA — 명시 옵트인 없이 분석 데이터가 기기를 떠나지 않음).
- 켜는 법: 빌드플래그 `VITE_FIRST_PARTY_TELEMETRY=1`(내부/도그푸드 빌드) 또는 런타임 인앱 동의 후 `setTelemetryEnabled(true)`(dev8 옵트인 토글).
- `VITE_DISABLE_TELEMETRY=1` 은 모든 경로를 덮는 하드 kill-switch(빌드플래그보다 우선).
- 정책 단일 진실원: `v3/src/lib/telemetry/firstPartyGate.ts`.
- 3rd-party(Sentry/GA4)는 이전부터 옵트인(`maybeInit*(consented)`, 기본 동의 all-false) — 동일 정책.
- 로컬 JSONL(`~/.claude` 세션파일, main-process cost-tracker 로컬 read)은 외부 송신이 아니므로 게이트와 무관하게 유지(동의 불필요).

---

## 2. 어디까지 와있나 — 신호별 매트릭스

### ✅ End-to-end (BigQuery까지 흐름)

| 신호                                           | 발화 지점                                               | Firestore                         | BigQuery 테이블                  | 비고                                                                     |
| ---------------------------------------------- | ------------------------------------------------------- | --------------------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| `agent:spawned`                                | `agent-manager.ts:323-340` (mainTelemetry.agentSpawned) | `agents/<id>` upsert (Layout.tsx) | `events`                         | promptHash + promptLength 포함 (커밋 a0ba44b)                            |
| `agent:stopped`                                | `agent-manager.ts` exit handler                         | —                                 | `events`                         | exitCode, success                                                        |
| `agent:crashed`                                | `agent-manager.ts` max-restart handler                  | —                                 | `events`                         | exitCode                                                                 |
| `agent:restarted`                              | `agent-manager.ts` restart loop                         | —                                 | `events`                         | attempt 메타                                                             |
| `agent:heartbeat`                              | 30초 타이머                                             | —                                 | `agent_heartbeats` (별도 테이블) | tokensAccumulated, costAccumulated                                       |
| `cost:update` (per-message)                    | 메인 cost-tracker JSONL polling                         | `agents/<id>` increment           | `cost_logs`                      | inputTokens, outputTokens, cacheRead/Write, totalCost, taskId, sessionId |
| `task:created`                                 | `taskService.createTask`                                | `tasks/<id>` create               | `events`                         | role, priority                                                           |
| `task:status_changed`                          | `taskService.updateTaskStatus`                          | `tasks/<id>` update               | `events`                         | fromStatus, toStatus, agentId                                            |
| `task:completed`                               | `taskService.updateTaskStatus(DONE)`                    | `tasks/<id>`                      | `events` + `task_outcomes`       | model, totalCost, totalInput/Output 포함 (커밋 a0ba44b)                  |
| `flow:started` / `node_executed` / `completed` | `useFlowExecution`                                      | —                                 | `events` + `flow_executions`     | nodeType, durationMs, success                                            |
| MCP 도구 호출 (모든 종류)                      | `mcp-server/tools.ts` auditedTool 래퍼                  | `audit_logs/<id>`                 | —                                | toolName, params(<200), result(<500), duration, success                  |
| `chat:message_sent`                            | `chatService.sendMessage`                               | `chats/.../messages`              | `events`                         | type, senderId                                                           |

### ⚠️ Firestore에만 (BigQuery 미연결)

| 신호                  | 위치                                  | 의미                                                                  |
| --------------------- | ------------------------------------- | --------------------------------------------------------------------- |
| `add_activity` (수동) | MCP 도구 호출 시 `activities/` 컬렉션 | UI 활동 피드용. 자동 호출 없음 — 에이전트가 명시적으로 부를 때만 기록 |
| Agents Tab 라이브 뷰  | `agents/<id>.totalCost` 등            | 실시간 누적값. cost_logs와 별도                                       |

### ❌ 아직 안 채우는 것

| 신호                                        | 이유                                                                                    |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| `agent:fast_fail` 명시 이벤트               | exitCode + restart attempt로만 추정. fast-fail vs runtime crash 구분 불가               |
| `parentAgentId` (events.parentAgentId 컬럼) | 스키마는 있는데 spawn 시 부모 정보 안 넘김 → 에이전트 트리 재구성 불가                  |
| `retryOf` (events.retryOf 컬럼)             | 현재 retriesCount만 0으로 박힘                                                          |
| 자동 activity (claim/done → activities)     | audit_logs에 있으니 중복이긴 하지만 UI 피드는 비어있음                                  |
| Per-task cost delta                         | task_outcomes.totalCost는 누적값이라 task별 정확 비용 불가 (cost_logs.taskId join 필요) |
| `task.taskType` 분류                        | 현재 null. priority만 complexity proxy로 사용                                           |
| `errorCategory` / `errorMessage`            | exit 시 채워지지 않음 — 실패 원인 분석 불가                                             |

---

## 3. 모트 자문자답

### Q1. "추천 모델"을 만들기 위해 필요한 최소 4-tuple은?

**A.** `(prompt-shape, model, role, outcome)` — 어떤 종류의 prompt에 어떤 모델이 어떤 역할로 어떤 결과를 냈는지.

- prompt-shape → `events.promptHash` ✅ + `promptLength` ✅
- model → `events.model` ✅ + `task_outcomes.model`(detectedModelId 포함) ✅
- role → `events.role` ✅ + `task_outcomes.role` ✅
- outcome → `task_outcomes.success` ✅ + `durationMs` ✅ + `totalCost` ✅

→ **최소 학습 데이터셋은 갖춤.** 다만 prompt-shape가 hash라 의미적 클러스터링은 임베딩 별도 필요 (raw 저장 안 하므로).

### Q2. "이 작업엔 평균 얼마 든다"를 정확히 답할 수 있나?

**A.** 부분적으로. `cost_logs`는 `taskId`를 들고 있어서 `SUM(totalCost) WHERE taskId = X`가 가능 — **단, useCostWriter가 cost:update IPC에서 taskId를 받아 적재해야 함.** 현재 `data.taskId`가 main process cost-tracker에서 채워지는지는 별도 검증 필요. task_outcomes 자체는 누적값이라 부정확.

→ **"평균 비용" 추정은 가능하나 cost_logs.taskId 채워짐을 검증 필요.** 모자라면 claim 시점에 `agents/<id>.totalCost`를 task에 스냅샷 떠두는 한 단계 보강이 깔끔.

### Q3. "이 모델은 spawn에서 자주 죽는다" 같은 신뢰성 시그널 가능한가?

**A.** 거의 가능하지만 정확도 떨어짐. `agent:stopped` + `agent:crashed`로 실패율 집계는 됨. 그런데 fast-fail(설정 오류) vs runtime crash(실제 사용 중 실패) 구분이 안 돼 — 둘 다 노이즈로 묶여 들어감.

→ **`agent:fast_fail` 분리 이벤트가 필요. 우선순위 P2.**

### Q4. 에이전트 트리 (오케스트레이터 → 자식 → 손자) 재구성 가능한가?

**A.** 안 됨. `parentAgentId` 컬럼은 스키마에 있지만 채우지 않음. 트리 없이는 "이 오케스트레이터 패턴이 어떤 자식을 잘 spawn하나" 분석 불가.

→ **`bridge-server.ts`의 `agentSpawnedHook` 페이로드에 parentAgentId 이미 흐름. 단지 mainTelemetry에 안 넘기는 것뿐. 한 줄 보강이면 끝. 우선순위 P2.**

### Q5. 사용자가 어떤 프로젝트에서 어떤 워크플로우를 반복하는가?

**A.** 부분적. `events`에 `projectId` 다 들어감, `flow:*` 이벤트로 플로우 실행 패턴은 추적 가능. 다만 "이 사용자는 매번 코드리뷰 → 배포 패턴" 같은 시퀀스 마이닝은 raw 이벤트에서 직접 도출 가능하니 데이터는 충분.

→ **데이터는 있음.** 분석 레이어만 필요.

### Q6. 모델 / role / project별 비용 대시보드 만들 수 있나?

**A.** 가능. `cost_logs`에 model + projectId + agentId + (taskId) 다 있음. 시간축은 timestamp. AgentDashboard.tsx의 UsageDashboard가 이미 부분적으로 함.

→ **데이터는 충분, 시각화 더 필요하면 별도 작업.**

### Q7. 추천 엔진을 만든다면 모자란 게 뭔가?

**A.** 우선순위 순:

1. **`parentAgentId`** — 트리 없이는 멀티 에이전트 패턴 학습 불가. 1줄 작업.
2. **`agent:fast_fail` 분리 이벤트** — 신뢰성 시그널 노이즈 제거.
3. **per-task cost delta** — claim 시점 cost 스냅샷. 정확한 작업당 비용용.
4. **`taskType` 분류기** — 현재 null. task title/description에서 LLM 추출 또는 사용자가 직접 태그.
5. **prompt embedding** — hash로는 동일 prompt만 매칭. 의미 클러스터는 별도 임베딩 모델 필요 (BigQuery ML 또는 Vertex AI).

### Q8. 지금 데이터로 당장 뭘 만들 수 있나?

- 사용자별 / 프로젝트별 월별 비용 대시보드 ✅
- 모델 × role 평균 task 완료 시간 / 성공률 ✅
- "이 사용자는 주로 backend role을 어떤 모델로 굴리나" 빈도 분석 ✅
- 동일 promptHash가 다른 모델에서 어떻게 결과가 다른지 (raw prompt 없이 hit 케이스만) ⚠️ 제한적
- 시간대별 활성 에이전트 추이 (heartbeat) ✅

---

## 4. 결정 / 다음 단계

지금 시점 결론:

- **출시 전 모트 데이터 베이스라인은 합격.** 학습용 4-tuple 갖춰짐.
- **출시 후 1순위 보강은 `parentAgentId` 1줄 + `agent:fast_fail` 분리.** 그 다음 per-task cost delta.
- 에이전트 트리 + 신뢰성 분리 시그널이 들어오면 "이 패턴은 이 모델 조합이 잘 한다" 추천이 나오기 시작.

추가 구현 시점은 사용자 데이터 모이기 시작한 뒤 — N 사용자 / M task 도달하면 보강 결정.

---

## 5. 관련 코드 포인터

- 메인 텔레메트리 송신: `v3/electron/telemetry.ts`
- 에이전트 라이프사이클 호출: `v3/electron/agent-manager.ts:323-340` (spawn), 같은 파일 exit/restart/crash 핸들러
- 비용 트래킹: `v3/electron/cost-tracker.ts` → `v3/src/hooks/useCostWriter.ts`
- IPC 브릿지 (main → renderer): `v3/src/App.tsx:178-190`
- 큐 + Cloud Function 호출: `v3/src/services/telemetryService.ts`
- 태스크 outcome: `v3/src/services/taskService.ts:120-180`
- Cloud Functions 정의: `v3/functions/src/index.ts:693+` (events), `:803+` (cost), `:874+` (taskOutcome), `:917+` (heartbeat), `:954+` (flow)
- BigQuery 데이터셋: `marblo_telemetry` (auto-create on first insert)
