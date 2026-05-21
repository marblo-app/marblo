# Marblo v3 — Mission Feature Spec

**Status:** Draft for implementation
**Target:** v3.x Phase 3 (6월 말 런칭)
**Owner:** v3 product
**Spec date:** 2026-05-11
**관련 의사결정 기록:** `~/.gstack/projects/melocream-TaskForce.AI/ceo-plans/2026-05-11-supervisor-v1-5-launch-hook.md`

---

## 1. 한 줄 요약

마블로 v3에 **Mission** 컨셉을 도입한다. 사용자가 한 줄 요청 + 템플릿을 선택하면 orchestrator가 미션이 끝날 때까지 자율적으로 진행한다. 강의/런칭 데모의 핵심 hook이다.

## 2. 배경 — 왜 Mission인가?

마블로 v3에는 이미 Flow 시스템이 있다 (`FlowsTab.tsx`, `FlowCanvas.tsx`, `flow-engine/`). 그러나 Flow는 **"한 번 실행하고 끝"** 모델이다 (`FlowRun.completedAt`까지 분~시간). 강의 데모가 의도하는 것은 **며칠~몇 주 동안 살아있는 미션**이다:

- Day 1: orchestrator가 `/office-hours`, `/plan-ceo-review` 진행
- Day 2: 에이전트 디스패치, 사용자 잠시 자리 비움
- Day 3: 에이전트 완료, orchestrator가 자동 `/review` 실행, 사용자 알림
- Day 3: 사용자 돌아옴, "소셜 로그인도 추가" 요청 → 같은 미션 컨텍스트에 task 추가
- Day 4: `/ship` → PR URL → Mission completed

이 "살아있는 미션" 모델은 기존 Flow 스키마(`nodeResults`, `currentNodeId`)에 들어맞지 않는다. 정면 충돌이다.

**결정:** 기존 Flow 코드는 그대로 두되 secondary로 강등 (v3.1에서 visual editor로 부활 가능). 새 Mission 컨셉을 first-class로 신설.

## 3. Mission 컨셉 정의

**Mission** = 사용자 의도의 영속적 컨테이너. orchestrator가 owner로 책임지고 끝까지 가져간다.

### 라이프사이클

```
planning → active → waiting_for_human → sleeping → completed
                ↘ ↗                  ↘ ↗      ↘
                                              abandoned
```

| 상태                | 의미                                                |
| ------------------- | --------------------------------------------------- |
| `planning`          | 템플릿 선택 직후, 첫 step 실행 전                   |
| `active`            | orchestrator가 step 진행 중                         |
| `waiting_for_human` | AskUserQuestion 등으로 사용자 응답 대기             |
| `sleeping`          | 사용자 부재, 다음 event/사용자 입력 대기 (PTY idle) |
| `completed`         | 마지막 step 성공 (예: PR merged)                    |
| `abandoned`         | 사용자가 명시적 종료                                |

### 기존 Flow와의 차이

| 측면        | Flow (기존)      | Mission (신규)               |
| ----------- | ---------------- | ---------------------------- |
| 수명        | 분~시간          | 일~주                        |
| 종료 조건   | 마지막 노드 완료 | PR merged / 사용자 명시 종료 |
| 사용자 부재 | 일시정지         | 정상 상태 (`sleeping`)       |
| 컨텍스트    | `nodeResults` 맵 | 누적 `contextLog` timeline   |
| 후속 작업   | 새 `FlowRun`     | 같은 Mission에 follow-up     |
| Owner       | 없음             | orchestrator PTY 세션        |

## 4. 데이터 모델

### `v3/src/types/mission.ts` (신규)

```ts
export type MissionStatus =
  | "planning"
  | "active"
  | "waiting_for_human"
  | "sleeping"
  | "completed"
  | "abandoned";

export type MissionTemplateId =
  | "quick-fix"
  | "polish"
  | "feature"
  | "full-feature"
  | "research";

export type MissionStepType =
  | "gstack" // /review, /qa, /ship, /plan-* 등 슬래시 명령
  | "dispatch" // dispatch_task로 task 분해 + 에이전트 할당
  | "wait" // 모든 dispatch된 task 완료 대기
  | "fix"; // 에이전트 작업 (자율 코딩)

export interface MissionStep {
  index: number;
  type: MissionStepType;
  skill?: string; // type=gstack인 경우 (예: '/review')
  args?: string; // 슬래시 명령 인자
  onFailure?: "retry" | "escalate" | "continue";
  status: "pending" | "running" | "success" | "failed" | "skipped";
  output?: any;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface TimelineEvent {
  ts: Date;
  type:
    | "step.started"
    | "step.completed"
    | "step.failed"
    | "user.input"
    | "user.decision"
    | "agent.dispatched"
    | "agent.completed"
    | "agent.stuck"
    | "mission.paused"
    | "mission.resumed"
    | "supervisor.note";
  payload: Record<string, any>;
}

export interface Mission {
  id: string;
  projectId: string;
  goal: string; // 사용자 한 줄 요청 (예: "로그인 페이지 만들어줘")
  templateId: MissionTemplateId;
  status: MissionStatus;

  ownerOrchestratorSessionId: string; // OrchestratorManager 세션 id 연결
  steps: MissionStep[]; // 템플릿 시퀀스를 인스턴스화
  currentStepIndex: number;
  taskIds: string[]; // 미션 안에서 생성된 Firestore task id들
  contextLog: TimelineEvent[];

  launchedAt: Date;
  lastActivityAt: Date;
  completedAt: Date | null;
  abandonedReason?: string;
}
```

