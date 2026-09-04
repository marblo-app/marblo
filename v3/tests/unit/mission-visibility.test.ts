/**
 * 미션 가시성 규칙 — "돌고 있는 미션"을 세는 단일 진실원.
 * 티켓 pfEBF4VEhyM1P1iw7Aem (진단 #1402 §6-6).
 *
 * 실측된 사고: 미션 24건 = active 3 / completed 21 인데, active 3건이 전부
 * `missionKind: "implicit"` + `steps: []` 였다. implicit 은 엔진 픽업에서
 * 제외되므로 **운전할 대상은 0건**인데 화면은 3건이 도는 것처럼 보였다.
 * 여기서 고정하는 건 딱 하나 — implicit 은 실행 중으로 세지 않는다.
 */
import { describe, expect, it } from "vitest";
import type { MissionStatus } from "../../src/types/mission";
import {
  bucketMissionsByRunnability,
  countRunningMissions,
  isRunnableMission,
  isTerminalMissionStatus,
} from "../../src/lib/missionVisibility";

function mission(
  id: string,
  status: MissionStatus,
  missionKind?: "implicit" | "explicit",
) {
  return missionKind ? { id, status, missionKind } : { id, status };
}

/** 사고 당시의 실제 분포 — active 3건이 전부 implicit. */
const REAL_WORLD = [
  mission("27CNOI0pdxvsSjVwuB3x", "active", "implicit"),
  mission("N2hEH1t7Eh8WdAxQS0KC", "active", "implicit"),
  mission("uiig9mvbutT5SV1Op5JD", "active", "implicit"),
  ...Array.from({ length: 21 }, (_, i) =>
    mission(`done-${i}`, "completed" as MissionStatus),
  ),
];

describe("isRunnableMission", () => {
  it("implicit 은 실행 대상이 아니다", () => {
    expect(isRunnableMission(mission("a", "active", "implicit"))).toBe(false);
  });

  it("missionKind 가 없으면(=기존 explicit 미션) 실행 대상이다", () => {
    expect(isRunnableMission(mission("a", "active"))).toBe(true);
    expect(isRunnableMission(mission("b", "active", "explicit"))).toBe(true);
  });
});

describe("isTerminalMissionStatus", () => {
  it("completed / abandoned 만 종료다", () => {
    expect(isTerminalMissionStatus("completed")).toBe(true);
    expect(isTerminalMissionStatus("abandoned")).toBe(true);
    for (const s of [
      "planning",
      "active",
      "waiting_for_human",
      "sleeping",
    ] as MissionStatus[]) {
      expect(isTerminalMissionStatus(s)).toBe(false);
    }
  });
});

describe("countRunningMissions — 집계가 거짓말하지 않는다", () => {
  it("★사고 당시 분포에서 실행 중은 3이 아니라 0이다", () => {
    expect(countRunningMissions(REAL_WORLD)).toBe(0);
  });

  it("실행 가능한 미션이 섞이면 그것만 센다", () => {
    expect(
      countRunningMissions([...REAL_WORLD, mission("real", "active")]),
    ).toBe(1);
  });

  it("실행 가능하지만 끝난 미션은 실행 중이 아니다", () => {
    expect(
      countRunningMissions([
        mission("done", "completed"),
        mission("gone", "abandoned"),
      ]),
    ).toBe(0);
  });

  it("planning / waiting_for_human / sleeping 은 아직 운전 대상이라 센다", () => {
    expect(
      countRunningMissions([
        mission("p", "planning"),
        mission("w", "waiting_for_human"),
        mission("s", "sleeping"),
      ]),
    ).toBe(3);
  });
});

describe("bucketMissionsByRunnability", () => {
  it("implicit 은 끝났든 아니든 labels 로 간다 — running/finished 어디에도 안 샌다", () => {
    const buckets = bucketMissionsByRunnability([
      mission("l1", "active", "implicit"),
      mission("l2", "completed", "implicit"),
      mission("r", "active"),
      mission("f", "completed"),
    ]);
    expect(buckets.running.map((m) => m.id)).toEqual(["r"]);
    expect(buckets.finished.map((m) => m.id)).toEqual(["f"]);
    expect(buckets.labels.map((m) => m.id)).toEqual(["l1", "l2"]);
  });

  it("isFinished 를 넘기면 '끝남'의 정의를 호출부가 넓힐 수 있다", () => {
    // 레인 탭은 진행률 100% 도 끝난 것으로 친다.
    const buckets = bucketMissionsByRunnability(
      [mission("a", "active"), mission("b", "active")],
      (m) => m.id === "a",
    );
    expect(buckets.finished.map((m) => m.id)).toEqual(["a"]);
    expect(buckets.running.map((m) => m.id)).toEqual(["b"]);
  });

  it("isFinished 가 implicit 을 running 으로 되돌리지 못한다", () => {
    // 호출부가 뭘 넘기든 라벨은 라벨이다 — 술어는 아예 호출되지 않는다.
    const buckets = bucketMissionsByRunnability(
      [mission("l", "active", "implicit")],
      () => false,
    );
    expect(buckets.running).toHaveLength(0);
    expect(buckets.labels.map((m) => m.id)).toEqual(["l"]);
  });

  it("빈 입력이면 세 버킷 모두 비어 있다", () => {
    const buckets = bucketMissionsByRunnability([]);
    expect(buckets).toEqual({ running: [], finished: [], labels: [] });
  });
});
