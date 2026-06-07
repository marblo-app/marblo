# Mission↔Kanban 뱃지 렌더링 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 칸반 카드가 미션 task를 lane으로 오판해 `⛙ <UUID>`를 붙이던 버그를 고치고, 미션 task에 전용 `🎯 Mission` 뱃지 + 담당 에이전트(Claude/Codex/Gemini) 아이콘을 표시한다.

**Architecture:** `contextId` 한 필드로 task 출처를 3-way 판별한다 — `"board"`(일반) / `"lane:*"`(Quick Lane) / 그 외 raw missionId(Mission). 순수 판별 로직은 `laneContext.ts`에 두고 vitest로 검증한다. `TaskCard`는 그 판별 결과로 좌측 보더 색과 뱃지를 분기하고, 이미 계산된 claiming agent의 `model`로 모델 아이콘을 그린다. 보드는 contextId로 task를 거르지 않으므로(역할 필터만 존재) 미션 task는 이미 보드에 뜬다 — 이 플랜은 "뜨는 카드를 올바르게 뱃징"하는 데만 집중한다.

**Tech Stack:** TypeScript, React, zustand, vitest(node env, 순수 로직), Playwright(@mocked, 컴포넌트 렌더). 명세: `v3/docs/MISSIONS-SPEC.md` §6.6 (B + C).

**Scope:** 명세 §6.6의 **B(판별 유틸 3-way) + C(TaskCard 뱃지)**. 명세 §6.6의 **D(미션 필터 드롭다운) / E(딥링크) / F(wait 진행률 집계)는 이 플랜 범위 밖** — 별도 플랜.

---

## File Structure

| 파일                                               | 역할                                    | 작업                                                            |
| -------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------- |
| `v3/src/lib/laneContext.ts`                        | task 출처(board/lane/mission) 순수 판별 | Modify — `isMissionTask`/`getMissionId` 추가, `isLaneTask` 좁힘 |
| `v3/tests/unit/laneContext.test.ts`                | 위 순수 로직 vitest 단위 테스트         | Modify — 미션 케이스 단언 뒤집기 + 신규 함수 테스트             |
| `v3/src/components/board/TaskCard.tsx`             | 칸반 카드 렌더 (보더 + 뱃지)            | Modify — 미션 보더/뱃지 + 모델 아이콘                           |
| `v3/tests/playwright/mocked/mission-badge.spec.ts` | TaskCard 미션 뱃지 렌더 회귀            | Create — 미션 task 시드 → 🎯 뱃지 단언                          |

모든 명령은 워크트리 루트의 `v3/`에서 실행한다:
`cd /Users/dongwonkim/Documents/programming/marblo/.claude/worktrees/mission-tab-improve/v3`
(워크트리에 `node_modules`가 없으면 한 번만: `ln -sfn /Users/dongwonkim/Documents/programming/marblo/v3/node_modules ./node_modules`)

---

## Task 1: laneContext 3-way 판별 (board / lane / mission)

**Files:**

- Modify: `v3/src/lib/laneContext.ts`
- Test: `v3/tests/unit/laneContext.test.ts`

**배경:** 현재 `isLaneTask(c)`는 `c !== "board"`면 전부 `true` → 미션 task(`contextId = missionId`)도 lane으로 오판한다. 기존 테스트가 이 오판을 `expect(isLaneTask("mission-xyz")).toBe(true)`로 박제하고 있으므로 **그 단언을 의도적으로 뒤집는다.**

- [ ] **Step 1: 실패하는 테스트로 교체/추가**

`v3/tests/unit/laneContext.test.ts` 전체를 아래로 교체한다:

```ts
import { describe, expect, it } from "vitest";
import {
  getMissionId,
  isLaneTask,
  isMissionTask,
} from "../../src/lib/laneContext";

describe("isLaneTask", () => {
  it("is false for the board context", () => {
    expect(isLaneTask("board")).toBe(false);
  });
  it("is false when contextId is missing/empty (treated as board)", () => {
    expect(isLaneTask(undefined)).toBe(false);
    expect(isLaneTask("")).toBe(false);
  });
  it("is true only for a lane: prefixed context", () => {
    expect(isLaneTask("lane:abc123")).toBe(true);
  });
  it("is false for a mission context (raw missionId, no prefix)", () => {
    // 회귀: 예전엔 board 아니면 전부 lane 으로 판정해 미션을 lane 으로 오판했다.
    expect(isLaneTask("mission-xyz")).toBe(false);
  });
});

describe("isMissionTask", () => {
  it("is true for a raw missionId context", () => {
    expect(isMissionTask("mission-xyz")).toBe(true);
    expect(isMissionTask("aB3-uuid-1234")).toBe(true);
  });
  it("is false for board / empty / undefined", () => {
    expect(isMissionTask("board")).toBe(false);
    expect(isMissionTask("")).toBe(false);
    expect(isMissionTask(undefined)).toBe(false);
  });
  it("is false for a lane context", () => {
    expect(isMissionTask("lane:abc123")).toBe(false);
  });
});

describe("getMissionId", () => {
  it("returns the missionId for a mission context", () => {
    expect(getMissionId("mission-xyz")).toBe("mission-xyz");
  });
  it("returns null for board / lane / empty", () => {
    expect(getMissionId("board")).toBeNull();
    expect(getMissionId("lane:abc")).toBeNull();
    expect(getMissionId(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node_modules/.bin/vitest run tests/unit/laneContext.test.ts`