### Firestore 컬렉션

- 컬렉션: `missions`
- 인덱스: `(projectId, status, lastActivityAt desc)` — Active Missions 리스트용
- 보안 룰: 프로젝트 멤버만 read/write

## 5. 5개 Mission Templates

코드 상수로 시작 (`v3/electron/mission-engine/templates.ts`). Firestore seed는 v3.1.

| Template ID    | 라벨             | 무게   | 시퀀스                                                                                                                                               |
| -------------- | ---------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `quick-fix`    | ⚡ Quick Fix     | Light  | `/investigate` → fix → `/review` → `/ship`                                                                                                           |
| `polish`       | 💅 Polish        | Light  | `/design-review` → `/review` → `/ship`                                                                                                               |
| `feature`      | 🛠️ Feature       | Medium | `/plan-eng-review` → dispatch → wait → `/review` → `/qa` → `/ship`                                                                                   |
| `full-feature` | 🏛️ Full Feature  | Heavy  | `/office-hours` → `/plan-ceo-review` → `/plan-eng-review` → `/plan-design-review` → dispatch → wait → `/review` → `/qa` → `/design-review` → `/ship` |
| `research`     | 🔬 Research only | Heavy  | `/office-hours` → `/plan-ceo-review`                                                                                                                 |

사용 시나리오:

- Quick Fix: 버그, 소수정, 핫픽스
- Polish: 기존 UI 다듬기, 시각 QA
- Feature: 이미 기획된 작업 구현
- Full Feature: 제대로 된 신기능 (강의 데모 영상 60초 hook)
- Research only: 구현 없이 의사결정만 (디자인 docs 생성)

## 6. UI 명세

### 신규 컴포넌트

```
v3/src/components/
├ tabs/
│  └ MissionsTab.tsx              # default 탭으로 승격
├ missions/
│  ├ MissionList.tsx              # Active Missions 리스트
│  ├ MissionTemplateCatalog.tsx   # 5개 템플릿 카드 + "🚀 Launch Mission" 버튼
│  ├ MissionDetail.tsx            # 단일 Mission 진행 상황
│  ├ MissionTimeline.tsx          # contextLog 시각화 (ActivityStreamPanel 재사용 검토)
│  ├ MissionStatusBadge.tsx       # 상태 라벨 (active / sleeping / completed 등)
│  └ MissionLaunchDialog.tsx      # goal 입력 + 템플릿 선택 모달
```

### 액션 / 버튼

- **🚀 Launch Mission** — 템플릿 카드의 메인 CTA. "Start" / "Run"이 아니라 의도의 무게를 담은 이름.
- **⏸️ Pause Mission** — 사용자가 명시적으로 일시정지 (waiting_for_human → sleeping)
- **▶️ Resume Mission** — 재개
- **🛑 Abandon Mission** — 명시적 종료 (확인 dialog)
- **🔍 Open Timeline** — Mission Detail로 진입

### 탭 우선순위

```
[ Tasks ] [ Missions* ] [ Agents ] [ Activity ] [ Flows (Beta) ] [ ... ]
              ^default
```

`FlowsTab.tsx`는 secondary로 강등. 라벨에 `(Beta)` 추가하거나, settings에서 hidden 옵션 제공. **코드는 변경하지 않는다** — UI 메타데이터만 조정.

### 강의 데모 시나리오 (Full Feature 템플릿, 60초)

```
[사용자] Missions 탭 → 🏛️ Full Feature 카드 → "로그인 페이지 만들어줘" → 🚀 Launch Mission

[MissionDetail가 열림, MissionTimeline에 실시간 흐름]
  🚀 Mission launched · template=full-feature
  ▶ Step 1: /office-hours
  ▶ Step 2: /plan-ceo-review
    ❓ → 사용자: "소셜 로그인 포함?" (waiting_for_human)
  ✅ 사용자 답 → active
  ▶ Step 3: /plan-eng-review
  ▶ Step 4: /plan-design-review
  ▶ Step 5: dispatch · 3 agents (react, api, test)
  ▶ Step 6: wait
    💪 api-1 구현 중...
    ✅ api-1 완료 · /review · /qa (D6.B 자동)
    ⚠️ react-1 stuck → 📡 [event] → orchestrator 자동 handoff → react-2
  ▶ Step 7: /review
  ▶ Step 8: /qa
  ▶ Step 9: /design-review
  ▶ Step 10: /ship → PR URL
  ✅ Mission completed
```

