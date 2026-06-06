# Autonomy Dial & Exception-based Inbox — Design Spec

**Status:** Draft for review / 설계 승인 대기
**Target:** v3.x — 엔터프라이즈 거버넌스 트랙 (worktree-per-task 머지 코크핏 위에 적층)
**Owner:** v3 product
**Spec date:** 2026-06-06
**Builds on:** `v3/docs/specs/2026-05-28-orch-live-awareness-design.md` (projection 레이어), `v3/docs/WORKTREE-SPEC.md` (머지 코크핏), `v3/docs/MISSIONS-SPEC.md`

---

## 1. 한 줄 요약

오케스트레이터는 자율로 유지하되, 사람은 **매 task(hot path)가 아니라 정책이 정의한 위험 경계에서만** 개입한다. 프로젝트별 **자율성 다이얼(L0/L1/L2)** 이 기본 게이트를 정하고, **검증 게이트**가 사람 승인을 자동으로 대체하며, 정책을 트립한 작업만 **예외 기반 인박스**로 비동기 에스컬레이션된다. 인박스가 비어 있는 것이 정상 상태다.

---

## 2. 배경 (문제 정의 / why now)

머지 코크핏(`feat/worktree-per-task-merge-cockpit`)으로 "에이전트 diff는 격리된 워크트리를 거쳐야만 랜딩된다"는 통제점은 확보됐다. 하지만 현재 머지는 **전부 수동**이다 (`WorktreeTab.tsx:85-120`에서 사람이 "Merge" 클릭). 이대로 엔터프라이즈에 가면 두 갈래로 다 실패한다:

- **매 task 사람 승인** → 오케스트레이터 컨셉 자살. 휴먼 개입이 속도의 배리어가 됨.
- **승인 없는 완전 자율** → 보안/컴플라이언스가 도입을 막음. "에이전트가 prod를 누가 허락했나"에 답할 수 없음.

해법은 둘 중 하나를 고르는 게 아니라 **다이얼**이다: 신뢰는 자동화(검증 게이트)하고, **예외만** 사람에게 던진다. 그리고 그 예외의 경계는 프로젝트마다 미리 설정해 둔다. 이 구조는 도입 장벽을 낮추고(L0로 시작) 신뢰가 쌓이면 확장(L1→L2)하는 **land-and-expand** 어돕션 곡선을 제품에 내장한다.

기존 인프라가 이미 대부분의 substrate를 제공한다:

- **projection 레이어**(`electron/mcp-server/projection.ts`)의 HIGH 우선순위 wake 이벤트(`blocked`/`failed`/`submit_for_review`)가 그대로 인박스 피드가 된다.
- **audit log**(`electron/mcp-server/tools.ts:138-153`)가 모든 MCP 도구 호출을 이미 기록한다.
- **worktree status**(`src/types/worktree.ts`)의 `mergeable`/`conflicts`/`ahead`/`behind`가 머지 가능성 신호를 제공한다.
- **`Project.enabledModels`**(`src/types/project.ts`)처럼 per-project config가 이미 dispatch 체인에 주입된다.

---

## 3. 컨셉 정의

### 3.1 자율성 다이얼 (Autonomy Dial)

프로젝트(또는 task별 오버라이드)마다 설정하는 3단 자율 레벨. 머지 준비가 된 task(`REVIEW` + worktree `mergeable`)가 **자동 머지될지 / 인박스로 에스컬레이션될지**의 기본값을 정한다.

| 레벨   | 이름                               | 동작                                                                                                      | 인박스에 뜨는 것                         | 적합 시점                 |
| ------ | ---------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------- |
| **L0** | 수동 게이트                        | 모든 머지를 사람이 승인. 에이전트는 `submit_for_review`에서 정지.                                         | 모든 `REVIEW` task                       | 도입 초기, 의심 많은 repo |
| **L1** | 검증 게이트 + 예외 승인 _(기본값)_ | 검증 게이트 통과 시 자동 머지. 정책 가드레일 트립 시에만 에스컬레이션.                                    | 정책 트립 / 검증 실패 / blocked / failed | 대부분의 repo             |
| **L2** | 완전 자율                          | 검증 게이트만으로 자동 머지. 자동 처리 가능한 정책(예: auto-rebase)은 자동. 사람은 감사 로그로 사후 확인. | `block` severity 정책만 (prod·시크릿 등) | 신뢰 쌓인 repo            |

