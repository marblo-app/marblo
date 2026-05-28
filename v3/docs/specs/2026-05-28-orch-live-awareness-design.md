# Orchestrator Live Awareness — Design v0.1

> 2026-05-28 · 작성: brainstorming 세션 (john.kim@hypemarc.com + Claude)
> 상태: spec, 사용자 승인 후 구현 계획서(`writing-plans`)로 진입

## 1. 문제 정의

워커 에이전트들이 작업하는 동안 오케스트레이터는 **종료 시점에만** 워커 결과를 받는다 (`submit_for_review` → bridge → orch PTY 주입, commit `9d781bf`). 중간 분기에는 깜깜이라:

- 사용자가 "지금 어떻게 돼?" 물으면 orch가 모름
- 워커가 갈림길에서 자체 추측으로 진행 → 사용자 의도와 어긋남
- 막힘이 발생해도 orch가 모르고 사용자도 모름

목표: **오케스트레이터가 상시 상황을 인지하고, 필요할 때 사용자에게 능동적으로 질문/보고하는 흐름**.

## 2. 아키텍처 원리 — 2-layer

```
┌─────────────────────────────────────────────────────────────┐
│  Layer A — Projection (LLM-free, 항상 최신)                 │
│  Firestore: tasks/{tid}/projection, missions/{mid}/projection│
│  매 MCP 호출마다 lightweight 필드 갱신                      │
│  orch가 "지금 어때?" 묻으면 read 한 번으로 즉답             │
└─────────────────────────────────────────────────────────────┘
                            ▲
                            │ get_projection() on demand
                            │
┌─────────────────────────────────────────────────────────────┐
│  Layer B — Wake notify (LLM in-the-loop, 선별적)            │
│  Bridge buffer → orch PTY stdin                             │
│  HIGH(blocker/failed/request_decision): 즉시 flush          │
│  LOW(claim/in_progress/milestone): idle 감지 후 batch       │
└─────────────────────────────────────────────────────────────┘
```

**왜 2-layer인가:**

- 모든 이벤트로 orch LLM을 깨우면 토큰 폭주 (5워커 × 분기 3개/태스크 = 분당 수십 wake)
- 모든 이벤트를 orch에 안 알리면 사용자 질의 시 orch가 모름
- → A는 "사실 저장소", B는 "주의 환기" 로 분리

**기존 자산 재활용:**

- `submit_for_review → orch PTY inject` 패턴(`9d781bf`)을 일반화
- agent-manager의 PTY-activity 기반 idle 감지(`ab33172`) 활용
- `pending_instructions` 채널(워커 PTY 역방향 주입)을 decision 응답 라우팅에 그대로 사용
- 워커 dispatch footer (`[완료 규약]`)에 한 줄만 추가

## 3. 컴포넌트별 변경 위치

| 위치 | 변경 | 신규? |
|---|---|---|
| `v3/mcp-server/tools.ts` | `add_activity`/`update_task_status`/`submit_for_review`/`claim_task` 호출 직후 (a) projection 갱신, (b) wake-worthy면 bridge로 notify 송출 | 수정 |
| `v3/mcp-server/tools.ts` | `request_decision(task_id, question, options[])` 신규 — Firestore `decisions/` doc 생성 + 워커 PTY에 "응답을 기다립니다" 출력 + blocking | 신규 |
| `v3/electron/bridge-server.ts` | `submit_for_review → orch PTY inject` 패턴 일반화 → `injectNotify(orchPtyId, event)`. priority 분기 + buffer 연동 | 수정 |
| `v3/electron/notify-buffer.ts` | LOW 이벤트 메모리 buffer, idle 전환 시 한 줄로 batch flush. 디스크 영속 X (orch 죽으면 projection으로 복구) | 신규 |
| `v3/electron/orchestrator-manager.ts` | orch PTY idle/working 상태 노출 (agent-manager가 이미 판정). bridge가 폴링 | 작은 수정 |
| `v3/skills/{backend,frontend,devops,test}_agent.md` | `request_decision` 사용 룰 추가 | 작은 수정 |
| `v3/skills/orchestrator_agent.md` | `[marblo:notify ...]` 태그 인식 + 대응 패턴 섹션 신규 (6번 섹션) | 수정 |
| `v3/src/components/missions/MissionTimeline.tsx` | `request_decision` 진행 중 노드 표시 (인프라 기존 사용) | 작은 수정 |