## 7. Mission Engine 아키텍처

### 파일 구조

```
v3/electron/mission-engine/
├ index.ts                # MissionEngine 클래스
├ state-machine.ts        # status 전이 규칙
├ step-executor.ts        # MissionStepType별 실행 분기
├ templates.ts            # 5개 템플릿 시퀀스 상수
└ event-handler.ts        # event wakeup → mission state 업데이트
```

### 핵심 인터페이스

```ts
export class MissionEngine {
  constructor(
    private missionService: MissionService,
    private orchestratorManager: OrchestratorManager,
    private taskService: TaskService,
    private mcpServer: MCPServer, // run_skill 호출용
    private eventBus: EventBus // D 이벤트 wakeup
  ) {}

  async launch(
    projectId: string,
    goal: string,
    templateId: MissionTemplateId
  ): Promise<Mission>;
  async resume(missionId: string): Promise<void>;
  async abandon(missionId: string, reason?: string): Promise<void>;

  // 내부: step 진행
  private async advanceStep(mission: Mission): Promise<void>;
  private async executeStep(mission: Mission, step: MissionStep): Promise<void>;

  // 이벤트 핸들러 (D — Event wakeup)
  private onTaskStatusChanged(taskId: string, status: TaskStatus): void;
  private onAgentStuck(agentId: string): void;
  private onAgentCompleted(agentId: string, taskId: string): void;
}
```

### State machine 룰

```
planning ──launch()──▶ active
active ──askUser()──▶ waiting_for_human
waiting_for_human ──userResponded()──▶ active
active ──idle &lastStep.completed──▶ sleeping
sleeping ──event/userInput──▶ active
active ──lastStep.success──▶ completed
active|sleeping ──abandon()──▶ abandoned
* ──unrecoverable error──▶ abandoned (reason 기록)
```

## 8. Orchestrator 통합

### `v3/skills/orchestrator_agent.md`에 신규 룰 추가

```markdown
### 5. Mission 진행 룰 (NEW in v3.x Phase 3)

- 사용자가 Mission Launch 시 (Marblo가 시스템 메시지로 알림),
  MissionEngine으로 자율 진행한다.
- 각 step 결과를 다음 step 컨텍스트로 전달.
- 큰 결정 (소셜 로그인 포함 여부 등)에서만 사용자에게 AskUserQuestion.
  매 step마다 확인하지 않는다.
- step 실패 시 `onFailure` 정책 따름: retry / escalate / continue.
- Mission이 sleeping 상태일 때 event 발생 (예: agent.stuck, agent.completed)
  → orchestrator가 깨어나서 평가, 적절히 개입, idle 복귀.
- Mission 종료 조건 (마지막 step 성공) 도달 시 사용자에게 보고 후
  status=completed 전환.
```

### 신규 MCP 도구: `run_skill`

```ts
// v3/electron/mcp-server/tools.ts에 추가
{
  name: 'run_skill',
  description: 'gstack 슬래시 명령을 안전하게 실행하고 결과를 반환',
  inputSchema: z.object({
    skill: z.enum([
      '/review', '/qa', '/ship', '/investigate',
      '/plan-ceo-review', '/plan-eng-review', '/plan-design-review',
      '/design-review', '/office-hours', '/autoplan',
    ]),  // 허용 목록 락다운 — 보안
    args: z.string().optional(),
    timeoutMs: z.number().optional().default(600000),
  }),
  handler: async ({ skill, args, timeoutMs }) => {
    // 1. PTY subprocess 띄우거나 CC --print 모드로 실행
    // 2. stdout/stderr 파싱
    // 3. 결과를 구조화된 객체로 반환
    // 4. 타임아웃 / 실패 처리
  },
}
```

**보안 주의:** 허용 목록 외 슬래시 명령 (`/login`, `/clear`, 임의 텍스트) **반드시 거부**. injection 위험.

## 9. 기존 Flow와의 관계

- `v3/src/types/flow.ts` — **변경 없음**
- `v3/electron/flow-engine/` — **변경 없음**
- `v3/src/components/flows/` — **변경 없음**
- `v3/src/components/tabs/FlowsTab.tsx` — 라벨에 `(Beta)` 추가하거나 secondary tab으로 강등
- v3.1에서 Flow를 "visual editor for custom missions"로 부활 검토

## 10. 구현 단계 (Phase 3 내부)