> **불변식 (D4):** `severity: "block"` 정책은 autonomy level과 무관하게 **항상** 에스컬레이션된다. L2여도 prod 경로/시크릿 접근은 막힌다. 다이얼은 자율을 올리지만, hard-block 정책은 다이얼 위에 군림한다.

### 3.2 검증 게이트 (Verify Gate) — 사람 승인을 *대체*하는 메커니즘

프로젝트별로 **미리 설정**해 두는 자동 검사 체인. 통과하면 사람 승인 없이 머지 자격을 얻는다. 매 task 사람 승인을 이걸로 치환한다.

검사 종류(`VerifyCheck`):

- `ci` — worktree `mergeable === true` + 테스트 그린
- `review-agent` — `/review` 또는 `/code-review` 스킬 에이전트 스폰 → pass/fail 게이트
- `security-scan` — `/cso` 스킬
- `skill` / `command` — 임의 커스텀 게이트

각 검사는 `required`(게이트 차단) 또는 advisory(경고만). 모든 `required` 검사가 통과해야 자동 머지 자격.

### 3.3 정책 가드레일 (Policy Guardrails) — "언제 사람을 부를지" 정의

머지 직전, task/diff/worktree/비용 신호에 매칭되는 규칙 집합. 트립하면 severity에 따라 행동한다.

- `match` 조건: 경로 glob(`**/prod/**`, `**/*.env`), 변경 종류(`schema`/`infra`/`secret`/`dependency`), 비용 임계치, 에이전트 confidence 하한, 시크릿 접근 여부
- `severity`: `block`(항상 에스컬레이션) · `review`(L2 외에는 에스컬레이션) · `warn`(로그만)

정책은 검증 게이트와 직교한다: **검증 게이트 = "코드가 좋은가"**, **정책 가드레일 = "이건 사람이 봐야 하는 위험인가"**.

### 3.4 예외 기반 인박스 (Exception-based Inbox)

projection의 HIGH 이벤트 + 게이트 에스컬레이션으로 채워지는 비동기 큐. **모든 걸 담는 큐가 아니라, 위험 경계를 넘은 것만** 담긴다.

- **비동기·논블로킹 (D5):** 에스컬레이션된 task **하나만** 대기. 나머지 플릿은 계속 흐른다. 미션은 다른 runnable task가 없을 때만 `waiting_for_human`으로 전이.
- **빈 상태 = 성공 상태 (D6):** 설정이 좋으면 대부분의 날 비어 있다. 빈 상태를 축하하는 UX.
- **circuit breaker, not toll booth:** 매번 통행료가 아니라 이상 시 차단.

---

## 4. 결정 흐름 (게이트 엔진)

머지 준비가 된 모든 task에 대해 평가한다:

```
task가 REVIEW 도달 + worktree.status 계산됨
  │
  ├─ 정책 평가 (evaluatePolicies)
  │    ├─ `block` 정책 트립?  ──────────────► 인박스 (severity=block)  [레벨 무관]
  │    └─ `review` 정책 트립? ──► (L2 && 자동승인 카테고리?) 아니면 ──► 인박스 (severity=review)
  │
  ├─ 검증 게이트 (runVerifyGate: required 검사 전부 통과?)
  │    └─ 실패 ──► onFailure 정책(retry|escalate) → retry 소진 시 인박스 (verify_failed)
  │
  └─ 정책 클린 + 검증 통과
       ├─ level >= L1 ──► 자동 머지 (squash) ──► DONE + audit
       └─ level == L0 ──► 인박스 (manual_gate)
```

핵심: **L1에서 정상 경로는 사람을 전혀 거치지 않는다.** 신뢰는 자동화되고 예외만 떠오른다.

---

## 5. 데이터 모델

### 5.1 `Project` 확장 — `src/types/project.ts`

```ts
export type AutonomyLevel = "L0" | "L1" | "L2";

export interface Project {
  // ...existing fields (enabledModels 등과 동일한 패턴으로 주입)
  autonomyLevel?: AutonomyLevel; // default "L1"
  verifyGate?: VerifyGateConfig; // 미설정 시 { checks: [ci(required)] } 기본
  policies?: PolicyRule[]; // 미설정 시 빌트인 기본 정책 세트
}
```

### 5.2 신규: `src/types/autonomy.ts`

