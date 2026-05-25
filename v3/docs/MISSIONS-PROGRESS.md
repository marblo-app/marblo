# Marblo v3 Mission Feature — Progress & Handoff

**Status as of:** 2026-05-13
**Spec:** [`v3/docs/MISSIONS-SPEC.md`](./MISSIONS-SPEC.md)
**Auto-memory:** `~/.claude/projects/-Users-dongwonkim-Documents-programming-marblo/memory/project_mission_feature.md`

---

## TL;DR — 다음 에이전트가 읽고 바로 진행

- Step 1-4 = **REVIEW 제출 완료** (frontend types/service/UI + electron mission-engine 코어)
- Step 5a = **완료** (`run_skill` MCP tool + `orchestrator_agent.md` §5 룰)
- Step 5b = **REVIEW 제출 완료** (2026-05-13) — 6 구현체 + wire + main.ts wiring + firestore.rules 한시 완화. typecheck 3 분리 모두 clean.
- Step 6 = **REVIEW 제출 완료** (2026-05-14) — 39 vitest mission 테스트 (시나리오 3-8 + wiring shape) 통과. 시나리오 1/2 의 실제 Electron 데모 캡처는 아래 "데모 매뉴얼" 참고.

핸드오프 받는 에이전트:

1. 이 문서 + [`MISSIONS-SPEC.md`](./MISSIONS-SPEC.md) 두 개만 읽으면 컨텍스트 충분
2. TaskForce ticket `96cc0c85-2219-4b3b-8f08-194026c30cc4` (Step 5) 의 activity 로그도 함께 확인 (`mcp__taskforce__get_task`)
3. 본인 판단으로 5b 를 sub-task 로 더 분해해도 됨 (6 구현체 × 별도 파일)

---

## TaskForce 티켓 현황 (project = `marblo-v3-missions`)

| Step | ID                                     | 상태   | 한 줄 산출물                                              |
| ---- | -------------------------------------- | ------ | --------------------------------------------------------- |
| 1    | `173ccf4f-0e80-4b03-a494-b84adbc0663a` | REVIEW | types + missionService + firestore index/rules            |
| 2    | `4f4ed089-3ae0-4e6c-a6ed-310993171f76` | REVIEW | mission-engine 코어 7 파일 (ports 인터페이스 추상화)      |
| 3    | `9b2590b3-05f9-4b96-b3ef-4666db2cba66` | REVIEW | MissionsTab + Catalog + LaunchDialog + TabBar/Layout 통합 |
| 4    | `f97b4cc4-8480-4fe6-857a-896fc6f0a14e` | REVIEW | MissionDetail + Timeline + List + StatusBadge             |
| 5    | `96cc0c85-2219-4b3b-8f08-194026c30cc4` | REVIEW | 5a + 5b 완료 — run_skill + 6 ports impl + main.ts wiring  |
| 6    | `b7145aea-3be2-4f5a-8257-73e16aca2e65` | TODO   | 8 e2e 시나리오 + 데모 60초 캡처                           |

REVIEW 상태 ticket 4 개는 사용자가 직접 코드 리뷰 후 DONE 으로 닫거나 추가 피드백을 줄 예정. 다음 에이전트는 이 4 개는 건드리지 말고 Step 5b 만 진행.

---

## 결정된 default (사용자 합의, 변경 시 명세 사항)

| ID                    | 결정                                                                                                                 | 적용 위치                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| D8 (사용자 개입 지점) | 큰 결정만 (`AskUserQuestion` 으로) — 매 step 확인 X                                                                  | `orchestrator_agent.md` §5 룰로 강제                                                                             |
| D9 (wake prompt 형식) | "Mission `<id>` 이벤트: `<type>`. 마지막 step `<n>` 상태 `<status>`. 다음 행동을 결정해주세요."                      | Step 5b 의 wake-prompt builder 에서 finalize (토큰 budget A/B 검토)                                              |
| D10 (실패 fallback)   | `onFailure='retry'` default + `maxRetries=2` → 그래도 실패하면 알림 카드 + `waiting_for_human`                       | `MissionEngine.handleFailure` 에 구현 완료 (Step 2). UI 알림 카드는 `MissionDetail.tsx` `waiting_for_human` 배너 |
| D13 ((Beta) 라벨)     | `TabBar.tsx` 에서 라벨만 `Flows (Beta)` 변경. `FlowsTab.tsx` 코드는 안 건드림                                        | 명세 §9 충실                                                                                                     |
| firestore.rules       | `missions` 컬렉션만 `isProjectMember` 강제. `tasks/agents` 는 기존 `isAuthenticated` 유지 (v3.1 hardening 에서 통일) | `firestore.rules` `missions` 블록                                                                                |

