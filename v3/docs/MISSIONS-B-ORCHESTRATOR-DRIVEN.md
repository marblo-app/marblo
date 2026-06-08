# Marblo v3.1 — Mission B안: Orchestrator-Driven Mission (설계 청사진)

**Status:** Proposal / v3.1 design blueprint (구현 전)
**Date:** 2026-06-08
**관계 문서:** [`MISSIONS-SPEC.md`](./MISSIONS-SPEC.md) (§7 = engine-driven = **A안** = 현재 구현·6월 런칭), [`MISSIONS-PROGRESS.md`](./MISSIONS-PROGRESS.md)
**선행 기반:** PR #31 (미션 오케스트레이터 PTY forwarding + 무중단 resume + 상호작용 알림 + in-flight 멱등 복구) — main 머지됨

---

## 0. 의사결정 맥락 (왜 이 문서가 있나)

- **A안(현재)**: MissionEngine 이 결정적 상태머신으로 미션을 진행한다. gstack 스텝은 미션 오케스트레이터 PTY 에서 실행되지만, `fix`/`dispatch` 스텝은 엔진이 Firestore 에 task 를 **직접** 만들고 에이전트를 스폰한다(오케스트레이터 우회). → 경험이 화면(오케 PTY / 에이전트 PTY / 칸반 / 타임라인)으로 **분산**됨.
- **B안(이 문서)**: 미션탭이 **보드처럼 하나의 (스코프된) 오케스트레이터**를 갖고, 미션 오케스트레이터가 미션을 **직접 운전**한다 — gstack 실행 + task 생성·디스패치 + 사용자와의 대화를 모두 자기가. 엔진은 **얇은 지휘자(conductor)** 로 강등되어 **스텝 순서·품질 게이트만 보장**한다.
- **결정:** **6월 런칭은 A안으로 출시·테스트.** 실제 사용에서 "끊김없는 단일 경험"이 부족하다고 판단되면 **B안으로 전환.** 이 문서는 그 전환의 청사진이다 (코드 변경 없음, 설계만).

> **전환 트리거**는 §10 참고. A안의 체감 갭은 [`MISSIONS-SPEC.md`](./MISSIONS-SPEC.md) 부록 A 포지셔닝("AI PM 이 미션을 끝까지 책임진다")과의 거리로 측정한다.

---

## 1. 비전 — 미션탭 = 스코프된 보드+오케스트레이터

마블로 보드는 이미 검증된 패턴이다: **너는 오케스트레이터(Claude 세션)랑 대화하고, 오케스트레이터가 MCP 도구로 task 를 만들고 에이전트를 스폰·코디네이션한다. 너는 에이전트를 구경하되 개별 에이전트와 말 섞을 필요가 없다.**

B안 = **이 패턴을 미션 스코프로 복제**한다.

```
보드          : 열린 대화 → 오케스트레이터 → 에이전트들 (순서·완료정의 없음)
미션 (B안)    : goal + 템플릿 → 미션 오케스트레이터 → 에이전트들 (순서·게이트·완료정의 있음)
```