```ts
export type AutonomyLevel = "L0" | "L1" | "L2";

// --- 검증 게이트 ---
export interface VerifyGateConfig {
  checks: VerifyCheck[];
}
export interface VerifyCheck {
  id: string; // "ci" | "review-agent" | "security-scan" | custom
  kind: "ci" | "skill" | "command";
  skill?: string; // 예: "/review", "/cso"
  command?: string; // kind === "command"
  required: boolean; // true=게이트 차단, false=advisory
  label: string;
}

// --- 정책 가드레일 ---
export type PolicySeverity = "block" | "review" | "warn";
export type ChangeKind = "schema" | "infra" | "secret" | "dependency" | "prod";

export interface PolicyRule {
  id: string;
  name: string;
  enabled: boolean;
  severity: PolicySeverity; // block: 항상 에스컬레이션(L2도)
  match: PolicyMatch;
}
export interface PolicyMatch {
  pathGlobs?: string[]; // ["**/prod/**", "**/*.env", "infra/**"]
  changeKinds?: ChangeKind[];
  costUsdOver?: number; // task 누적 비용 > N
  confidenceUnder?: number; // 에이전트 자가 confidence < N (0..1)
  touchesSecrets?: boolean;
}

// --- 게이트 평가 결과 ---
export interface GateDecision {
  action: "auto_merge" | "escalate";
  reason: ExceptionReason;
  severity: PolicySeverity;
  policyId?: string;
  failedChecks?: string[]; // verify_failed 시
}
```

### 5.3 신규: `src/types/inbox.ts`

```ts
import type { PolicySeverity } from "./autonomy";
import type { WorktreeStatus } from "./worktree";

export type ExceptionReason =
  | "policy_block"
  | "policy_review"
  | "verify_failed"
  | "task_blocked" // projection HIGH 이벤트 재활용
  | "task_failed"
  | "manual_gate"; // L0

export interface ExceptionItem {
  id: string;
  taskId: string;
  missionId: string;
  projectId: string;
  reason: ExceptionReason;
  severity: PolicySeverity;
  policyId?: string;

  surfacedAt: Timestamp;
  summary: string; // projection.lastActivitySummary 재활용
  diffStat?: { files: number; additions: number; deletions: number };
  worktreeStatus?: WorktreeStatus;
  failedChecks?: string[];

  suggestedAction?:
    | "approve_merge"
    | "reject_kickback"
    | "resolve_conflict"
    | "adjust_policy";

  status: "open" | "approved" | "rejected" | "auto_resolved";
  resolvedBy?: string; // userId | "system"
  resolvedAt?: Timestamp;
  resolutionNote?: string;
}
```

---

## 6. Firestore 컬렉션 / 보안 규칙

| 컬렉션 / 필드                                             | 목적                      | 비고                                                                     |
| --------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------ |
| `projects/{id}.autonomyLevel`, `.verifyGate`, `.policies` | 다이얼·게이트·정책 config | 기존 project 문서에 필드 추가                                            |
| `missions/{id}/inbox/{itemId}`                            | 예외 인박스 항목          | 미션 스코프; 전역 뷰는 collectionGroup 쿼리                              |
| `auditLog/{entryId}` _(append-only)_                      | 불변 감사 로그            | **update/delete 거부 보안 규칙**; 게이트 결정·머지·인박스 처리 전부 기록 |

보안 규칙 핵심:

- `auditLog`: `allow create; allow read; allow update, delete: if false;` — 1차로 append-only 강제. (해시 체인 tamper-evident는 §11 후속)
- `projects/.../policies`, `.autonomyLevel`: 프로젝트 멤버 중 거버넌스 권한자만 write (RBAC는 §11 후속, v1은 owner/members).

인덱스: `inbox` collectionGroup `(status==open, severity desc, surfacedAt asc)` — 전역 인박스 정렬.

---

## 7. 게이트 엔진 — `electron/mission-engine/autonomy-gate.ts` (신규)

```ts
export async function evaluateMergeGate(args: {
  task: Task;
  worktree: WorktreeStatus;
  project: Project;
  diff: DiffSummary;
  agentConfidence?: number;
}): Promise<GateDecision>;
```

- 호출 지점: task가 `REVIEW`에 도달하고 worktree status가 계산된 직후 (오케스트레이터의 task 완료 폴링 루프, `pty-skill-runner-impl.ts` 인근).
- `action === "auto_merge"` → 기존 클린 머지 경로 재사용(`WorktreeCoordinator` / `useWorktreeStore.merge` 의 electron측 로직) → `update_task_status(DONE)` → audit 기록.
- `action === "escalate"` → `missions/{id}/inbox`에 `ExceptionItem` 생성, task는 `REVIEW` 유지, audit 기록. 미션은 다른 runnable task 없을 때만 `waiting_for_human`.