| Step | 작업                             | 산출물                                                                                  | CC 예상 |
| ---- | -------------------------------- | --------------------------------------------------------------------------------------- | ------- |
| 1    | Mission 타입 + Firestore 서비스  | `types/mission.ts`, `services/missionService.ts`, 인덱스                                | 1일     |
| 2    | Mission Engine 코어              | `mission-engine/{index,state-machine,step-executor,templates}.ts`                       | 2-3일   |
| 3    | UI — Tab + Catalog               | `MissionsTab.tsx`, `MissionTemplateCatalog.tsx`, `MissionLaunchDialog.tsx`              | 2일     |
| 4    | UI — Detail + Timeline           | `MissionDetail.tsx`, `MissionTimeline.tsx`, `MissionList.tsx`, `MissionStatusBadge.tsx` | 1-2일   |
| 5    | Orchestrator 통합                | `orchestrator_agent.md` 룰 추가, `run_skill` MCP 도구, event handler                    | 2일     |
| 6    | 통합 테스트 + 데모 시나리오 캡처 | Phase 3 강의 영상 60초                                                                  | 1일     |

**총 CC effort: ~9-12일 (~2주)**

Phase 3 데드라인 (6월 말) 안에 들어옴. 5개 템플릿 전부 동시 출시 부담스러우면 **Full Feature 1개 먼저 + 나머지 4개 점진** 출시 가능.

## 11. 미결 사항 (구현 시점 결정)

| ID  | 결정 사항                                                                                                                  | 영향                           |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| D8  | Mission 자율 진행 중 **사용자 개입 지점** — (a) 큰 결정만 (b) 매 step 확인 (c) 사용자 토글 (d) LLM 판단                    | 강의 데모와 실사용자 안전 모두 |
| D9  | **Wake prompt 형식** — orchestrator PTY에 주입할 system event 메시지. 너무 짧으면 LLM 컨텍스트 부족, 너무 길면 토큰 + 교란 | 토큰 budget, A/B 테스트 필요   |
| D10 | Mission 중간 step **실패 시 fallback** — 어디까지 되감기? 사용자에게 어떻게 알림? `onFailure` 정책 default?                | 신뢰성                         |
| D13 | `(Beta)` 라벨 vs hidden — 기존 Flow 탭 처리 방식                                                                           | UI 노이즈                      |

## 12. 테스트 시나리오

다른 에이전트가 구현 후 반드시 검증할 케이스:

- [ ] Quick Fix 템플릿 e2e — 단순 버그 수정 시나리오로 4 step 완료
- [ ] Full Feature 템플릿 e2e — 강의 데모 60초 영상으로 캡처 가능
- [ ] Mission 도중 사용자 부재 → `sleeping` → 에이전트 이벤트로 자동 wakeup → 진행 재개
- [ ] Mission `abandon` — 진행 중 task 정리, agent kill, 상태 보존
- [ ] Mission 중간 step 실패 → `onFailure='escalate'` → 사용자에게 보고
- [ ] 동시 multiple missions — 한 프로젝트에 2개 mission 병렬 진행
- [ ] orchestrator PTY 재시작 (auto-restart) → `ownerOrchestratorSessionId` 재연결, mission resume
- [ ] `run_skill` 보안 — 허용 목록 외 명령 거부 확인

## 13. 다음 단계 (작업 받기 전 권고)

- [ ] **`/plan-eng-review` 통과** — 이벤트 버스 / state machine / 토큰 budget / `run_skill` 보안 검토 (Phase 1 전 mandatory gate)
- [ ] D8/D9/D10 디자인 결정 (구현 step 5 진입 전)
- [ ] orchestrator skill 룰 강제력 측정 (LLM이 룰을 잊는 비율 — Phase 1 베타 데이터)

---

## 부록 A — 강의 메시지 포지셔닝

- "Cmux는 스킬 실행을 자동화한다 (low-level)"
- "마블로는 **AI PM이 미션을 끝까지 책임진다** (high-level)"
- 강의 한 챕터: "AI 매니저는 어떻게 작동하는가" — `orchestrator_agent.md`를 강의 자료로 사용, "이 prompt가 AI 매니저의 헌법이다"

## 부록 B — NOT in scope (Phase 3 내)

- 사용자 정의 Mission 템플릿 (드래그앤드롭 노드 편집) → v3.1
- Mission Customize 버튼 (프리셋 복제 후 수정) → v3.1
- 커뮤니티 Mission 템플릿 공유 / 마켓플레이스 → v3.2+
- Cron-style tick (N초마다 깨어남) → v3.2 (event wakeup으로 90% 효과 달성)
- Adaptive workplan (결과 보고 후속 task 동적 추가) → v3.1
- 후속 Mission 자동 생성 (`followUps`) → v3.1