핵심 통찰: **미션 오케스트레이터 세션은 이미 존재한다** (`OrchestratorManager` `kind="mission"`, 별도 sessionId/MCP config, PTY 패널, resume, forwarding — 전부 PR #31 에서 단단해짐). 지금은 엔진이 그 세션을 **꼭두각시처럼 슬래시 명령만 주입**해 부린다. **B안은 "새로 짓기"가 아니라 "운전석을 엔진 → 그 오케스트레이터로 이전"하는 것.**

---

## 2. A vs B 핵심 차이

| 측면               | A안 (현재 / 런칭)                                                  | B안 (v3.1 청사진)                                                  |
| ------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| 미션 운전자        | MissionEngine (결정적 상태머신)                                    | 미션 오케스트레이터 (추론) + 얇은 지휘자                           |
| gstack 실행        | 엔진이 PTY 에 슬래시 명령 주입 (`PtySkillRunner`)                  | 오케스트레이터가 스스로 실행 (자기 세션)                           |
| task 생성·디스패치 | 엔진이 직접 (`fix-runner`/`dispatcher` → `addDoc` + `dispatchOne`) | 오케스트레이터가 MCP (`create_task`/`dispatch_task`/`spawn_agent`) |
| 사용자 대화 창구   | 분산 (오케 PTY + 개별 에이전트 PTY)                                | **단일 — 미션 오케스트레이터**                                     |
| 에이전트           | 엔진이 소유, 사용자가 개별 소통                                    | 오케스트레이터가 소유, 사용자는 **보기만**(투명성)                 |
| 순서·품질 게이트   | 엔진 상태머신이 **보장**                                           | 지휘자가 **보장** (LLM 자율에 맡기지 않음)                         |
| 진실원             | Firestore `missions/*` (엔진)                                      | Firestore `missions/*` (지휘자) + 오케 세션(대화 연속성)           |
| 재시작 복구        | 멱등 재연결 (findMissionTaskIds)                                   | 세션 resume + 멱등 재연결 (대부분 무료)                            |
| 체감               | gstack 자동 실행은 진짜지만 화면 분산                              | **하나의 연속된 흐름 = 경험**                                      |

---

## 3. 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│ Missions 탭 (UI)                                             │
│  ├ 미션 오케스트레이터 PTY 패널  ← 단일 대화 창구           │
│  ├ 미션 타임라인 (오케 액션 + 지휘자 전이로 파생)           │
│  └ 에이전트 PTY (보기 전용, 스텝에서 열기 버튼 — 투명성)    │
└───────────────┬─────────────────────────────────────────────┘
                │ 사용자 ↔ 오케스트레이터 (대화/ask)
┌───────────────▼─────────────────────────────────────────────┐
│ 미션 오케스트레이터 (Claude 세션, kind="mission")           │
│  · gstack 실행 (/investigate /review /qa /ship ...)         │
│  · MCP: create_task / dispatch_task / spawn_agent / add_activity │
│  · 에이전트 코디네이션 + 사용자 ask 응대                    │
└───────────────┬─────────────────────────────────────────────┘
                │ "스텝 N 끝남" 보고 / "스텝 N+1 진행" 허가
┌───────────────▼─────────────────────────────────────────────┐
│ 지휘자 (Conductor — 슬림해진 엔진)                          │
│  · 템플릿 순서·게이트만 강제 (/review 전 /ship 금지 등)     │
│  · Firestore missions/* 상태 소유 (status/currentStep/timeline)│
│  · 이벤트 wakeup (agent.completed → 다음 게이트 평가)       │
└─────────────────────────────────────────────────────────────┘
```

### 3.1 미션 오케스트레이터 (드라이버)

- **한 스텝 안에서는 자율.** 지휘자가 "이번 스텝: `/investigate`" 라고 허가하면, 오케스트레이터가 자기 세션에서 그 스킬을 실행하고, 필요하면 `create_task`/`dispatch_task` 로 작업을 분해·할당한다.
- **단일 대화 창구.** 큰 결정(소셜 로그인 포함 여부 등)에서 사용자에게 `AskUserQuestion`. 사용자는 미션 PTY 패널에서 응답. 개별 에이전트와 직접 소통 불필요.
- **에이전트 소유.** 오케스트레이터가 스폰했으니 자기 자식들을 알고, 진행을 `add_activity` 로 미션 타임라인에 내레이션한다("react-1 에 맡겼고 완료되면 review 돌릴게").

### 3.2 지휘자 (슬림해진 엔진) — **게이트 보장이 존재 이유**

보드는 정해진 순서가 없지만 **미션은 약속된 프로세스**가 있다 (`full-feature`: `/office-hours → ... → /review → /qa → /ship`, 완료정의 = PR merged). LLM 단독 운전은 **게이트를 건너뛸 수 있다**(/qa 생략하고 /ship 등). 지휘자는 이걸 막는다:

- 템플릿 시퀀스를 **스텝 단위 권한**으로 노출: 오케스트레이터는 현재 스텝만 진행, 끝나면 지휘자에 보고 → 지휘자가 게이트 통과 검증 후 다음 스텝 허가.
- 상태머신(`state-machine.ts`)·`missions/*` 진실원은 **지휘자가 계속 소유** (A안에서 그대로 가져옴).
- 게이트 예: "review 결과가 통과인가?", "qa 통과 전 ship 금지", "dispatch 된 task 전부 DONE 인가(wait)".

> 핵심 원칙: **스텝 *안*은 오케스트레이터의 자율(=B의 경험), 스텝 *사이*는 지휘자의 결정성(=A의 보장).**

### 3.3 진실원 & 상태 파생

- **진실원은 여전히 Firestore** (`missions/*`, `tasks/*`). 오케스트레이터의 LLM 기억은 진실원이 아니라 _대화 연속성_ 제공.
- 미션 타임라인 = (a) 오케스트레이터의 MCP 액션(`add_activity`, task 상태 전이) + (b) 지휘자의 스텝 전이. 둘을 합쳐 **하나의 서사**로 렌더.
- 재시작 복구: 세션 resume(대화) + `findMissionTaskIds`(task 재연결, PR #31 에서 구현됨) → 대부분 무료.

### 3.4 에이전트 소유/가시성

- 에이전트는 **오케스트레이터가 MCP 로 스폰** → 오케스트레이터가 소유·코디네이션.
- 사용자는 에이전트 PTY 를 **보기만** (미션 스텝의 "🖥️ 에이전트 PTY" 버튼 — TaskForce `a38b5c8e`). 소통은 오케스트레이터로 일원화.

---

## 4. 이미 있는 것 (재사용) vs 새로 필요한 것

### 재사용 (PR #31 + 보드 인프라)

- ✅ 미션 오케스트레이터 세션: `OrchestratorManager` `kind="mission"`, `ensureMissionOrchestratorLaunched()` (main.ts), `orch-registry-impl.ts` `ensureSession`.
- ✅ PTY forwarding + resume + 상호작용 알림 (PR #31).
- ✅ 오케스트레이터 MCP 도구: `create_task` / `create_tasks_bulk` / `dispatch_task` / `spawn_agent` / `run_skill` / `add_activity` / `get_projection` (보드 오케스트레이터가 이미 사용).
- ✅ `findMissionTaskIds(missionId)` (dispatcher) — taskId 역추적용.
- ✅ `run_skill` allowlist (MISSIONS-SPEC §8) — 허용 슬래시만 안전 실행.
- ✅ 상태머신 / `missions/*` 스키마 / `waiting_for_human` / 미션 PTY 패널.

### 새로 필요한 것

- 🔧 `orchestrator_agent.md` 에 **미션 진행 룰**(헌법) 추가/강화 — §6.
- 🔧 **지휘자 인터페이스**: "스텝 N 진행 허가 / 게이트 검증 / 다음 스텝" 루프. 현재 `MissionEngine` 의 advance-loop 를 *오케스트레이터에 위임 + 게이트 검증*으로 재편.
- 🔧 **오케스트레이터 → 지휘자 보고 채널**: 스텝 완료/실패 신호. (MCP `submit_for_review` 류 도구 또는 전용 `mission_step_done` 도구, 또는 task 상태 구독.)
- 🔧 **taskId 태깅 보장**: 오케스트레이터의 `create_task` 가 `missionId`/`contextId` 를 반드시 태깅(MCP 컨텍스트). 안 그러면 `findMissionTaskIds` 가 못 잡음.
- 🔧 **타임라인 파생 로직**: 오케 액션 + 지휘자 전이 → 단일 타임라인.

---

## 5. 핵심 난제 & 해법

### 5.1 게이트 보장 (가장 큰 리스크)

**문제:** LLM 오케스트레이터가 /review·/qa 건너뛰거나 순서 바꿈.
**해법:** 지휘자가 스텝을 **한 번에 하나만** 허가. 오케스트레이터는 "현재 스텝" 컨텍스트만 받고, 완료를 보고하면 지휘자가 **게이트 조건(결과/산출물)을 검증**한 뒤에야 다음 스텝 허가. 게이트는 결정적 코드(예: wait = `getTaskStatuses` 전부 DONE, ship = PR URL 존재).

### 5.2 taskId 역추적

**문제:** 오케스트레이터가 만든 task 를 지휘자가 알아야 wait/진행률 추적 가능.
**해법:** (a) MCP `create_task` 가 `missionId` 태깅(MCP 컨텍스트 `MARBLO_CONTEXT`) → (b) `findMissionTaskIds(missionId)` 로 조회(이미 구현). dispatch 스텝 후 지휘자가 이걸로 `mission.taskIds` 동기화.

### 5.3 중간 ask

**문제:** 미션 도중 사용자 결정 필요.
**해법:** 오케스트레이터가 `AskUserQuestion` → mission `waiting_for_human` 전이 + 알림(PR #31 의 `notifier`/`mission:needsInput` 재사용). 사용자는 **미션 PTY 패널에 직접 답** → 오케스트레이터가 이어감. (보드 오케스트레이터의 대화 방식 그대로.)

### 5.4 진행/타임라인 파생

**해법:** 오케스트레이터가 단계마다 `add_activity` 로 내레이션 + task 상태 구독 → 지휘자가 `contextLog` timeline 이벤트로 합성. UI 는 단일 타임라인 렌더.

### 5.5 장기 실행 일관성 (며칠~몇 주)

**문제:** 컨텍스트 윈도우 / 다중 턴 드리프트.
**해법:** `orchestrator_agent.md` 를 "헌법"으로 매 wakeup 재주입(get_agent_skill). 미션 상태는 Firestore 진실원이라 세션이 흐려져도 지휘자가 현재 스텝/게이트를 다시 알려줌. sleeping ↔ event wakeup(D 이벤트) 로 토큰 절약.

### 5.6 데모 결정성 (강의 60초)

**해법:** 데모 시나리오는 게이트가 결정적이라 순서가 보장됨. 오케스트레이터 자율은 스텝 *안*에만 있어 카메라 앞에서 단계를 건너뛰지 않음.

---

## 6. `orchestrator_agent.md` (헌법) 변경 — 미션 진행 룰

MISSIONS-SPEC §8 의 룰을 **B안용으로 강화**한다 (요지):

```markdown
### Mission 진행 (B안)

- 미션 시작 시 (지휘자가 시스템 메시지로 goal + 템플릿 + "현재 스텝" 알림),
  너는 미션 오케스트레이터로서 현재 스텝만 진행한다.
- 현재 스텝 안에서는 자율: gstack 실행 / create_task·dispatch_task 로 분해·할당 /
  에이전트 코디네이션. 진행은 add_activity 로 미션 타임라인에 내레이션.
- 스텝을 마치면 지휘자에 보고(<보고 도구>)하고 다음 허가를 기다린다.
  스스로 다음 스텝(예: /ship)으로 넘어가지 않는다 — 순서·게이트는 지휘자 권한.
- 큰 결정에서만 AskUserQuestion. 매 스텝 확인 금지.
- 에이전트와는 네가 소통한다. 사용자는 너하고만 대화한다.
- 만든 모든 task 는 missionId 를 태깅한다(MCP 컨텍스트 자동).
```

---

## 7. UX

- **단일 미션 오케스트레이터 PTY** 가 미션탭의 대화 표면(이미 존재). 사용자는 여기 대고 묻고 답한다.
- **에이전트 PTY 는 스텝에서 열어 구경**(TaskForce `a38b5c8e`) — 디버깅/투명성용, 소통은 오케로.
- **미션 타임라인 = 하나의 서사** (오케 내레이션 + 게이트 전이).
- 칸반 = 미션 task 카드(🎯 뱃지, 기존 컨벤션 유지).

---

## 8. A→B 마이그레이션 단계 (점진)

1. **헌법 준비:** `orchestrator_agent.md` 미션 룰(B) 작성 + `run_skill`/`create_task` 미션 태깅 검증.
2. **지휘자 골격:** `MissionEngine` 을 "스텝 허가 + 게이트 검증" 루프로 재편 (advance-loop → grant/verify). 상태머신·`missions/*` 소유는 유지.
3. **운전 이전 (스텝별로):** gstack 스텝부터 오케스트레이터 자율 실행으로(이미 PTY 에서 도니 위험 낮음). 그다음 `fix`/`dispatch` 를 오케 MCP 생성으로 전환 — `findMissionTaskIds` 로 지휘자가 taskId 동기화.
4. **보고 채널:** 오케 → 지휘자 스텝완료 신호 도구/구독.
5. **타임라인 합성 + UI.** 단일 서사 렌더.
6. **회귀:** 데모 시나리오 e2e 로 게이트 순서 보장 확인 + 토큰/지연 벤치.

> 각 단계가 독립적으로 검증 가능하도록, A안 코드(엔진 직접 생성)는 feature flag 뒤에 남겨 롤백 경로 확보.

---

## 9. 리스크 & 미티게이션 요약

| 리스크                     | 미티게이션                                           |
| -------------------------- | ---------------------------------------------------- |
| LLM 이 게이트/순서 건너뜀  | 지휘자가 스텝 단위 허가 + 결정적 게이트 검증 (§5.1)  |
| 오케가 만든 task 추적 불가 | missionId 태깅 + `findMissionTaskIds` (§5.2)         |
| 장기 미션 드리프트         | 헌법 재주입 + Firestore 진실원 + event wakeup (§5.5) |
| 토큰 비용(연속 세션)       | sleeping/wakeup, 컨텍스트 요약                       |
| 데모에서 단계 누락         | 게이트 결정성 (§5.6)                                 |
| 대규모 변경 리스크         | feature flag + 스텝별 점진 이전 + A 롤백 경로 (§8)   |

---

## 10. A→B 전환 트리거 (언제 B로 가나)

다음 중 하나라도 런칭 후 관찰되면 B 전환 검토:

- 사용자가 **개별 에이전트와 직접 소통**해야 미션이 굴러간다(단일 창구 실패).
- 화면 분산으로 "지금 미션이 뭐 하는지" 한 화면에서 안 보인다는 피드백 반복.
- 미션이 **스크립트처럼 느껴지고** AI PM 의 *판단*이 없다는 인상(부록 A 포지셔닝 갭).
- A안 UI 통합(에이전트 PTY 버튼 + 단일 타임라인 + 오케 내레이션)으로도 체감이 안 메워짐.

> 반대로 A + UI 통합으로 충분하면 B 는 보류해도 된다. 이 문서는 "필요할 때 바로 꺼내는 청사진"이다.

---

## 11. NOT in scope (이 문서)

- 실제 구현 코드 (별도 v3.1 티켓).
- 사용자 정의 템플릿 / 마켓플레이스 (MISSIONS-SPEC 부록 B).
- 멀티 미션 동시 운전의 오케스트레이터 격리 세부 (kind="mission" 세션은 projectId 단위라 기본 격리됨; 동일 프로젝트 2 미션 동시 = 후속 검토).

---

## 12. 회귀 · 벤치

> Phase 5-B. §8-6("회귀: 데모 시나리오 e2e 로 게이트 순서 보장 확인 + 토큰/지연 벤치")의 운영 절차. 두 층으로 나눈다 — **(a) LLM 없이 결정적인 회귀 스위트**(CI 상시)와 **(b) 실 LLM 라이브 벤치**(수동/주기). 단위테스트는 지휘자 운전 _사이클의 오버헤드_(게이트·전진·store 왕복)만 결정적으로 지킬 수 있고, 실제 *토큰 비용·체감 지연*은 실 오케 세션이 있어야 측정된다 — 둘의 경계가 이 절의 핵심이다.

### 12.1 결정적 회귀 e2e (LLM 없이 · CI 상시)

B안 운전 계약을 in-memory fake(store/orch/eventBus)로 end-to-end 고정한다. 실시간·랜덤 의존이 없어 flaky 하지 않다.

| 스위트 (Phase)          | 파일                                           | 무엇을 지키나                                                                                             |
| ----------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Phase 3 — 풀 루프       | `tests/unit/mission-b-e2e.test.ts`             | grant→report→gate→advance→complete 전 구간 + 게이트 fail→retry/escalate + wait(task 완료) 게이트          |
| Phase 4 — 타임라인 합성 | `tests/unit/mission-timeline-synth.test.ts`    | forwarder 신호(task.status_changed/activity_logged) → contextLog `task.status`/`task.activity` 합성·dedup |
| Phase 5 — 데모 시나리오 | `tests/unit/mission-b-demo-regression.test.ts` | 강의 데모 시나리오(템플릿 풀루프)의 **게이트 순서 보장** — 단계 누락/역순 회귀 차단 (§5.6)                |
| Phase 5 — 지휘자 벤치   | `tests/unit/mission-b-conductor-bench.test.ts` | full-feature(10스텝) **N미션**을 completed 까지 구동 — 전부 완주 + 스텝 순서 보존 + 운전 오버헤드 회귀    |

실행:

```bash
cd v3 && npx vitest run \
  tests/unit/mission-b-e2e.test.ts \
  tests/unit/mission-timeline-synth.test.ts \
  tests/unit/mission-b-demo-regression.test.ts \
  tests/unit/mission-b-conductor-bench.test.ts
```

**지휘자 벤치(`mission-b-conductor-bench`)의 성격:** 정확성은 _엄격히_ 단정하고(전부 completed, `currentStepIndex===steps.length`, `step.started` 인덱스 `0..9` 오름차순), 타이밍은 _informational_ 로그(`총 / 미션당 / 스텝당 ms`) + **관대한** 스모크 실링(미션당 400ms 예산 — 실측은 보통 한 자릿수 ms)만 둔다. 타이트한 perf 게이트는 CI flaky 의 원인이라 두지 않는다. 이 실링은 운전 루프가 O(n²)/블로킹으로 무너지는 _catastrophic_ 회귀만 잡는 안전망이다.

### 12.2 라이브 토큰/지연 벤치 (실 LLM · 수동/주기)

**왜 단위테스트로 못 잡나:** 위 벤치는 미션 오케스트레이터를 fake(LLM 없음)로 대체하므로 *지휘자 사이클 오버헤드*만 측정한다. 실제 지배적 비용 — **오케 세션의 토큰 소비**(컨텍스트 크기·추론 토큰·다중 턴 드리프트, §5.5)와 **스텝 체감 지연**(LLM 추론 시간) — 은 실 Claude 세션이 돌아야만 발생한다. 따라서 이 층은 단위테스트가 아니라 실행 절차로 측정한다.

**절차:**

1. **드라이버 플립 + 앱 재시작.** `MISSION_DRIVER=orchestrator` 로 설정(`getMissionDriver()` 가 main 프로세스에서 `process.env.MISSION_DRIVER` / fallback `VITE_MISSION_DRIVER` 를 **엔진 생성 시 1회** 읽으므로 재시작 필수). Docker 운영 시 compose env 에 주입 후 `docker compose up -d --build`; 로컬 dev 면 launch 전 `export MISSION_DRIVER=orchestrator`. 미설정/오타는 안전하게 `engine`(A안)으로 폴백한다.
2. **데모 시나리오 실행.** 미션탭에서 `feature`(6스텝) 또는 `full-feature`(10스텝) 템플릿으로 미션을 시작하고 끝까지(또는 대표 구간까지) 굴린다. 동일 시나리오를 A안(`engine`)으로도 한 번 돌려 **A vs B 대조군**을 만든다.
3. **측정 항목(어디서 보나):**
   - **토큰** — 미션 오케스트레이터 세션(`kind="mission"` PTY)의 토큰/비용. Claude 세션 statusline·cost 표시 + 텔레메트리(BigQuery 1차 수집, `telemetry_privacy_policy`) 의 세션 단위 토큰. A안은 오케 PTY 가 슬래시 명령만 받으므로 토큰이 얇고, B안은 오케가 자율 운전하므로 더 두껍다 — 이 **증분**이 B안의 진짜 비용.
   - **스텝 지연** — `missions/*` 의 `contextLog` 에서 각 스텝의 `step.started` ↔ `step.completed` 타임스탬프(`ts`) 차이. 미션 타임라인 UI 가 스텝 전이를 렌더하므로 육안으로도 확인 가능. 지휘자 게이트 왕복 지연(결정적, 위 단위벤치로 회귀 감시)과 LLM 추론 지연(여기서만 측정)을 분리해서 본다.
   - **드리프트/재주입 비용** — 장기 미션에서 헌법 재주입(get_agent_skill) + 컨텍스트 요약 빈도(§5.5). 세션이 길어질수록 턴당 토큰이 증가하는지 추세를 본다.
4. **합격선(소프트):** B안 토큰 증분이 "끊김없는 단일 경험"(§1·§10 전환 트리거)이 주는 가치 대비 수용 가능한지를 _정성_ 판단한다. 토큰/지연에 하드 게이트를 걸지 않는다 — 모델·시나리오·컨텍스트에 따라 변동이 크기 때문. 회귀의 _결정적_ 부분(순서·완주·사이클 오버헤드)은 §12.1 이, _확률적_ 부분(토큰·체감)은 이 라이브 절차가 나눠 책임진다.

---

## 부록 — 관련 코드 앵커 (v3.1 구현자용)

| 관심사                                                  | 위치                                                     |
| ------------------------------------------------------- | -------------------------------------------------------- |
| 미션 오케스트레이터 세션 보장(launch+forwarding+resume) | `electron/main.ts` `ensureMissionOrchestratorLaunched()` |
| 오케스트레이터 registry / ensureSession                 | `electron/mission-engine/orch-registry-impl.ts`          |
| gstack PTY 실행 (A안, B에서 오케 자율로 이전)           | `electron/mission-engine/pty-skill-runner-impl.ts`       |
| 엔진 advance-loop (B에서 지휘자로 재편)                 | `electron/mission-engine/index.ts`                       |
| 상태머신 / 게이트 기반                                  | `electron/mission-engine/state-machine.ts`               |
| task 생성 (A안 직접 → B 오케 MCP)                       | `fix-runner-impl.ts`, `dispatcher-impl.ts`               |
| taskId 역추적                                           | `dispatcher-impl.ts` `findMissionTaskIds`                |
| 오케스트레이터 헌법                                     | `v3/skills/orchestrator_agent.md`                        |
| 상호작용 알림(재사용)                                   | PR #31 `notifier` / `mission:needsInput`                 |
| 미션 PTY 패널                                           | `src/components/missions/MissionOrchestratorPanel.tsx`   |