신규 파일은 `notify-buffer.ts` 하나, 신규 Firestore 컬렉션은 `notifyEvents`(idempotency 보관)와 `decisions/`.

## 4. 이벤트 스키마

```ts
type NotifyEvent = {
  eventId: string;        // ULID, idempotency
  taskId: string;
  missionId?: string;
  workerAgentId: string;
  type: 'task.claimed' | 'task.blocked' | 'task.failed'
      | 'task.milestone' | 'decision.requested';
  priority: 'high' | 'low';
  summary: string;        // 한 줄 사람 읽기용
  payload?: Record<string, unknown>;
  createdAt: Timestamp;
  deliveredAt?: Timestamp;
};

type DecisionRequest = {
  decisionId: string;     // ULID
  taskId: string;
  workerAgentId: string;
  question: string;
  options: { id: string; label: string; description?: string }[];
  createdAt: Timestamp;
  resolvedAt?: Timestamp;
  chosenOptionId?: string;
  rationale?: string;
};
```

**Orch PTY 주입 포맷 (한 줄):**

```
[marblo:notify id=01J... task=abc123 type=task.blocked from=backend-claude-3]
  "DB 마이그레이션 충돌 — 0042 슬롯이 main에 이미 있음"
```

**LOW batch 형식:**

```
[marblo:notify-batch since=10:23:14 count=3]
  • task=abc123 type=task.claimed   "frontend-codex-1 claimed FE-12"
  • task=def456 type=task.milestone "backend-claude-3 submitted for review"
  • task=ghi789 type=task.claimed   "test-gemini-2 claimed QA-5"
```

## 5. Wake 정책 매트릭스

| 트리거 MCP 호출 | event type | priority | UI 영향 |
|---|---|---|---|
| `claim_task` | `task.claimed` | low | timeline node |
| `update_task_status(→blocked)` | `task.blocked` | **high** | timeline 빨강 |
| `update_task_status(→failed)` | `task.failed` | **high** | timeline 빨강 |
| `update_task_status(→in_progress)` | (projection만) | — | — |
| `submit_for_review` | `task.milestone` | **high** | timeline 노랑 |
| `add_activity` | (projection만) | — | timeline tick |
| `request_decision` | `decision.requested` | **high** | timeline + 워커 blocking |

`add_activity`와 in_progress 전환은 **PTY 안 깨움**, projection만 갱신. orch는 사용자 질의 시 `get_projection(task_id)` 호출.

## 6. 워커 스킬 변경 — `request_decision` 사용 룰 (최소)

워커 스킬에 단 하나의 새 룰만 추가:

```md
## 결정 분기 — request_decision 사용 규칙

다음 중 하나라도 해당되면 코드 작성을 멈추고 `request_decision` 호출:

1. **스코프 변경** — 티켓에 없던 파일/기능을 새로 만들어야 할 때
2. **사용자 가시 동작 변경** — UX, URL 구조, 응답 포맷이 바뀜
3. **보안/권한** — 인증 흐름, 데이터 노출 범위, 외부 API 키 사용
4. **외부 의존성 추가** — 새 npm 패키지, 새 SaaS 호출
5. **티켓 instruction이 모호해서 둘 이상의 합리적 해석이 가능할 때**

`request_decision(task_id, question, options[])` 호출 후 응답을 기다린다
(MCP 도구가 자동으로 "결정을 기다립니다…" PTY 출력 + blocking).
응답은 pending_instructions 채널로 도착 → 그 지시 따라 작업 재개.

❌ 해당 안 되는 사소한 분기는 워커 스스로 결정 (변수명, 들여쓰기,
helper 함수 추출 여부, 테스트 케이스 수 등). 매번 묻지 말 것.
```

**dispatch footer 갱신** (`bridge-server.ts`): 기존 `[완료 규약]` 옆에 한 줄 추가:

```
[결정 분기 규약] 위 5개 분기 조건 중 하나라도 만나면 작업을 멈추고
request_decision(task_id="<task_id>", ...) 을 호출하라. 응답 도착 전엔 코드를 쓰지 말 것.
```

## 7. Orch 스킬 변경 — Notify Ingestion 섹션

`v3/skills/orchestrator_agent.md`에 새 6번 섹션 추가 ("Mission 진행 룰" 옆자리):