---

## 산출물 파일 인덱스

### Frontend (renderer)

```
v3/src/types/
├ mission.ts                              ← 신규. Mission/Step/TimelineEvent + 9 union/alias
└ index.ts                                ← export * from './mission' 추가

v3/src/services/
├ missionService.ts                       ← 신규. CRUD + subscribe + appendTimelineEvent + updateMissionStep + setMissionStatus
└ index.ts                                ← export * as missionService 추가

v3/src/components/missions/
├ templates.ts                            ← 신규. TEMPLATE_META (electron 측 mirror)
├ MissionStatusBadge.tsx                  ← 신규. 6 상태 색상 라벨
├ MissionTimeline.tsx                     ← 신규. contextLog 시각화
├ MissionList.tsx                         ← 신규. Active/Archive 리스트
├ MissionDetail.tsx                       ← 신규. header+actions+steps+timeline + waiting_for_human 알림 카드
├ MissionTemplateCatalog.tsx              ← 신규. 5 템플릿 카드
└ MissionLaunchDialog.tsx                 ← 신규. 모달

v3/src/components/tabs/
└ MissionsTab.tsx                         ← 신규. 통합 탭 (subscribeToMissions realtime)

v3/src/components/
├ TabBar.tsx                              ← 수정. 'missions' 탭 추가, Flows → 'Flows (Beta)'
└ Layout.tsx                              ← 수정. MissionsTab 등록 + default activeTab='missions'

v3/firestore.indexes.json                  ← 수정. missions (projectId, status, lastActivityAt) 인덱스
v3/firestore.rules                         ← 수정. missions 컬렉션 isProjectMember 강제
```

### Electron (main process — mission engine)

```
v3/electron/mission-engine/                 ← Step 2 신규 폴더
├ types.ts                                ← Mission 타입 mirror (electron rootDir 제약) + ALLOWED_SKILLS 상수
├ templates.ts                            ← 5 템플릿 + instantiateSteps/getTemplate/listTemplates
├ state-machine.ts                        ← assertMissionTransition + isTerminalMission
├ ports.ts                                ← 의존성 인터페이스 6 개 (MissionStore/TaskDispatcher/SkillRunner/FixRunner/MissionEventBus/OrchestratorRegistry)
├ step-executor.ts                        ← gstack/dispatch/wait/fix 분기 + WAIT_PENDING 시그널
├ event-handler.ts                        ← InProcessMissionEventBus 골격
└ index.ts                                ← MissionEngine 클래스 + re-exports
```

### Electron (mcp-server — Step 5a)

```
v3/electron/mcp-server/
└ tools.ts                                 ← 수정. 23번째 도구 run_skill 추가 (~ +160 줄)

v3/skills/
└ orchestrator_agent.md                    ← 수정. §5 Mission 진행 룰 추가
```

### Electron (mission-engine impl — Step 5b)

```
v3/electron/mission-engine/
├ firebase-app.ts                          ← 신규. named app 'mission-engine' + anonymous auth
├ store-impl.ts                            ← 신규. MissionStore (Firestore CRUD + nested Date 변환)
├ dispatcher-impl.ts                       ← 신규. TaskDispatcher (decompose → tasks 컬렉션 → bridge dispatch)
├ skill-runner-impl.ts                     ← 신규. SkillRunner (allowlist + shell-metachar + cc --print subprocess)
├ fix-runner-impl.ts                       ← 신규. FixRunner (단일 task + DONE 까지 polling)
├ orch-registry-impl.ts                    ← 신규. OrchestratorRegistry (기존 main.ts orchestrators Map wrap)
├ event-forwarder.ts                       ← 신규. missions/tasks subscribe → eventBus.task.status_changed
└ wire.ts                                  ← 신규. buildMissionEngine 팩토리

v3/electron/main.ts                        ← 수정. mission wire + agent status forward + planning pickup + dispose
v3/electron/bridge-server.ts               ← 수정. DispatchTaskRequest/Response export + dispatchTask public
v3/firestore.rules                         ← 수정. missions 룰 한시 완화 (v3.1 hardening 까지)
```