Expected: FAIL — `isMissionTask`/`getMissionId`가 export 되지 않아 import 에러, 그리고 기존 `isLaneTask("mission-xyz")` 동작이 새 단언과 불일치.

- [ ] **Step 3: 최소 구현**

`v3/src/lib/laneContext.ts` 전체를 아래로 교체한다:

```ts
/**
 * Task 출처를 contextId 한 필드로 구분한다. 칸반 보드는 세 종류의 task 를
 * 한 화면에 섞어 보여주므로(일반 보드 / Quick Lane / Mission), 각 출처를
 * 정확히 판별해 카드에 서로 다른 마킹을 붙인다.
 *
 *   - 일반 보드 : contextId === "board" (또는 미설정)
 *   - Quick Lane: contextId === "lane:<laneId>"
 *   - Mission   : contextId === <missionId> (raw, 접두사 없음)
 *
 * 미션 task 의 contextId 는 missionId 그 자체다(접두사 없음 — dispatcher-impl
 * 의 `contextId: input.missionId`). 따라서 "board 도 lane 도 아니면 mission"
 * 으로 판별한다. (접두사 통일은 MISSIONS-SPEC §6.6-A 대로 v3.1 보류.)
 */
const RESERVED_BOARD = "board";

/** Quick Lane task — "lane:" 접두사를 가진 contextId. */
export function isLaneTask(contextId: string | undefined): boolean {
  return !!contextId && contextId.startsWith("lane:");
}

/** Mission task — board 도 lane 도 아닌(= missionId 그 자체) contextId. */
export function isMissionTask(contextId: string | undefined): boolean {
  return (
    !!contextId &&
    contextId !== RESERVED_BOARD &&
    !contextId.startsWith("lane:")
  );
}

/** Mission task 의 missionId, 아니면 null. */
export function getMissionId(contextId: string | undefined): string | null {
  return isMissionTask(contextId) ? (contextId as string) : null;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node_modules/.bin/vitest run tests/unit/laneContext.test.ts`
Expected: PASS (3 describe, 모든 it 통과).

- [ ] **Step 5: 호출처 회귀 — 기존 lane/context 테스트도 함께 통과 확인**

Run: `node_modules/.bin/vitest run tests/unit/laneContext.test.ts tests/unit/context.test.ts`
Expected: PASS — `isLaneTask` 의미 변경이 context 백필 로직 테스트를 깨지 않음.

- [ ] **Step 6: Commit**

```bash
git add src/lib/laneContext.ts tests/unit/laneContext.test.ts
git commit -m "fix(v3): laneContext 3-way 판별 — 미션 task 를 lane 으로 오판하던 버그 수정

isLaneTask 를 lane: 접두사로 좁히고 isMissionTask/getMissionId 추가.
명세 MISSIONS-SPEC §6.6-B."
```

---

## Task 2: TaskCard 미션 뱃지 + 담당 에이전트 아이콘

**Files:**

- Modify: `v3/src/components/board/TaskCard.tsx`
  - import (line 11), 모델 아이콘 상수(ROLE_ICONS 인근 ~line 66), 보더 className(~line 225), 뱃지 블록(~line 254)
- Test: `v3/tests/playwright/mocked/mission-badge.spec.ts` (Create)

**배경:** `TaskCard`는 `task.claimedBy`로 `claimingAgent`(agentStore)를 이미 계산한다. 그 `claimingAgent.model`(`claude`/`gpt`/`gemini`/…)로 모델 아이콘을 그린다. 모델→아이콘 맵은 agentStore 내부 상수와 동일하게 로컬에 둔다(기존 AgentList/AgentStatusCard 와 같은 중복 패턴 — DRY 리팩터는 범위 밖).

- [ ] **Step 1: 실패하는 렌더 테스트 작성**

`v3/tests/playwright/mocked/mission-badge.spec.ts` 생성:

```ts
import { test, expect } from "../helpers/fixtures";

/**
 * Tier 2 회귀: 미션 task(contextId = raw missionId)가 칸반 카드에 lane(⛙)이
 * 아니라 전용 🎯 Mission 뱃지 + 담당 에이전트 모델 아이콘으로 렌더되는지.
 *
 * 잡히는 회귀:
 *   - isMissionTask/isLaneTask 판별 깨짐 → 미션 카드가 ⛙ 로 되돌아감
 *   - 미션 뱃지 / 모델 아이콘 렌더 누락
 */
test("@mocked 미션 task 는 🎯 Mission 뱃지로 렌더된다 (⛙ Lane 아님)", async ({
  marblo,
}) => {
  await marblo.openMockKanban();

  // task store 에 미션 task, agent store 에 claiming 에이전트를 직접 주입.
  await marblo.page.evaluate(() => {
    const tw = (
      window as unknown as {
        __marbloTest?: {
          stores: {
            task: {
              getState: () => { tasks: any[] };
              setState: (s: any) => void;
            };
            agent: {
              getState: () => { agents: any[] };
              setState: (s: any) => void;
            };
          };
        };
      }
    ).__marbloTest;
    if (!tw) throw new Error("__marbloTest hatch 미노출");
    const taskStore = tw.stores.task;
    const agentStore = tw.stores.agent;
    const existing = taskStore.getState().tasks;
    const projectId = existing[0]?.projectId ?? "mock-project";
    const now = new Date();
    const missionTask = {
      id: "mission-task-1",
      projectId,
      contextId: "mission-demo-1", // raw missionId — 접두사 없음
      title: "결제 플로우 추가",
      description: "",
      status: "IN_PROGRESS",
      role: "frontend",
      priority: 3,
      dependsOn: [],
      dependsOnCompleted: true,
      claimedBy: "agent-claude-1",
      claimedAt: now,
      scope: [],
      comment: "",
      prUrl: "",
      hasPmFeedback: false,
      createdAt: now,
      updatedAt: now,
    };
    taskStore.setState({ tasks: [...existing, missionTask] });
    const agents = agentStore.getState().agents ?? [];
    agentStore.setState({
      agents: [
        ...agents,
        {
          id: "agent-claude-1",
          name: "agent-claude-1",
          model: "claude",
          status: "working",
          ownerId: "owner-1",
          projectId,
        },
      ],
    });
  });

  // 미션 카드가 렌더됐는지 (TaskCard h4 title).
  await expect(
    marblo.page.locator('text="결제 플로우 추가"').first(),
    "미션 task 카드가 보드에 안 보임",
  ).toBeVisible({ timeout: 8000 });

  // 🎯 Mission 뱃지 visible.
  await expect(
    marblo.page.getByText("🎯 Mission").first(),
    "미션 카드에 🎯 Mission 뱃지가 안 보임",
  ).toBeVisible();

  // 담당 에이전트(claude) 모델 아이콘 🟣 visible.
  await expect(
    marblo.page.getByText("🟣").first(),
    "미션 카드에 claude 모델 아이콘(🟣)이 안 보임",
  ).toBeVisible();

  // 회귀: 미션 task 는 lane(⛙) 뱃지로 렌더되면 안 된다.
  await expect(
    marblo.page.locator("text=/⛙/"),
    "미션 task 가 lane(⛙) 뱃지로 잘못 렌더됨",
  ).toHaveCount(0);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node_modules/.bin/vitest run` 가 아니라 Playwright다.
Run: `npx playwright test tests/playwright/mocked/mission-badge.spec.ts`
Expected: FAIL — 아직 미션 뱃지/모델 아이콘 미구현이라 `🎯 Mission`이 안 보이거나, 미션 task 가 `⛙` 로 렌더돼 `⛙` count > 0.

- [ ] **Step 3: import 에 isMissionTask 추가**

`v3/src/components/board/TaskCard.tsx` line 11:

```ts
import { isLaneTask, isMissionTask } from "../../lib/laneContext";
```

- [ ] **Step 4: 모델 아이콘 상수 추가**

`v3/src/components/board/TaskCard.tsx` 의 `ROLE_ICONS` 선언 바로 아래(~line 66 이후)에 추가:

```ts
// agentStore 의 MODEL_ICONS 와 동일 (기존 AgentList/AgentStatusCard 중복 패턴).
const MODEL_ICONS: Record<string, string> = {
  claude: "🟣",
  gemini: "🔵",
  gpt: "🟢",
  antigravity: "🟠",
  local: "⚫",
  custom: "⚪",
};
```

- [ ] **Step 5: 보더 className 3-way 분기**

같은 파일 ~line 225. 아래 한 줄을:

```tsx
      } ${isLaneTask(task.contextId) ? "border-l-2 border-l-amber-500" : ""}`}