```md
## 6. Live Awareness — notify 처리 룰 (NEW)

### 인입 포맷
워커들이 활동할 때마다 너의 PTY로 다음 태그가 주입된다:

  [marblo:notify id=<ULID> task=<id> type=<event> from=<agent>] <summary>
  [marblo:notify-batch since=<time> count=<n>] <bullets>

### 처리 분기
| type | 너의 행동 |
|---|---|
| task.claimed (batch) | 인지만, 출력 X. 사용자가 묻기 전엔 화면에 안 띄움. |
| task.milestone (batch) | 인지. 같은 미션의 마지막 milestone이면 다음 step dispatch 검토. |
| task.blocked | 즉시 get_task, get_task_activities 조회 → 자동 해결 가능 여부 판단 → 가능하면 새 instruction을 pending_instructions로 push, 불가능하면 사용자에게 한 줄 요약 + 옵션 제시. |
| task.failed | task.blocked와 동일하되 retry 정책(D10) 적용 — retry 횟수 < 2면 동일 워커에 재시도 지시, 초과면 사용자에게 escalate. |
| decision.requested | 즉시 사용자에게 워커가 던진 question + options을 그대로 전달. 사용자 답 → mark_instruction_delivered → 워커 재개. |

### 자동 처리 vs 사용자 escalation 기준
- **자동:** 알려진 패턴(예: "포트 충돌", "node_modules 누락") + 직전 1시간 내 유사 케이스 성공 처리 이력
- **escalation:** 위 5개 분기 조건(스코프/UX/보안/외부 의존성/instruction 모호) 또는 처음 보는 에러

### 토큰 절약
- batch notify는 1-2줄 요약만 머릿속에 두고 다음 입력 대기 — 그 자체로 답하지 않는다.
- 사용자가 "지금 상태?" 물을 때만 get_projection(mission_id=..., task_id=...) 한 번 호출.

### request_decision 응답 형식
워커에게 보낼 결정은 항상:
  mark_instruction_delivered(decision_id, chosen_option, rationale)
워커는 chosen_option + rationale 받고 코드 작성 재개.
```

## 8. 엣지 케이스 & 실패 모드

| 케이스 | 대응 |
|---|---|
| orch PTY가 죽음 | OrchestratorManager 자동 재시작(기존). buffer는 휘발 — 재시작 시 `notifyEvents where deliveredAt IS NULL AND createdAt > now-10m` 재전송 |
| 사용자가 decision 응답을 안 줌 | 30분 후 timeline에 "⚠️ 사용자 응답 대기 중 — 워커 N개 멈춤" 카드. 1시간 후 자동 abandon 옵션 제안 |
| 같은 시각 5개 워커가 blocker emit | bridge가 100ms coalesce 윈도우로 묶어서 batch high notify 한 번 |
| Notify 중복 (Firestore 재전송) | `eventId` ULID로 orch PTY 라인에 포함 → orch 스킬이 직전 본 ID와 동일하면 무시(룰로 명시) |
| Mission 없는 일반 태스크 | task가 mission에 안 묶여있으면 `defaultOrchPtyId`로 라우팅 (전역 orch 한 명). 다중 orch는 별도 트랙 |
| Worker가 request_decision 후 죽음 | pending_instructions의 워커 reconnect 로직(`3f46324`)이 처리. 재첨부 시 결정 응답 다시 inject |
| Bridge가 orch idle 오판 → HIGH 인터럽트 잘못 던짐 | PTY 출력 깨질 수 있음(모델별 다름). 모델별 stdin queue 동작은 PR 단계에서 실측 후 fallback로 "HIGH도 200ms backoff" 옵션 추가 |

## 9. 테스트 & 롤아웃

### 테스트 3계층

1. **단위:** `notify-buffer.ts` (priority routing, batch flush 타이밍), `request_decision` 도구 (Firestore write + blocking output)
2. **통합:** 가짜 워커 PTY가 `update_task_status(blocked)` 호출 → orch PTY에 `[marblo:notify ...]`가 200ms 내 인입되는지
3. **E2E (수동):** 진짜 미션 1개 돌려서 워커가 `request_decision` 던지면 orch가 사용자에게 묻고, 사용자 답이 워커로 돌아가 작업 재개되는지

### 점진 롤아웃 (기능 플래그 X — 컬렉션 분리로 격리)