---

## Step 5b 구현 결정 (2026-05-13 완료)

- **Firebase auth**: main process 가 `mission-engine` named app + `signInAnonymously` (mcp-server 와 동일 패턴). `missions` 룰은 한시적으로 `isAuthenticated` 로 완화 — `isProjectMember` 강제 시 anon uid 가 members 에 없어 write 가 전부 실패. v3.1 hardening 에서 id-token IPC + `signInWithCustomToken` + 일괄 룰 좁힘.
- **TaskDecomposer 공유**: 기존 IPC 핸들러용 lazy `getDecomposer()` 를 mission-wire 직전으로 끌어올려 IPC 와 MissionEngine 이 같은 싱글톤을 사용. (이전엔 line 1530 정의 → wire 가 못 봄.)
- **BridgeServer**: `dispatchTask` 를 `private` → `public` 으로 노출. mission-engine 이 in-process 로 호출 (HTTP 라운드트립 없음). HTTP `/dispatch-task` 핸들러도 같은 entrypoint 통해 들어옴 — 동작 변경 없음.
- **fix step**: dispatcher 의 `dispatchTasks` (LLM decompose 호출) 를 거치지 않고 fix-runner-impl 이 직접 단일 task 생성 + bridge dispatch + DONE polling. quick-fix 의 goal → 1 task 매핑이 자명해 decompose 비용을 절약.
- **wake-from-sleep**: event-forwarder 가 (1) missions 컬렉션 subscribe (status in active/sleeping/waiting_for_human), (2) 그 프로젝트들의 tasks subscribe, (3) task 변화 중 missionId 필드 매칭 시 `eventBus.emit('task.status_changed')`. 같은 머신 안에서는 agentManager.onStatusChange 가 즉시 broadcast 도 함께 발행 (Firestore round-trip 우회).
- **Task doc 의 `missionId` 필드**: dispatcher-impl / fix-runner-impl 가 tasks 컬렉션에 `missionId` 를 함께 쓴다. event-forwarder 가 이 필드로 task→mission 역인덱스. Renderer 의 Task 타입에는 없는 필드지만 Firestore 가 schemaless 라 무해.
- **typecheck 3 분리 모두 clean**: frontend = 사전 21 개 (mission 무관) 유지, electron / mcp-server = 0 에러.

## Step 5b 작업 가이드 (참고용 회고)

### 목표 (당시)

`v3/electron/main.ts` 에서 `MissionEngine` 을 instantiate 하고 6 개 ports 의 구현체를 주입.
UI 에서 `status='planning'` 으로 만든 미션을 engine 이 자동 pickup → `active` 진행.

### main.ts 구조 (이미 grep 한 결과 참고)

- 총 2041 줄
- 주요 manager instantiate 블록: line 226-356
  - `const updater = new Updater();`
  - `const ptyManager = new PtyManager();`
  - `const fsManager = new FsManager();`
  - `const agentManager = new AgentManager(...)` ← line 239
  - `const bridgeServer = new BridgeServer(...)` ← line 351
  - `const orchestrators = new Map<string, OrchestratorManager>()` ← line 356
  - `createOrchestratorInstance(projectId)` / `getOrchestrator(projectId)` ← line 364, 390
- firebase init 패턴: line 533-539 (이미 firebase/app, firebase/firestore import 사용 중)
- agent event 콜백: `AgentManager` 생성자 5번째 인자 `onStatusChange?: (agentId, status) => void`

### 권장 파일 분해 (6 개 구현체 + wiring)

```
v3/electron/mission-engine/
├ store-impl.ts                            ← 신규 (5b-1)
├ dispatcher-impl.ts                       ← 신규 (5b-2)
├ skill-runner-impl.ts                     ← 신규 (5b-3)
├ fix-runner-impl.ts                       ← 신규 (5b-4)
├ orch-registry-impl.ts                    ← 신규 (5b-5)
└ wire.ts                                  ← 신규 (5b-6). buildMissionEngine() 팩토리

v3/electron/main.ts                        ← 수정 (5b-7). buildMissionEngine 호출 + agentManager event hook
```