순수 평가 함수(`evaluatePolicies`, `decideAction`)는 I/O 없이 단위 테스트 가능하게 분리.

---

## 8. 상태 머신 변경

현재(`electron/mcp-server/tools.ts:34-48` VALID_TRANSITIONS, `state-machine.ts`)는 `REVIEW → DONE`이 수동.

| 전이                              | 현재                              | 변경 후                                                                                          |
| --------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------ |
| `REVIEW → DONE`                   | 사람이 WorktreeTab에서 Merge 클릭 | 게이트 엔진이 `auto_merge` 결정 시 시스템이 수행 (L1/L2). L0는 인박스 승인 경유.                 |
| `REVIEW → REVIEW (escalated)`     | —                                 | 신규: 에스컬레이션 시 `ExceptionItem` 생성, task는 REVIEW 유지 (상태 자체는 불변, 인박스가 추적) |
| 미션 `active → waiting_for_human` | —                                 | 신규: 인박스 항목이 critical path이고 다른 runnable task 없을 때만                               |

> task 상태에 새 enum을 추가하지 않는다 (D8 후보). 에스컬레이션은 `REVIEW` 위의 사이드 채널(`ExceptionItem`)로 표현 → 기존 상태 머신 불변성 유지. 인박스 승인 = `REVIEW→DONE` 트리거, 반려 = `add_pending_instruction` + `REVIEW→IN_PROGRESS`(기존 kickback 경로 `WORKTREE-SPEC.md §6` 재사용).

---

## 9. UI 명세

### 9.1 ExceptionInboxPanel (신규) — `src/components/missions/ExceptionInboxPanel.tsx`

- 전 미션/프로젝트 횡단 전역 인박스. projection 실시간 구독 재활용.
- **빈 상태가 1급 시민:** "🟢 모든 작업이 자율적으로 흐르고 있습니다 — 검토할 예외 없음" (성공 상태 축하).
- severity 그룹핑: 🔴 block · 🟠 review · 🟡 verify_failed/blocked.
- 항목 카드: task 제목 · reason 배지 · diff stat · worktree status pill(🟢/🟡/🔴, WorktreeTab과 동일 어휘) · 트립한 정책명.
- 액션: **승인 & 머지** / **반려(kickback)** / **충돌 해결(Resolve 에이전트 스폰)** / **정책 조정**.
- 모든 액션은 `auditLog`에 `resolvedBy` 기록.

### 9.2 자율성 다이얼 컨트롤 — 프로젝트 설정

- 3단 다이얼 (L0—L1—L2), 각 레벨 설명 + "지금 이 프로젝트에서 일어나는 일" 미리보기.
- 검증 게이트 체크리스트 에디터 (`VerifyCheck` 추가/required 토글).
- 정책 규칙 리스트 (빌트인 기본 + 커스텀, severity·match 편집).

### 9.3 WorktreeTab과의 관계

- **WorktreeTab = 전체 뷰** (모든 워크트리/머지 상태), **ExceptionInbox = 예외 뷰** (게이트가 사람을 부른 것만). 같은 worktree/projection 데이터를 다른 렌즈로.

---

## 10. 변경 위치 (구현 인벤토리)

| 영역              | 파일                                                                             | 변경                                                      |
| ----------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 타입              | `src/types/project.ts`                                                           | `autonomyLevel`/`verifyGate`/`policies` 추가              |
| 타입(신규)        | `src/types/autonomy.ts`, `src/types/inbox.ts`                                    | 게이트·정책·인박스 모델                                   |
| 게이트 엔진(신규) | `electron/mission-engine/autonomy-gate.ts`                                       | `evaluateMergeGate` + 순수 평가 함수                      |
| 오케스트레이터    | `electron/mission-engine/pty-skill-runner-impl.ts`                               | REVIEW 도달 시 게이트 호출 + 자동 머지/에스컬레이션 분기  |
| 머지              | `electron/worktree-coordinator.ts`, `src/components/tabs/WorktreeTab.tsx:85-120` | 시스템 자동 머지 경로 노출(기존 클린 머지 재사용)         |
| projection        | `electron/mcp-server/projection.ts`                                              | HIGH 이벤트 → 인박스 항목 생성 훅                         |
| audit             | `electron/mcp-server/tools.ts:138-153`                                           | 게이트 결정·인박스 처리 기록, append-only 컬렉션화        |
| config 주입       | `electron/bridge-server.ts:127-192`                                              | `enabledModels` 옆에 `autonomyLevel`/`policies` 룩업 주입 |
| 상태 머신         | `electron/mcp-server/tools.ts:34-48`, `electron/mission-engine/state-machine.ts` | 자동 `REVIEW→DONE`, `waiting_for_human` 조건부 전이       |
| UI(신규)          | `src/components/missions/ExceptionInboxPanel.tsx`                                | 예외 인박스                                               |
| UI                | 프로젝트 설정 화면                                                               | 자율성 다이얼 + 검증 게이트 + 정책 에디터                 |
| store/service     | `src/stores/projectStore.ts`, `src/services/projectService.ts`                   | autonomy config CRUD                                      |

