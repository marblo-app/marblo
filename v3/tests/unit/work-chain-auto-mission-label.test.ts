/**
 * 자동 미션 라벨 부여 (티켓 `xZtqOCLN1GQvloeGJkeD`). 사장님 지시: "사용자가
 * 거기에 임의로 작업을 추가하는 경우도 미션 ID 자동 부여되도록."
 *
 * 후보 (나)를 택했다: 열린 암묵적 미션이 정확히 하나면 그 라벨, 아니면(0개·
 * 2개 이상) 라벨 없음. ★모호할 때 라벨 없음으로 떨어지는 것이 완료 기준이다
 * — 틀린 미션에 조용히 합류하는 것보다 안전하다.
 */
import { describe, expect, it } from "vitest";
import { pickAutoMissionLabel } from "../../src/lib/workChain";
import { selectJoinableImplicitMission } from "../../electron/mcp-server/implicit-mission";

function mission(over: {
  status?: string;
  missionKind?: string;
  implicitLabel?: string;
}) {
  return { missionKind: "implicit", implicitLabel: "Some Mission", ...over };
}

describe("pickAutoMissionLabel", () => {
  it("picks the label when exactly one implicit mission is open", () => {
    expect(pickAutoMissionLabel([mission({ status: "active" })])).toBe(
      "Some Mission",
    );
  });

  it.each(["planning", "active", "waiting_for_human", "sleeping"])(
    "treats status %s as open",
    (status) => {
      expect(pickAutoMissionLabel([mission({ status })])).toBe("Some Mission");
    },
  );

  it.each(["completed", "abandoned"])(
    "does not auto-assign a %s (closed) mission",
    (status) => {
      expect(pickAutoMissionLabel([mission({ status })])).toBeUndefined();
    },
  );

  // ★완료 기준: 모호하면(0개 또는 여럿) 라벨 없음.
  it("returns undefined when there are no open missions", () => {
    expect(pickAutoMissionLabel([])).toBeUndefined();
    expect(
      pickAutoMissionLabel([mission({ status: "completed" })]),
    ).toBeUndefined();
  });

  it("returns undefined when there are two or more open missions — does not guess", () => {
    expect(
      pickAutoMissionLabel([
        mission({ status: "active", implicitLabel: "A" }),
        mission({ status: "active", implicitLabel: "B" }),
      ]),
    ).toBeUndefined();
  });

  it("ignores explicit (non-implicit) missions — those aren't chain-label candidates", () => {
    expect(
      pickAutoMissionLabel([
        mission({ status: "active", missionKind: "explicit" }),
      ]),
    ).toBeUndefined();
  });

  it("ignores an implicit mission with no label", () => {
    expect(
      pickAutoMissionLabel([mission({ status: "active", implicitLabel: "" })]),
    ).toBeUndefined();
  });

  // ★parity: this file duplicates electron/mcp-server/implicit-mission.ts's
  // OPEN_MISSION_STATUSES (not exported, and out of this ticket's declared
  // scope) rather than importing it. Cross-check every status against the
  // real exported function so the two never quietly drift apart.
  it.each([
    ["planning", true],
    ["active", true],
    ["waiting_for_human", true],
    ["sleeping", true],
    ["completed", false],
    ["abandoned", false],
    ["", false],
  ] as const)(
    "agrees with selectJoinableImplicitMission on open-ness of status %s",
    (status, expectedOpen) => {
      const candidate = {
        id: "m1",
        status,
        missionKind: "implicit",
        implicitLabel: "Parity Label",
      };
      const joinable =
        selectJoinableImplicitMission([candidate], "Parity Label") !== null;
      expect(joinable).toBe(expectedOpen);

      const picked = pickAutoMissionLabel([
        { status, missionKind: "implicit", implicitLabel: "Parity Label" },
      ]);
      expect(picked === "Parity Label").toBe(expectedOpen);
    },
  );
});