### 1) `store-impl.ts` — MissionStore

패턴 참고: `v3/electron/pending-instruction-listener.ts` 가 main process 에서 자체 firebase init.

```ts
// 핵심: missionService 와 동일 시그니처를 main process firebase client SDK 로 재현
//
// 주의 — Nested Timestamp/Date 변환:
//   - read: steps[].startedAt, steps[].completedAt, contextLog[].ts 가 Firestore Timestamp.
//     frontend missionService.ts 의 toMission() 패턴 그대로.
//   - write: Firebase SDK 가 nested Date 를 자동 Timestamp 변환 — 추가 처리 불필요.

export interface MissionStoreDeps {
  app: FirebaseApp; // 'mission-engine' 이름으로 init 권장 (다른 app 들과 격리)
}

export function createMissionStore(deps: MissionStoreDeps): MissionStore {
  const db = getFirestore(deps.app);
  // ... 8 메서드 구현 (ports.ts MissionStore 인터페이스 따라)
}
```

### 2) `dispatcher-impl.ts` — TaskDispatcher

```ts
// dispatchTasks: TaskDecomposer.decompose(goal) → 각 task 를 Firestore tasks 컬렉션에
//                create → agentManager 로 dispatch (orchestrator 가 했던 패턴 재현)
// getTaskStatuses: Firestore tasks 일괄 read
// killAgentsForTasks: 각 task 의 claimedBy agent 찾아서 agentManager.kill 호출

export function createTaskDispatcher(deps: {
  taskDecomposer: TaskDecomposer;
  agentManager: AgentManager;
  db: Firestore;
  eventBus: MissionEventBus;
}): TaskDispatcher { ... }
```

주의: `TaskDecomposer.decompose(goal)` 는 LLM 호출 — task description 에 사용자 goal 이 그대로 들어가면 prompt injection 가능. 외부 사용자 입력은 이미 frontend `MissionLaunchDialog` 에서 받은 trim() 만 통과한 상태. LLM 호출 시 system prompt 가 robust 한지 `task-decomposer.ts` 확인할 것.

### 3) `skill-runner-impl.ts` — SkillRunner

**선택 옵션 A (권장):** `run_skill` 의 spawn 로직을 main process 에서 동일하게 재현 (격리 cc --print subprocess). mcp-server tools.ts 의 23번 도구 구현부를 main process module 로 옮기는 셈.

**선택 옵션 B:** orchestrator PTY 를 통해 mcp `run_skill` 도구를 invoke. 복잡 (injection risk + PTY 출력 파싱).

옵션 A 권장. 단 `ALLOWED_SKILLS` 상수는 `v3/electron/mission-engine/types.ts` 의 것을 그대로 사용 (이미 export 됨).

```ts
export function createSkillRunner(deps: {
  ccBinary?: string; // default: process.env.MARBLO_CC_BIN || 'claude'
  projectRoot?: string;
}): SkillRunner { ... }
```

### 4) `fix-runner-impl.ts` — FixRunner

```ts
// Quick-Fix template 의 'fix' step. 가장 단순한 dispatch 패턴:
//   1. 1 개 task 생성 (goal 그대로) — role 결정은 dispatch-scoring 활용
//   2. agentManager 로 spawn (Claude default)
//   3. task 가 DONE 이 될 때까지 polling 또는 event 대기
//
// 또는: dispatcher.dispatchTasks(1 task) + wait step 패턴 재사용 (코드 중복 피함)

export function createFixRunner(deps: {
  dispatcher: TaskDispatcher;
}): FixRunner { ... }
```

### 5) `orch-registry-impl.ts` — OrchestratorRegistry

```ts
// main.ts 의 orchestrators Map + createOrchestratorInstance 를 wrapping.
// ensureSession 의 의미:
//   - projectId 에 이미 orchestrator 가 있고 alive → reuse
//   - 없거나 죽었으면 createOrchestratorInstance(projectId) 호출
//   - 어느 쪽이든 OrchestratorRef ({ sessionId, isAlive, postMessage }) 반환
//
// 주의: missionId 에 ownerOrchestratorSessionId 갱신은 caller (engine.launch) 책임.

export function createOrchestratorRegistry(deps: {
  orchestrators: Map<string, OrchestratorManager>;
  createInstance: (projectId: string) => OrchestratorManager;
}): OrchestratorRegistry { ... }
```

