/**
 * 미션 타임라인의 `audit_logs` 미러도 같은 params 정책을 지나야 한다
 * (티켓 yJLfoRpqvCcvarIXcT23).
 *
 * ★이 경로가 왜 따로 필요한가: 미러는 `buildLedgerEvent` 를 안 거치고 addDoc 으로
 * 직접 쓴다. 원장에 쓰는 문이 두 개인데 한쪽에만 자물쇠를 달면 그 문으로 샌다 —
 * 미션 `goal` 은 사장님이 자유롭게 타이핑하는 칸이다.
 */
import { describe, expect, it } from "vitest";
import { LEDGER_PARAMS_POLICY } from "../../electron/mcp-server/ledger";
import { missionAuditMirror } from "../../electron/mission-engine/store-impl";

describe("missionAuditMirror — 미션 미러의 params", () => {
  it("goal 원문을 그대로 싣지 않는다", () => {
    const goal =
      "OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz 로 owner@example.com 에 배포해라";

    const mirror = missionAuditMirror({
      projectId: "GFB8JnJrrX6AgahqmGB3",
      missionId: "mission-1234abcd",
      goal,
      toolName: "mission.step.started",
      result: "요약",
      success: true,
    });

    expect(JSON.stringify(mirror.params)).not.toContain(
      "sk-proj-abcdefghijklmnopqrstuvwxyz",
    );
    expect(JSON.stringify(mirror.params)).not.toContain("owner@example.com");
  });

  it("정책 표식을 박는다 — 뷰가 미러를 '옛 원문 문서'로 오해하지 않는다", () => {
    const mirror = missionAuditMirror({
      projectId: "GFB8JnJrrX6AgahqmGB3",
      missionId: "mission-1234abcd",
      goal: "테스트 목표",
      toolName: "mission.step.started",
      result: "요약",
      success: true,
    });

    expect(mirror.paramsPolicy).toBe(LEDGER_PARAMS_POLICY);
    expect(mirror.params.missionId).toBe("mission-1234abcd");
  });
});