| 단계 | 범위 | 검증 |
|---|---|---|
| P1 | Projection 레이어만 (Layer A). MCP 도구에 projection 쓰기만 추가. PTY 주입 0. | orch가 "현재 어때?" 물을 때 projection 읽기로 정확히 답하는지 |
| P2 | LOW 이벤트 batch + idle flush. PTY 출력은 보이지만 orch 스킬은 아직 미적용 | 출력만 사람 눈으로 확인, 빈도/품질 측정 |
| P3 | Orch 스킬에 ingestion 섹션 적용. HIGH 이벤트만 (blocked/failed/milestone) | 자동 처리/escalation 분기가 의도대로 |
| P4 | `request_decision` 도구 + 워커 스킬 5개 분기 룰 | 워커가 실제로 stop & ask 하는지, 사용자 답이 라우팅되는지 |

P1→P4 각 단계 사이 1-2일 dogfood. P4 끝나면 미션 D8 룰("개입 최소화")이 실질적으로 구현됨.

## 10. 명시적 비포함 (out-of-scope)

- 다중 orch (여러 orch가 동시 활성). 지금은 단일 전역 orch 가정
- 사용자 응답 30분 이상 미도착 시 자동 의사결정 (위험)
- `request_decision`의 timeout/expire 자동 처리 (P5 별도)
- Antigravity(agy) 특화 처리 — 기본 워커와 동일하게 취급
- 새 UI 컴포넌트 추가 (MissionTimeline의 노드 타입 추가만)

## 11. 참고 commit

- `9d781bf` — submit_for_review → orch PTY inject 패턴 (Layer B의 원형)
- `ab33172` — agent PTY-activity 기반 idle 자동 판정 (Layer B의 idle gating)
- `3f46324` — per-agent attempted set, reconnect (decision 응답 재배달의 토대)
- `ccef039` — activity 화이트리스트 / `b817695` — 가시성 정리 (왜 PTY 스팸을 막아야 하는지)

## 12. 다음 단계

1. **사용자 spec 리뷰** — 본 문서 승인/수정 ✅ (2026-05-28 승인)
2. **`superpowers:writing-plans`** — Phase별 구현 계획서 작성
3. **TaskForce MCP 티켓 분기 생성** — P1~P4 페이로드는 §16에 미리 박아둠
4. **구현 → P1부터 순차 dogfood**

---

## 13. 핸드오프 — 다음 에이전트가 읽어야 할 것

이 spec은 background 터미널 세션의 sandbox 제약 때문에 *설계*에서 멈췄다. 다음 에이전트(메인 Claude Code 세션, Full Disk Access 부여 후)가 이어받아 **P1 구현**을 시작한다.

### 13.1 본 세션에서 막힌 이슈 — 동일 함정 회피용