### 6) `wire.ts` — 팩토리

```ts
import { MissionEngine, InProcessMissionEventBus } from './index';
import { createMissionStore } from './store-impl';
// ...

export function buildMissionEngine(deps: {
  firebaseApp: FirebaseApp;
  agentManager: AgentManager;
  taskDecomposer: TaskDecomposer;
  orchestrators: Map<string, OrchestratorManager>;
  createOrchestratorInstance: (projectId: string) => OrchestratorManager;
}): { engine: MissionEngine; eventBus: InProcessMissionEventBus } {
  const eventBus = new InProcessMissionEventBus();
  const store = createMissionStore({ app: deps.firebaseApp });
  const dispatcher = createTaskDispatcher({ ... });
  const skillRunner = createSkillRunner({});
  const fixRunner = createFixRunner({ dispatcher });
  const orchReg = createOrchestratorRegistry({ ... });
  const engine = new MissionEngine({
    store, dispatcher, skillRunner, fixRunner,
    eventBus, orchestrators: orchReg,
  });
  return { engine, eventBus };
}
```

### 7) `main.ts` 수정 (실제 wiring)

```ts
// (a) bridgeServer 인스턴스 이후 — 약 line 356 직후
import { buildMissionEngine } from "./mission-engine/wire";

// 별도 firebase app instance — 다른 app 들과 격리.
// pending-instruction-listener 가 동일 패턴 (line 1 참고).
const missionFirebaseApp =
  getApps().find((a) => a.name === "mission-engine") ||
  initializeApp(firebaseConfig, "mission-engine");

const taskDecomposer = new TaskDecomposer(/* LLM provider */); // 기존 패턴 확인

const { engine: missionEngine, eventBus: missionEventBus } = buildMissionEngine(
  {
    firebaseApp: missionFirebaseApp,
    agentManager,
    taskDecomposer,
    orchestrators,
    createOrchestratorInstance,
  },
);

// (b) agentManager.onStatusChange 콜백을 확장 — 기존 콜백 유지하면서 mission event forward
//     line 239 의 new AgentManager(...) 5번째 인자.
//     기존:
//       (agentId, status) => { ... existing logic ... }
//     변경:
//       (agentId, status) => {
//         ... existing logic ...
//         // task 의 claimedBy 가 이 agent 인 mission 찾아서 emit
//         forwardAgentStatusToMissions(agentId, status, missionEventBus, missionStore);
//       }

// (c) Firestore tasks listener — mission.taskIds 에 포함된 task 의 status_changed 를 emit.
//     별도 module 로 분리 권장 — v3/electron/mission-engine/event-forwarder.ts

// (d) Planning 미션 자동 pickup — app.whenReady().then() 안에서 호출
async function pickupPlanningMissions() {
  // missionStore 에 queryByStatus('planning') 메서드 추가 필요 — ports.ts 에는 없음.
  // 또는 일회성 직접 firestore 쿼리.
  for (const mission of planning) {
    missionEngine
      .resume(mission.id)
      .catch((err) =>
        console.error("[Mission] pickup failed", mission.id, err),
      );
  }
}
```

---

## 보안 critical 체크리스트 (Step 5b 진행 중 반드시 확인)

- [ ] `run_skill` caller authority — 현재 mcp-server 의 `run_skill` 은 `mission_id` 만 받고 검증 안 함. main process skillRunner 는 mission 의 `ownerOrchestratorSessionId` 와 호출 caller 가 일치하는지 확인할 것.
- [ ] `TaskDecomposer.decompose(goal)` 의 LLM 호출 — system prompt 가 prompt injection 에 robust 한지 `orchestrator/task-decomposer.ts` 검토. 사용자 goal 이 LLM 컨텍스트에 그대로 들어감.
- [ ] `wait` step polling 빈도 — `getTaskStatuses` 가 너무 자주 호출되면 부하. engine 은 `WAIT_PENDING` 신호 받으면 sleeping 으로 전환하고 event 기반으로만 깨워야 한다. busy-loop 금지.
- [ ] main process firebase app 의 auth — anonymous 인 경우 firestore.rules 의 `isProjectMember` 가 fail. service account 또는 사용자 token 전달 필요. mcp-server 가 anonymous 로 동작하는 게 작동하는 이유는 `tasks/agents` 룰이 `isAuthenticated` 만 검사하기 때문. `missions` 는 strict 하므로 별도 처리.
- [ ] `kill_agent` 시 race — abandon 미션의 task 가 mid-dispatch 인 경우. `killAgentsForTasks` 가 idempotent 해야 함.