```

다음으로 교체(미션 보더 추가, lane 과 상호배타):

```tsx
      } ${isLaneTask(task.contextId) ? "border-l-2 border-l-amber-500" : ""} ${
        isMissionTask(task.contextId) ? "border-l-2 border-l-violet-500" : ""
      }`}
```

- [ ] **Step 6: lane 뱃지 정리 + 미션 뱃지 추가**

같은 파일 ~line 254. 기존 lane 뱃지 블록:

```tsx
{
  isLaneTask(task.contextId) && (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-amber-500/20 text-amber-300"
      title={`context: ${task.contextId}`}
    >
      ⛙ {task.contextId.startsWith("lane:") ? "Lane" : task.contextId}
    </span>
  );
}
```

를 아래로 교체한다(isLaneTask 가 이제 lane 만 true 이므로 ternary 의 죽은 가지를 제거하고, 미션 뱃지를 잇따라 추가):

```tsx
{
  isLaneTask(task.contextId) && (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-amber-500/20 text-amber-300"
      title={`context: ${task.contextId}`}
    >
      ⛙ Lane
    </span>
  );
}
{
  isMissionTask(task.contextId) && (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-violet-500/20 text-violet-300"
      title={`mission: ${task.contextId}`}
    >
      🎯 Mission
      {claimingAgent?.model && (
        <span aria-label={`agent: ${claimingAgent.model}`}>
          {MODEL_ICONS[claimingAgent.model] ?? "⚪"}
        </span>
      )}
    </span>
  );
}
```

> `claimingAgent` 는 같은 컴포넌트에서 이미 계산돼 있다(`const claimingAgent = task.claimedBy ? agents.find(...) : undefined;`). 새 데이터 패칭 불필요.

- [ ] **Step 7: 렌더 테스트 통과 확인**

Run: `npx playwright test tests/playwright/mocked/mission-badge.spec.ts`
Expected: PASS — 🎯 Mission + 🟣 visible, ⛙ count 0.

- [ ] **Step 8: 기존 보드 렌더 회귀 가드 동시 통과 확인**

Run: `npx playwright test tests/playwright/mocked/kanban-dnd.spec.ts tests/playwright/unit/taskcard-render.spec.ts`
Expected: PASS — lane 뱃지 텍스트가 `⛙ Lane`로 바뀐 것 외 기존 보드 렌더 회귀 없음.

- [ ] **Step 9: 타입체크**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 에러 0 (특히 `MODEL_ICONS`/`isMissionTask`/`claimingAgent.model` 타입 정합).

- [ ] **Step 10: Commit**

```bash
git add src/components/board/TaskCard.tsx tests/playwright/mocked/mission-badge.spec.ts
git commit -m "feat(v3): 칸반 카드 미션 뱃지 + 담당 에이전트 아이콘

미션 task(contextId=missionId) 를 🎯 Mission(violet) + 모델 아이콘으로 렌더.
lane(⛙) 오판 제거. 명세 MISSIONS-SPEC §6.6-C."
```

---

## Out of scope (별도 플랜)

명세 §6.6 중 아래는 이 플랜에 포함하지 않는다:

- **D. 칸반 미션 필터 드롭다운** — "Mission별 보기" (데모에서 한 미션의 카드만 골라 보기). 보드는 이미 미션 카드를 표시하므로 데모 최소 요건은 아님.
- **E. MissionDetail ↔ Board 딥링크** — "보드에서 보기" 버튼 + 역방향 점프.
- **F. wait step 진행률 = 칸반 카드 집계** — MissionTimeline "N개 중 M개 완료".
- **v3.1:** 미션별 swimlane, 칸반에서 직접 미션 생성, `mission:<id>` 접두사 통일 마이그레이션.

---

## Self-Review

**1. Spec coverage (§6.6 B + C):**

- B(판별 유틸 3-way: isMissionTask/getMissionId/isLaneTask 좁힘) → Task 1 ✅
- C(TaskCard 미션 뱃지 violet + 담당 에이전트 모델 아이콘, lane 오판 제거) → Task 2 ✅
- D/E/F → 명시적으로 범위 밖 ✅

**2. Placeholder scan:** 모든 step 에 실제 코드/명령/기대출력 포함. "적절히 처리" 류 없음 ✅

**3. Type consistency:**

- `isLaneTask`/`isMissionTask`/`getMissionId` 시그니처가 Task 1 정의와 Task 2 import·사용에서 일치 ✅
- `MODEL_ICONS` 키(`claude`/`gemini`/`gpt`/…)가 agentStore 의 `ModelType` 값과 일치, `claimingAgent.model` 로 인덱싱 ✅
- 미션 task 의 `contextId` 컨벤션(raw missionId)이 dispatcher-impl(`contextId: input.missionId`)·테스트 시드(`"mission-demo-1"`)에서 일관 ✅