| 이슈 | 증상 | 회피 |
|---|---|---|
| Background sandbox EPERM | `Read`/`ls`/`cat`이 v3/* 전부에서 `Operation not permitted`. 세션 초기엔 됐다가 중간에 잠김 | 메인 Claude Code 세션으로 이동. 백그라운드 잡 안에서 이 작업 하지 말 것 |
| `MARBLO_PROJECT` 미주입 | `mcp__marblo__create_task` 호출 시 `No project context` 에러 | Marblo MCP는 Electron 앱 내부 에이전트만 자동 주입. 외부 터미널에선 TaskForce MCP만 사용 |
| TaskForce MCP venv 권한 | `Operation not permitted: ...TaskForce.AI/.venv/.../httpcore/__init__.py` — MCP 서버 자체가 자기 lib 못 읽음 | 사용자가 Terminal.app에 "전체 디스크 접근 권한" 부여 후 터미널/Claude Code 재시작 필요 (사용자가 직접 해야 함) |

### 13.2 사전조사 체크리스트 — P1 시작 전 grep/Read

P1은 **MCP 도구 호출 시 Firestore projection 갱신**만 한다. 본 세션은 다음 파일들의 *내용*을 확인 못 했으니, 다음 에이전트는 다음 항목을 직접 확인하고 시작할 것:

```
□ v3/electron/mcp-server/tools.ts
  → add_activity / update_task_status / submit_for_review / claim_task 핸들러
    각각 어느 라인에서 Firestore write 하는지, 트랜잭션 사용 여부

□ v3/electron/mcp-server/firebase.ts
  → Firestore 인스턴스 export 패턴, 컬렉션 path 규칙 확인

□ v3/electron/mission-engine/store-impl.ts
  → mission projection이 이미 있는지 (이름이 'projection'이 아닐 수 있음).
    중복 구현 피하기

□ v3/electron/mission-engine/ports.ts, types.ts
  → 기존 task 모델 + 이벤트 타입. Projection 스키마와 충돌 없는지

□ v3/electron/orchestrator-manager.ts, agent-manager.ts
  → PTY idle/working 판정 노출 방식. P2/P3에서 쓸 거지만 P1에선 미리 확인만

□ v3/electron/bridge-server.ts
  → 기존 submit_for_review → orch PTY inject 코드 위치 (commit 9d781bf).
    P2에서 일반화할 타깃

□ v3/electron/pending-instruction-listener.ts
  → 역방향 채널. P4에서 decision 응답 라우팅에 재사용

□ v3/skills/{orchestrator,backend,frontend,devops,test}_agent.md
  → 현재 스킬 내용. P3/P4에서 수정 들어감

□ git log --oneline -50 v3/
  → 최근 5-7일 commit. spec 작성 후 추가 변경 없는지
```

### 13.3 P1 DoD (Definition of Done)

다음 모두 통과 시 P1 완료:

```
□ tools.ts의 4개 핸들러(add_activity, update_task_status, submit_for_review, claim_task)가
  각각 호출 직후 Firestore projection 문서를 write/merge 한다 (트랜잭션으로 묶기)

□ projection 스키마 (tasks/{tid}/projection):
  {
    currentStatus: string,          // claim_task / update_task_status로 갱신
    lastAgentId: string,             // 매 호출 시 갱신
    lastActivityAt: Timestamp,       // 매 호출 시 갱신
    lastActivitySummary: string,     // add_activity message 첫 200자
    milestonesPassed: string[],      // submit_for_review 호출 시 task_id append
    blockerSummary?: string          // update_task_status(blocked) 시 셋
  }

□ mission projection (missions/{mid}/projection):
  소속 task들의 currentStatus 카운트 ({todo: 3, in_progress: 2, ...})를
  task projection 변경 시 derive해서 갱신 (Cloud Function or 같은 트랜잭션에서)

□ 워커가 작업 중 (in_progress)일 때 외부 클라이언트(MCP)가 get_projection을 호출해
  최신 상태를 받을 수 있다 (실제 동작 1회 확인)

□ MissionsTab UI는 이번 P1에서 손대지 않음 (P2~P4에서)

□ 기존 audit_logs / submit_for_review → orch PTY inject 경로는 영향 없음 (회귀 X)

□ vitest 단위 테스트 4개: 각 도구 호출이 projection을 어떻게 갱신하는지 검증

□ 빌드 통과: cd v3 && npm run build (또는 프로젝트 컨벤션)
```

### 13.4 commit/PR 전략

- **단일 PR 안 됨** — P1~P4 각각 별도 PR. P1은 projection만, P2는 notify-buffer + LOW batch, P3는 orch 스킬 ingestion + HIGH 즉시 주입, P4는 request_decision + 워커 스킬 룰
- **P1 PR 제목 컨벤션**: `v3(orch): projection layer — task/mission Firestore projection on MCP tool calls`
- **commit footer**: spec 링크 (`v3/docs/specs/2026-05-28-orch-live-awareness-design.md`) 본문에 명시
- **롤아웃 검증**: P1 머지 직후 dogfood 1-2일. 진짜 미션 1개 돌리며 orch가 projection read로 사용자 질의에 답하는지 확인. 문제 없으면 P2 착수

### 13.5 본 세션이 만든/건드린 것

- ✅ 신규 파일: `v3/docs/specs/2026-05-28-orch-live-awareness-design.md` (이 문서)
- ✅ 다른 변경 없음 — 소스 코드 안 건드림
- ⚠️ git 미커밋 상태로 작업 트리에 있음. 다음 에이전트가 첫 작업으로 이 spec 단독 커밋하고 시작 권장

---

## 14. 인계 메시지 (다음 에이전트 첫 입력 템플릿)

> Marblo v3 — Orchestrator Live Awareness 기능의 **P1 구현**을 이어받아 진행한다. 직전 세션은 background 잡이라 sandbox에 막혀 설계만 끝냈고 코드는 한 줄도 안 썼다.
>
> **읽어야 할 것:**
> 1. `v3/docs/specs/2026-05-28-orch-live-awareness-design.md` (전체)
> 2. 특히 §13 핸드오프 / §13.2 사전조사 체크리스트 / §13.3 P1 DoD
>
> **순서:**
> 1. spec 파일 단독 commit (메시지 예: `v3(docs): orchestrator live awareness spec`)
> 2. §13.2 체크리스트의 8개 파일 grep/Read로 현황 파악
> 3. §16의 P1 티켓 페이로드를 그대로 `mcp__taskforce__create_task` 호출 → 티켓 ID 받기
> 4. §13.3 DoD 항목별로 코드 작성 → 단위 테스트 → 빌드
> 5. PR 생성 (제목 §13.4)
>
> **막힘 신호:**
> - Marblo MCP 호출 X (외부 터미널이라 env 안 잡힘, TaskForce MCP만 사용)
> - "결정 분기 5종"(스코프/UX/보안/외부 의존성/모호한 instruction) 만나면 `request_decision` 안 만들고도 사용자에게 직접 묻기 — P4 전까지는 그 인프라 없음

---

## 15. 본 세션 결정 로그 (참고)

| # | 질문 | 결정 | 이유 |
|---|---|---|---|
| Q1 | 1차 목적 | 하이브리드 | 토큰 비용 + UX 피로 + 점진 구현 |
| Q2 | Branchpoint emit 주체 | MCP 호출 trigger + request_decision 1개 신규 | 워커 스킬에 추가 부담 최소 + PTY 파싱 회피 |
| Q3 | UI 표면 | 신규 표면 0, 기존 orch PTY 재활용 | commit 9d781bf 패턴 일반화 |
| Q4 | Wake 이벤트 분류 | status 변경 + decision 요청만 | add_activity는 projection만, LLM 안 깸 |
| Q5 | Backpressure | HIGH 즉시 / LOW idle 후 batch | 진짜 급한 건 안 놓치고 나머지는 깔끔 |

---

## 16. P1~P4 티켓 페이로드 (TaskForce MCP `create_task` 그대로 호출)

다음 에이전트가 메인 세션에서 그대로 복사해서 `mcp__taskforce__create_task` 호출. `project="marblo-v3"`, `role`은 표대로.

### P1 — Projection 레이어

```json
{
  "title": "v3(orch-live): P1 — Firestore projection 갱신 (MCP 도구 4종)",
  "description": "워커가 호출하는 MCP 도구 4종(add_activity, update_task_status, submit_for_review, claim_task)이 Firestore의 tasks/{tid}/projection 과 missions/{mid}/projection 문서를 갱신하도록 추가. 호출 직후 같은 트랜잭션에서 write. orch가 'get_projection' 호출로 LLM 깨우지 않고 즉답 가능하게 함.\n\nDoD/상세: v3/docs/specs/2026-05-28-orch-live-awareness-design.md §13.3\n사전조사: 같은 spec §13.2",
  "role": "backend",
  "project": "marblo-v3",
  "priority": 3,
  "scope": [
    "v3/electron/mcp-server/tools.ts",
    "v3/electron/mcp-server/firebase.ts",
    "v3/electron/mission-engine/store-impl.ts"
  ],
  "context": "Marblo v3 Electron + MCP. Firestore 트랜잭션 사용 필수. mission projection은 task projection 변경 시 derive 갱신 (별도 컬렉션 안 만들고 missions/{mid}/projection 한 문서로)."
}
```

### P2 — Notify Buffer + LOW Batch

```json
{
  "title": "v3(orch-live): P2 — LOW notify buffer + idle 감지 후 PTY batch flush",
  "description": "P1 완료 가정. claim_task / in_progress / milestone(submit_for_review) 호출 시 LOW priority notify event 생성. notify-buffer.ts 가 메모리에 모으고, orch PTY가 idle (agent-manager의 PTY-activity 판정 활용 — commit ab33172) 전환되면 한 줄 batch 메시지로 inject.\n\norch 스킬은 아직 ingestion 패턴 미적용 (P3에서) — 이 단계는 출력만 사람 눈으로 검증.\n\nDoD: §9 롤아웃 P2 + §3 변경 위치 표 (bridge-server.ts, notify-buffer.ts, orchestrator-manager.ts)",
  "role": "backend",
  "project": "marblo-v3",
  "priority": 2,
  "scope": [
    "v3/electron/bridge-server.ts",
    "v3/electron/notify-buffer.ts",
    "v3/electron/orchestrator-manager.ts"
  ],
  "context": "bridge-server의 submit_for_review → orch PTY inject 기존 경로(commit 9d781bf) 일반화. notify-buffer는 신규. ULID는 외부 lib 신규 추가 X — 자체 timestamp+random으로 충분."
}
```

### P3 — Orch 스킬 Ingestion + HIGH 즉시 주입

```json
{
  "title": "v3(orch-live): P3 — orch 스킬 notify ingestion 섹션 + HIGH 즉시 주입",
  "description": "P2 완료 가정. blocked / failed / milestone(HIGH) notify는 buffer 거치지 않고 즉시 orch PTY로 inject. orchestrator_agent.md에 §7 형태의 'Live Awareness — notify 처리 룰' 섹션 추가 — 인입 포맷, 처리 분기 표, 자동 처리 vs escalation 기준, 토큰 절약 가이드.\n\nDoD: 진짜 blocker 시나리오 1개 돌려서 orch가 (a) 자동 해결 가능한 경우 pending_instructions로 후속 지시 push, (b) 불가능한 경우 사용자에게 한 줄 요약 + 옵션 제시 하는지 확인.\n\n상세: v3/docs/specs/2026-05-28-orch-live-awareness-design.md §7",
  "role": "backend",
  "project": "marblo-v3",
  "priority": 2,
  "scope": [
    "v3/electron/bridge-server.ts",
    "v3/electron/notify-buffer.ts",
    "v3/skills/orchestrator_agent.md"
  ],
  "context": "skills/orchestrator_agent.md의 '5. Mission 진행 룰' 다음 자리에 '6. Live Awareness' 섹션 추가. eventId 중복 무시 룰을 스킬에 명시할 것 (idempotency)."
}
```

### P4 — request_decision + 워커 스킬 룰

```json
{
  "title": "v3(orch-live): P4 — request_decision MCP 도구 + 워커 스킬 5개 분기 룰",
  "description": "P3 완료 가정. 신규 MCP 도구 request_decision(task_id, question, options[]) 추가 — Firestore decisions/{decisionId} doc 생성 + 워커 PTY에 '결정을 기다립니다…' 출력 + blocking. orch가 mark_instruction_delivered(decision_id, chosen, rationale) 호출 시 pending_instructions로 워커 PTY에 응답 inject → 워커 재개.\n\n워커 스킬 4종({backend,frontend,devops,test}_agent.md)에 '결정 분기 — request_decision 사용 규칙' 섹션 추가 (5개 분기 조건). bridge-server의 dispatch footer에 '결정 분기 규약' 한 줄 추가.\n\nMissionTimeline.tsx에 decision.requested 노드 시각화 추가 (간단).\n\nDoD: 진짜 미션 1개 돌려서 워커가 스코프 확장 케이스에서 request_decision 던지고 → 사용자 답이 워커로 돌아가 작업 재개되는지 E2E 확인.\n\n상세: v3/docs/specs/2026-05-28-orch-live-awareness-design.md §6 + §8 + 워커 스킬 룰 본문",
  "role": "backend",
  "project": "marblo-v3",
  "priority": 2,
  "scope": [
    "v3/electron/mcp-server/tools.ts",
    "v3/electron/bridge-server.ts",
    "v3/skills/backend_agent.md",
    "v3/skills/frontend_agent.md",
    "v3/skills/devops_agent.md",
    "v3/skills/test_agent.md",
    "v3/src/components/missions/MissionTimeline.tsx"
  ],
  "context": "request_decision은 워커 PTY를 blocking — 응답 도착 전엔 다음 turn 진행 안 되도록 출력 텍스트 신중히 (모델별 동작 차이 있음). pending-instruction-listener.ts(commit 3f46324)의 재첨부 로직이 워커 죽음/재시작 시에도 결정 응답을 다시 inject 하는지 검증."
}
```

---

## 17. 비고

본 spec 작성 세션 외 추가 컨텍스트:

- 사용자 메모 [[project_mission_feature]] — v3 미션 D8/D9/D10/D13 default 합의는 이 spec의 §7 처리 분기 표와 정합
- 사용자 메모 [[mission_non_dev_expansion]] — 6월 데모는 코딩 미션만. 비개발 미션 확장은 v3.2/v4로 보류 → 이 spec도 코딩 미션 컨텍스트만 가정
- 본 세션 토큰 절약 결정 모두 D8 "개입 최소화" 강화 방향과 정합