---

## Step 6 작업 가이드 (Step 5b 완료 후)

명세 [`MISSIONS-SPEC.md`](./MISSIONS-SPEC.md) §12 의 8 시나리오:

| #   | 시나리오                                    | 테스트 종류                   |
| --- | ------------------------------------------- | ----------------------------- |
| 1   | Quick Fix e2e — 단순 버그 수정 4 step       | playwright e2e                |
| 2   | Full Feature e2e — 강의 데모 60초 영상 캡처 | playwright + 비디오           |
| 3   | sleeping → event wakeup → resume            | unit (mission-engine.test.ts) |
| 4   | abandon 정리 (task / agent kill)            | unit + integration            |
| 5   | `onFailure='escalate'` → waiting_for_human  | unit                          |
| 6   | multiple missions 병렬                      | integration                   |
| 7   | PTY 재시작 + resume                         | integration                   |
| 8   | `run_skill` 보안 (허용 목록 외 거부)        | unit (zod schema 검증)        |

실제 테스트 위치 (2026-05-14 완료):

```
v3/tests/unit/mission-engine.test.ts          ← 21 tests — 시나리오 3, 4, 5, 6, 7, 8 + 템플릿/state-machine
v3/tests/unit/mission-skill-runner.test.ts    ← 7 tests  — 시나리오 8 의 보안 입력 검증 4 종 (metachar/allowlist/cwd)
v3/tests/integration/mission-wiring.test.ts   ← 11 tests — 시나리오 1+2 의 wiring shape guard
```

시나리오 1 (Quick Fix e2e) + 2 (Full Feature 60 초 데모) 의 **실행** 부분은 실제 Electron + UI 가 필요해 vitest 가 잡지 못한다. 대신 vitest 의 shape guard 가 wiring 회귀를 방지 — 그 위에서 실제 데모는 아래 "데모 매뉴얼" 절차로 캡처.

```bash
# 전체 mission 테스트 (39 개) 실행
npx vitest run tests/unit/mission-engine.test.ts \
  tests/unit/mission-skill-runner.test.ts \
  tests/integration/mission-wiring.test.ts
```

mission-engine 코어가 ports 인터페이스로 추상화돼 있어서 unit 테스트는 in-memory fake 만 만들면 빠르게 가능 — Step 2 의 ports.ts 가 이 시나리오를 위해 의도된 설계.

---

## 데모 매뉴얼 (시나리오 1/2 실제 캡처)

### Quick Fix 데모 (시나리오 1, 약 2 분)

1. `npm --prefix v3 run dev` (Vite + Electron 개발 모드)
2. 프로젝트 선택 / 생성 후 **Missions** 탭 클릭
3. **⚡ Quick Fix** 카드 → "Launch" → goal 입력 (예: "Fix login button alignment")
4. 미션 상세 화면에서 4 step 시퀀스가 실시간으로 진행되는지 관찰:
   - `/investigate` (gstack subprocess)
   - `fix` (자동 코딩 task 1 개 dispatch + DONE 대기)
   - `/review`
   - `/ship`
5. 종료 상태 `completed` 확인. Timeline 에 supervisor.note `Mission completed`.

### Full Feature 60 초 데모 (시나리오 2)

1. 위와 동일하게 dev 모드 부팅 + Missions 탭
2. **🏛️ Full Feature** 카드 → "Launch" → goal 입력 (강의용 예: "Add dark mode toggle to settings")
3. 화면 녹화 (macOS `Cmd+Shift+5` / OBS) 시작
4. 미션 진행 — 10 step 모두 자동 진행. dispatch+wait 사이에 sleeping → wakeup 까지 관찰
5. 60 초 캡처 종료 (모든 step 끝낼 필요는 없음 — hook 효과만 보여주면 충분)
6. 출력 영상을 `docs/lectures/v3/` 또는 별도 자산 폴더로 이동

