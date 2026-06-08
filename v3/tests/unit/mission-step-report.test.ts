import { describe, expect, it } from "vitest";
import {
  resolveMissionIdFromContext,
  buildMissionStepReportedEvent,
  UNSPECIFIED_STEP_INDEX,
  type MissionStepReportedEvent,
} from "../../electron/mcp-server/context";

// B안 Phase 2 (보고 채널) — mission_step_done 의 순수 코어.
// MCP 도구 핸들러는 firebase/auth 를 import 하는 tools.ts 안에 있어 격리 단위테스트가
// 어렵다. 도구는 아래 순수 빌더에 missionId 추출/거부 + 페이로드 조립을 위임하므로
// 여기서 빌더를 직접 검증한다 (= 도구가 emit 할 이벤트 계약 검증).

const MISSION = "missionAbc123";

describe("resolveMissionIdFromContext", () => {
  it("returns the missionId for a mission context", () => {
    expect(resolveMissionIdFromContext({ MARBLO_CONTEXT: MISSION })).toBe(
      MISSION,
    );
  });
  it("returns null for the board context", () => {
    expect(resolveMissionIdFromContext({ MARBLO_CONTEXT: "board" })).toBeNull();
  });
  it("returns null for Quick Lane contexts", () => {
    expect(resolveMissionIdFromContext({ MARBLO_CONTEXT: "lane" })).toBeNull();
    expect(
      resolveMissionIdFromContext({ MARBLO_CONTEXT: "lane:xyz" }),
    ).toBeNull();
  });
  it("returns null when unscoped (MARBLO_CONTEXT unset)", () => {
    expect(resolveMissionIdFromContext({})).toBeNull();
  });
});

describe("buildMissionStepReportedEvent — mission context", () => {
  it("emits the exact 'mission.step_reported' payload (missionId top-level, stepIndex+result in payload)", () => {
    const event = buildMissionStepReportedEvent(
      2,
      { success: true, output: { prUrl: "https://x/pr/9" } },
      { MARBLO_CONTEXT: MISSION },
    );
    expect(event).toEqual({
      type: "mission.step_reported",
      missionId: MISSION,
      payload: {
        stepIndex: 2,
        result: { success: true, output: { prUrl: "https://x/pr/9" } },
      },
    } satisfies MissionStepReportedEvent);
  });

  it("preserves a failure result (success=false + error)", () => {
    const event = buildMissionStepReportedEvent(
      4,
      { success: false, error: "review found blocking issues" },
      { MARBLO_CONTEXT: MISSION },
    );
    expect(event?.payload.result).toEqual({
      success: false,
      error: "review found blocking issues",
    });
  });

  it("defaults an omitted stepIndex to the UNSPECIFIED_STEP_INDEX sentinel", () => {
    const event = buildMissionStepReportedEvent(undefined, undefined, {
      MARBLO_CONTEXT: MISSION,
    });
    expect(event?.payload.stepIndex).toBe(UNSPECIFIED_STEP_INDEX);
  });

  it("defaults an omitted result to a successful completion", () => {
    const event = buildMissionStepReportedEvent(0, undefined, {
      MARBLO_CONTEXT: MISSION,
    });
    expect(event?.payload.result).toEqual({ success: true });
  });

  it("feeds a capturing emitter the correct event (emit path)", () => {
    const captured: MissionStepReportedEvent[] = [];
    const emit = (e: MissionStepReportedEvent): void => {
      captured.push(e);
    };
    const event = buildMissionStepReportedEvent(
      1,
      { success: true },
      {
        MARBLO_CONTEXT: MISSION,
      },
    );
    if (event) emit(event);
    expect(captured).toEqual([
      {
        type: "mission.step_reported",
        missionId: MISSION,
        payload: { stepIndex: 1, result: { success: true } },
      },
    ]);
  });
});

describe("buildMissionStepReportedEvent — non-mission context is rejected", () => {
  it("returns null for the board context (no emit)", () => {
    expect(
      buildMissionStepReportedEvent(
        1,
        { success: true },
        {
          MARBLO_CONTEXT: "board",
        },
      ),
    ).toBeNull();
  });
  it("returns null for Quick Lane contexts (no emit)", () => {
    expect(
      buildMissionStepReportedEvent(
        1,
        { success: true },
        {
          MARBLO_CONTEXT: "lane",
        },
      ),
    ).toBeNull();
    expect(
      buildMissionStepReportedEvent(
        1,
        { success: true },
        {
          MARBLO_CONTEXT: "lane:abc",
        },
      ),
    ).toBeNull();
  });
  it("returns null when unscoped (no emit)", () => {
    expect(buildMissionStepReportedEvent(1, { success: true }, {})).toBeNull();
  });
});
