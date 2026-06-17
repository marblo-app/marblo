// Regression coverage for orchestrator PTY context routing (P7) — the surviving
// "mission/lane progress leaks into the board orchestrator PTY" path after P3.
//
// Two seams are exercised here (tools.ts itself can't be imported — it pulls in
// ./firebase.js → real firebase/auth — so we test the pure predicates the fixed
// handlers route on, per the project's established pattern):
//
//   [bridge] resolveNotifyTarget(contextId) — the 3-way orchestrator selection
//            for POST /notify-orchestrator. board+lane → board orch,
//            mission → mission orch.
//
//   [mcp]    isLaneContext(contextId) — the predicate tools.ts gates on so a
//            Quick Lane's PROGRESS notifies (update_status / add_activity /
//            dependency-resolved) are NEVER pushed to an orch PTY; only its
//            submit_for_review reaches the (board) orch as the review gate.
//
// Both mirror src/lib/laneContext.ts (the renderer's single source of truth),
// which has its own copy + tests (laneContext.test.ts). These assert the
// electron-side and mcp-side copies stay behaviorally identical.

import { describe, expect, it } from "vitest";
import {
  resolveNotifyTarget,
  shouldInjectOrchestratorNotification,
} from "../../electron/bridge-server";
import { isLaneContext } from "../../electron/mcp-server/projection";

describe("resolveNotifyTarget — /notify-orchestrator 3-way routing", () => {
  it("routes board / empty / undefined → board orchestrator", () => {
    expect(resolveNotifyTarget("board")).toBe("board");
    expect(resolveNotifyTarget("")).toBe("board");
    expect(resolveNotifyTarget(undefined)).toBe("board");
  });

  it("routes a mission context (raw missionId) → mission orchestrator", () => {
    expect(resolveNotifyTarget("mission-xyz")).toBe("mission");
    expect(resolveNotifyTarget("aB3uuid1234567890XY")).toBe("mission");
  });

  it("routes a Quick Lane → board orchestrator (review gate, NOT mission)", () => {
    // 회귀: 예전 2-way 분기(contextId!="" && !="board")는 lane 을 mission 으로
    // 오분류해 레인 리뷰 제출이 mission 오케로 새거나 drop 됐다. 이제 board 로.
    expect(resolveNotifyTarget("lane:abc123")).toBe("board");
    expect(resolveNotifyTarget("lane:")).toBe("board");
    expect(resolveNotifyTarget("lane")).toBe("board");
  });

  it("never sends a lane context to the mission orchestrator", () => {
    expect(resolveNotifyTarget("lane:anything")).not.toBe("mission");
  });
});

describe("isLaneContext — mcp-server progress-notify gate", () => {
  it("is true for a lane context (prefix or bare)", () => {
    expect(isLaneContext("lane:abc123")).toBe(true);
    expect(isLaneContext("lane:")).toBe(true);
    expect(isLaneContext("lane")).toBe(true);
  });

  it("is false for board / empty / undefined", () => {
    expect(isLaneContext("board")).toBe(false);
    expect(isLaneContext("")).toBe(false);
    expect(isLaneContext(undefined)).toBe(false);
  });

  it("is false for a mission context", () => {
    expect(isLaneContext("mission-xyz")).toBe(false);
    expect(isLaneContext("aB3uuid1234567890XY")).toBe(false);
  });
});

describe("routing parity — isLaneContext ↔ resolveNotifyTarget", () => {
  // Every lane context the mcp gate silences must, for the one message that DOES
  // get through (submit_for_review), route to the board orch — never mission.
  const laneContexts = ["lane", "lane:", "lane:abc", "lane:a-b_c.123"];
  laneContexts.forEach((ctx) => {
    it(`lane "${ctx}": gated as lane AND routes to board`, () => {
      expect(isLaneContext(ctx)).toBe(true);
      expect(resolveNotifyTarget(ctx)).toBe("board");
    });
  });

  // A mission context is the inverse: NOT lane-gated, AND routes to the
  // mission orch (never the board one) when an important event is injected.
  const missionContexts = ["m1", "mission-xyz", "aB3uuid1234567890XY"];
  missionContexts.forEach((ctx) => {
    it(`mission "${ctx}": not gated AND routes to mission`, () => {
      expect(isLaneContext(ctx)).toBe(false);
      expect(resolveNotifyTarget(ctx)).toBe("mission");
    });
  });
});

describe("shouldInjectOrchestratorNotification — quiet progress gate", () => {
  it("suppresses ordinary add_activity progress notifications", () => {
    expect(
      shouldInjectOrchestratorNotification(
        '[Task Activity] "Build API" progress update (backend, id=t1, agent=a1): implementing handler',
      ),
    ).toBe(false);
  });

  it("suppresses ordinary status progress notifications", () => {
    expect(
      shouldInjectOrchestratorNotification(
        '[Task Update] "Build API" CLAIMED → IN_PROGRESS (backend, id=t1)',
      ),
    ).toBe(false);
  });

  it("injects completion, failure, blocked, and review notifications", () => {
    expect(
      shouldInjectOrchestratorNotification(
        '[Task Update] "Build API" IN_PROGRESS → DONE (backend, id=t1)',
      ),
    ).toBe(true);
    expect(
      shouldInjectOrchestratorNotification(
        '[Task Update] "Build API" IN_PROGRESS → FAILED (backend, id=t1)',
      ),
    ).toBe(true);
    expect(
      shouldInjectOrchestratorNotification(
        '[Task Update] "Build API" IN_PROGRESS → BLOCKED (backend, id=t1)',
      ),
    ).toBe(true);
    expect(
      shouldInjectOrchestratorNotification(
        '[Review Submitted] "Build API" is ready for review (backend, id=t1)',
      ),
    ).toBe(true);
  });

  it("injects stuck add_activity notifications", () => {
    expect(
      shouldInjectOrchestratorNotification(
        '[Task Activity] "Build API" progress update (backend, id=t1, agent=a1): stuck on missing credentials',
      ),
    ).toBe(true);
  });
});