### Tier 2 (Pre-launch 데모 회귀) — RUN_MISSION_E2E=1

향후 실제 Electron 자동화가 필요해지면 `tests/e2e/mission-quick-fix.test.ts` 를 추가하고 `RUN_MISSION_E2E=1 npx vitest run tests/e2e/...` 로 게이트. 현재는 시나리오 1/2 모두 사람-운영자가 위 절차로 캡처.

---

## 작업 시 주의 — 정책

- **TaskForce MCP 룰:** 코드 수정 전 반드시 ticket 확인. Step 5b 진입 시 `mcp__taskforce__update_task_status` 로 ticket `96cc0c85` 의 상태 갱신 + 진행마다 `mcp__taskforce__add_activity`. Claude Code 내장 `TaskCreate/TaskUpdate` 사용 금지.
- **사용자 합의 변경 시:** D8/D9/D10/D13 default 를 바꿀 일이 생기면 사용자에게 먼저 확인. 이 문서와 `orchestrator_agent.md` §5 도 함께 갱신.
- **REVIEW 상태 ticket 4 개 건드리지 말 것:** Step 1-4 는 사용자 코드 리뷰 대상. 추가 변경은 사용자 피드백 후.
- **typecheck 분리 빌드:**
  - frontend: `npx tsc --noEmit` (기존 21 개 사전 존재 에러는 onboarding/paymentClient/CodeEditor — mission 무관)
  - electron: `npx tsc -p electron/tsconfig.json --noEmit`
  - mcp-server: `npx tsc -p electron/mcp-server/tsconfig.json --noEmit`
  - flow-engine / orchestrator: 자체 tsconfig (별도 빌드 — Step 5b 에 영향 없음)
- **`templates.ts` 3 중 미러:** frontend (`src/components/missions/templates.ts`), electron mission-engine (`electron/mission-engine/templates.ts`), mcp-server (`electron/mcp-server/tools.ts` 의 `ALLOWED_MISSION_SKILLS`) — 슬래시 명령 / 정책 변경 시 셋 다 함께 갱신.

---

## Q&A 예상

**Q: mission-engine 을 frontend 에서 동작시키면 안 되나?**
A: `OrchestratorRegistry`, `TaskDispatcher` 가 main process API (`OrchestratorManager`, `AgentManager`) 에 의존. renderer 에서 불가능. mission-engine 은 main 에서 동작하고, renderer 는 Firestore subscribe 로만 미션 데이터 본다.

**Q: `MissionStore` 가 main process 자체 firebase 인스턴스를 쓰면 renderer 와 데이터 일관성이 깨지지 않나?**
A: 둘 다 같은 Firestore 백엔드를 보고 있고, 이벤트 기반 subscribe — 데이터 source of truth 는 Firestore. main 이 write → renderer 가 onSnapshot 으로 즉시 받음.

**Q: `MissionLaunchDialog` 가 `status='planning'` 으로 만들어둔 미션을 engine 이 어떻게 pickup 하나?**
A: Step 5b 의 (d) — main.ts 의 `app.whenReady().then(pickupPlanningMissions)` + Firestore tasks/missions onSnapshot 으로 신규 planning 미션 감지 후 `engine.resume(missionId)`.

**Q: D8/D9/D10/D13 default 가 너무 보수적/공격적이지 않나?**
A: 사용자 합의 사항. 변경 시 이 문서 + `orchestrator_agent.md` §5 + ticket 활동 로그도 함께 갱신.

**Q: Step 5 ticket 을 5a/5b 로 분할할 필요 있나?**
A: 명세는 단일 ticket. 다음 에이전트가 본인 판단으로 분해 가능. ticket activity 로그에 5a 완료 명시 — 5b 시작 시 `update_task_status` 로 IN_PROGRESS 유지 + 진행마다 add_activity.

---

## 핸드오프 종료 — 다음 에이전트에게

이 문서 + [`MISSIONS-SPEC.md`](./MISSIONS-SPEC.md) + auto-memory 만 읽으면 self-contained 컨텍스트.
시작점: `mcp__taskforce__get_task(task_id="96cc0c85-2219-4b3b-8f08-194026c30cc4")` 로 활동 로그 확인 후 Step 5b 진행.
