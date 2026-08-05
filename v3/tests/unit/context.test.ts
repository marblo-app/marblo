import { describe, expect, it } from "vitest";
import {
  resolveContext,
  resolveContextForWrite,
  contextReadFilter,
  contextForKind,
  computeContextIdBackfill,
  effectiveContextId,
  isTaskInReadContext,
  isLaneContextId,
  buildLaneContextId,
  isOrchestratorAgentId,
} from "../../electron/mcp-server/context";
// The one-off backfill script duplicates computeContextIdBackfill (it cannot
// import the TS source without a build step). Import that copy here so the
// parity test below catches any drift between the two implementations.
import { computeContextIdBackfill as backfillScriptImpl } from "../../scripts/backfill-context-id.mjs";

describe("resolveContext (read-scope)", () => {
  it("returns the MARBLO_CONTEXT value when set", () => {
    expect(resolveContext({ MARBLO_CONTEXT: "board" })).toBe("board");
    expect(resolveContext({ MARBLO_CONTEXT: "lane:abc123" })).toBe(
      "lane:abc123",
    );
  });
  it("returns empty string (unscoped) when unset", () => {
    expect(resolveContext({})).toBe("");
  });
});

describe("resolveContextForWrite (write-label)", () => {
  it("defaults to 'board' so every task is labeled", () => {
    expect(resolveContextForWrite({})).toBe("board");
  });
  it("uses the explicit context when set", () => {
    expect(resolveContextForWrite({ MARBLO_CONTEXT: "lane:x" })).toBe("lane:x");
  });
});

describe("contextReadFilter", () => {
  it("returns '' (no filter) when all_contexts is true", () => {
    expect(contextReadFilter(true, { MARBLO_CONTEXT: "board" })).toBe("");
  });
  it("returns the resolved context when all_contexts is false", () => {
    expect(contextReadFilter(false, { MARBLO_CONTEXT: "board" })).toBe("board");
  });
  it("returns '' (unscoped) when context unset and all_contexts false", () => {
    expect(contextReadFilter(false, {})).toBe("");
  });
});

describe("contextForKind", () => {
  it("maps board → 'board'", () => {
    expect(contextForKind("board")).toBe("board");
  });
  it("maps mission/other kinds → '' (unscoped, no regression)", () => {
    expect(contextForKind("mission")).toBe("");
  });
  it("★lane: passes a lane kind through so the orchestrator stays lane-scoped", () => {
    expect(contextForKind("lane")).toBe("lane");
    expect(contextForKind("lane:q1")).toBe("lane:q1");
  });
});

describe("isLaneContextId / buildLaneContextId (lane 격리 규약)", () => {
  it("buildLaneContextId 는 렌더러와 동일한 'lane:<id>' 형식을 만든다", () => {
    expect(buildLaneContextId("task-42")).toBe("lane:task-42");
    expect(isLaneContextId(buildLaneContextId("task-42"))).toBe(true);
  });
  it("isLaneContextId 는 legacy 'lane' 과 concrete 'lane:<id>' 둘 다 인식한다", () => {
    expect(isLaneContextId("lane")).toBe(true);
    expect(isLaneContextId("lane:abc")).toBe(true);
  });
  it("board / mission / 미설정은 lane 이 아니다", () => {
    expect(isLaneContextId("board")).toBe(false);
    expect(isLaneContextId("mission-7")).toBe(false);
    expect(isLaneContextId(undefined)).toBe(false);
    expect(isLaneContextId("")).toBe(false);
  });
});

describe("isOrchestratorAgentId (담당자 귀속 제외 규약)", () => {
  it("orchestrator-manager sessionId 규약(board/kind 분리)을 인식한다", () => {
    expect(isOrchestratorAgentId("orchestrator-proj123")).toBe(true);
    expect(isOrchestratorAgentId("orchestrator-mission-proj123")).toBe(true);
  });
  it("실제 작업자 id / 미설정은 오케가 아니다 (귀속 유지)", () => {
    expect(isOrchestratorAgentId("backend-claude-3")).toBe(false);
    expect(isOrchestratorAgentId("unknown")).toBe(false);
    expect(isOrchestratorAgentId(undefined)).toBe(false);
    expect(isOrchestratorAgentId("")).toBe(false);
  });
});

describe("computeContextIdBackfill", () => {
  it("labels tasks missing contextId: missionId wins, else 'board'", () => {
    const out = computeContextIdBackfill([
      { id: "a" },
      { id: "b", missionId: "m1" },
      { id: "c", contextId: "lane:z" },
    ]);
    expect(out).toEqual([
      { id: "a", contextId: "board" },
      { id: "b", contextId: "m1" },
    ]);
  });
});