---

## 11. 비목표 (v1 제외 → 후속)

- **회고 → 가드레일/스킬 자동 생성 루프** (`/learn`·`/retro` 기반): 별도 트랙.
- **Tamper-evident 해시 체인 감사 로그**: v1은 append-only 보안 규칙까지. 해시 체인은 후속.
- **RBAC 승인 라우팅** (누가 어떤 카테고리를 승인할 권한): v1은 owner/members. 역할 기반 라우팅·에스컬레이션 체인은 후속.
- **Trust ratchet** (K회 연속 무반전 자동 머지 시 L1→L2 자동 제안): land-and-expand 메커닉, v1.1 후보.
- **비용→outcome→ROI 대시보드**: usage 컴포넌트 위에 별도 스펙.

---

## 12. 테스트 플랜 (TDD)

기존 `v3/tests/unit/` 컨벤션 따름. 게이트 엔진은 순수 함수라 매트릭스 테스트가 핵심:

- `autonomy-gate.test.ts`: `level × policy severity × verify result → action` 진리표
  - L0 + 클린 + 검증통과 → `escalate(manual_gate)`
  - L1 + 클린 + 검증통과 → `auto_merge`
  - L1 + `review` 정책 트립 → `escalate(policy_review)`
  - L2 + `review` 정책 트립(자동승인 카테고리) → `auto_merge`
  - L2 + `block` 정책 트립 → `escalate(policy_block)` _(레벨 무관 불변식)_
  - 검증 `required` 실패 → onFailure(retry) 소진 후 `escalate(verify_failed)`
- `policy-match.test.ts`: pathGlobs/changeKinds/costUsdOver/confidenceUnder 매칭
- `inbox-item.test.ts`: projection HIGH 이벤트 → `ExceptionItem` 생성, 중복 억제
- 상태 머신: 자동 `REVIEW→DONE` 전이, `waiting_for_human` 조건부 전이
- Acceptance: L1 프로젝트에서 정상 task 10개 dispatch → 0건 인박스, 전부 자동 머지; prod 경로 건드린 task 1개 → 인박스에 정확히 1건.

---

## 13. 의사결정 기록 (D-series)

- **D1** — 사람 개입은 hot path(매 task)가 아니라 정책 위험 경계에서만. _근거:_ 매-task 동기 승인은 오케스트레이터 컨셉을 파괴함 (대화에서 합의).
- **D2** — 검증 게이트는 프로젝트별 사전 설정으로 사람 승인을 *대체*한다. 신뢰 자동화, 예외만 에스컬레이션.
- **D3** — 기본 autonomy level = **L1**.
- **D4** — `block` severity 정책은 autonomy level과 무관하게 항상 에스컬레이션 (L2도 prod/시크릿은 막힘).
- **D5** — 에스컬레이션은 **비동기**. 해당 task만 대기, 플릿은 계속. 미션은 다른 runnable task 없을 때만 `waiting_for_human`.
- **D6** — 인박스의 **빈 상태가 성공 상태**. 대부분의 날 비어 있도록 설계.
- **D7** — task 상태 enum에 새 값 추가하지 않음. 에스컬레이션은 `REVIEW` 위 사이드 채널(`ExceptionItem`)로 표현해 기존 상태 머신 불변성 유지.
- **D8** _(land-and-expand)_ — 다이얼은 도입 곡선을 내장한다: L0로 시작 → 신뢰 쌓이면 L1/L2. 제품이 고객 신뢰와 함께 성장.