describe("computeContextIdBackfill parity (context.ts ↔ backfill-context-id.mjs)", () => {
  // The two implementations are byte-for-byte copies today; this guards against
  // future drift by asserting they agree across a range of input shapes.
  const cases: { id: string; contextId?: string; missionId?: string }[][] = [
    [],
    [{ id: "a" }],
    [{ id: "b", missionId: "m1" }],
    [{ id: "c", contextId: "lane:z" }],
    [{ id: "d", contextId: "" }], // empty string is falsy → still backfilled
    [{ id: "e", missionId: "m2", contextId: "x" }], // already labeled → skipped
    [
      { id: "a" },
      { id: "b", missionId: "m1" },
      { id: "c", contextId: "lane:z" },
      { id: "d", contextId: "" },
      { id: "e", missionId: "m2", contextId: "x" },
    ],
  ];
  cases.forEach((tasks, i) => {
    it(`case ${i}: script copy matches the context.ts source`, () => {
      expect(backfillScriptImpl(tasks)).toEqual(
        computeContextIdBackfill(tasks),
      );
    });
  });
});

describe("effectiveContextId (read-path backfill)", () => {
  it("returns the explicit contextId when present", () => {
    expect(effectiveContextId({ contextId: "board" })).toBe("board");
    expect(effectiveContextId({ contextId: "lane:abc" })).toBe("lane:abc");
    expect(effectiveContextId({ contextId: "mission-7" })).toBe("mission-7");
  });
  it("backfills a missing contextId to the missionId when set", () => {
    expect(effectiveContextId({ missionId: "m1" })).toBe("m1");
    expect(effectiveContextId({ contextId: "", missionId: "m1" })).toBe("m1");
  });
  it("backfills a missing contextId (and no mission) to 'board'", () => {
    expect(effectiveContextId({})).toBe("board");
    expect(effectiveContextId({ contextId: "" })).toBe("board");
    expect(effectiveContextId({ contextId: undefined })).toBe("board");
  });
  it("agrees with computeContextIdBackfill on unlabeled tasks (one rule, two paths)", () => {
    const tasks = [{ id: "a" }, { id: "b", missionId: "m1" }];
    const backfilled = computeContextIdBackfill(tasks);
    for (const t of tasks) {
      const expected = backfilled.find((b) => b.id === t.id)!.contextId;
      expect(effectiveContextId(t)).toBe(expected);
    }
  });
});

describe("isTaskInReadContext", () => {
  it("unscoped ('') sees every task", () => {
    expect(isTaskInReadContext({ contextId: "lane:x" }, "")).toBe(true);
    expect(isTaskInReadContext({}, "")).toBe(true);
  });
  it("board includes a task with an explicit 'board' contextId", () => {
    expect(isTaskInReadContext({ contextId: "board" }, "board")).toBe(true);
  });
  it("★회귀: board includes a legacy/external TODO stored without a contextId", () => {
    expect(isTaskInReadContext({}, "board")).toBe(true);
    expect(isTaskInReadContext({ contextId: "" }, "board")).toBe(true);
    expect(isTaskInReadContext({ contextId: undefined }, "board")).toBe(true);
  });
  it("★lane 격리 불변: a lane task never leaks into the board feed", () => {
    expect(isTaskInReadContext({ contextId: "lane:abc" }, "board")).toBe(false);
    expect(isTaskInReadContext({ contextId: "lane:" }, "board")).toBe(false);
  });
  it("★mission grouping: a mission-labeled task remains discoverable on the board feed", () => {
    expect(isTaskInReadContext({ contextId: "mission-xyz" }, "board")).toBe(
      true,
    );
    // contextId 미설정이라도 missionId 가 있으면 보드 기본 조회에서 숨기지 않는다.
    expect(isTaskInReadContext({ missionId: "m1" }, "board")).toBe(true);
  });
  it("a lane read matches only its own lane (exact, no cross-lane leak)", () => {
    expect(isTaskInReadContext({ contextId: "lane:abc" }, "lane:abc")).toBe(
      true,
    );
    expect(isTaskInReadContext({ contextId: "lane:other" }, "lane:abc")).toBe(
      false,
    );
    expect(isTaskInReadContext({}, "lane:abc")).toBe(false);
  });
});

describe("get_available_tasks board filter (회귀 시나리오)", () => {
  // production 의 board 경로와 동일한 술어를 가져온 docs 에 적용:
  // tasks.filter((t) => isTaskInReadContext(t, "board")).
  const tasks = [
    { id: "legacy", role: "backend" }, // contextId 미설정(외부/legacy) → board 포함
    { id: "board1", role: "backend", contextId: "board" },
    { id: "lane1", role: "backend", contextId: "lane:q1" }, // 누출 금지
    { id: "mission1", role: "backend", contextId: "mission-7" }, // 그룹핑: board 기본 조회 포함
    { id: "missionLegacy", role: "backend", missionId: "mission-7" }, // legacy mission label도 포함
  ];
  it("board 가용 목록은 board+미설정+mission 을 포함하고 lane 만 제외한다", () => {
    const visible = tasks
      .filter((t) => isTaskInReadContext(t, "board"))
      .map((t) => t.id);
    expect(visible).toEqual([
      "legacy",
      "board1",
      "mission1",
      "missionLegacy",
    ]);
  });
  it("lane:q1 컨텍스트로 읽으면 board/미설정/타lane 은 안 보이고 자기 lane 만 보인다", () => {
    const visible = tasks
      .filter((t) => isTaskInReadContext(t, "lane:q1"))
      .map((t) => t.id);
    expect(visible).toEqual(["lane1"]);
  });
});
