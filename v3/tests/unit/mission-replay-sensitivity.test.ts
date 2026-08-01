/**
 * Mission Replay — 민감도 분류/게이트의 **default-deny 계약** 테스트.
 *
 * 설계 `docs/MISSION-REPLAY-DESIGN.md` §5.2 P1 / §5.6-3 이 요구하는 "실행 가능한
 * 계약"이 이 파일이다. 핀하는 것:
 *
 *   1. 모르는 kind → `private`. `TimelineEventType`/`ProjectAuditEventType` 에
 *      가짜 새 값을 넣어도 분류 없이 자동으로 비공개다.
 *   2. 모르는 source → `private` (캐스팅으로 유니온을 우회해도).
 *   3. 등급 게이트는 **허용 목록**이다. `private` 은 L3 에서도 못 나간다 —
 *      "전체 공개"는 더 많은 종류의 내용을 뜻하지 레닭션 해제를 뜻하지 않는다.
 *   4. 모르는 등급/모르는 민감도 → 거부.
 *
 * ★이 테스트가 깨지면 완화 방향으로 고치지 말 것. 깨졌다는 건 새 이벤트 타입이
 * 분류 없이 들어왔다는 뜻이고, 그때 할 일은 게이트를 여는 게 아니라 그 타입을
 * 분류표에 올리는 것이다.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SENSITIVITY,
  VISIBLE_SENSITIVITIES,
  classifyBeatSensitivity,
  filterBeatsForVisibility,
  isSensitivityAllowed,
} from "../../src/lib/replay/sensitivity";
import type {
  ReplayBeat,
  ReplaySensitivity,
  ReplaySource,
  ReplayVisibilityLevel,
} from "../../src/types/missionReplay";

const LEVELS: ReplayVisibilityLevel[] = ["L0", "L1", "L2", "L3"];
const SOURCES: ReplaySource[] = [
  "mission.contextLog",
  "task",
  "task.activity",
  "audit_logs",
  "projectAuditLog",
  "merge_history",
];

function beat(overrides: Partial<ReplayBeat> = {}): ReplayBeat {
  return {
    id: "b1",
    ts: new Date("2026-08-01T00:00:00Z"),
    lane: "agent",
    source: "task",
    kind: "task.status",
    taskId: "t1",
    agentRef: null,
    actorRef: null,
    title: "t",
    sensitivity: "process",
    ...overrides,
  };
}

describe("default-deny 분류", () => {
  it("기본값 자체가 private 이다", () => {
    expect(DEFAULT_SENSITIVITY).toBe("private");
  });

  it("모든 소스에서 모르는 kind 는 private 으로 떨어진다", () => {
    for (const source of SOURCES) {
      // audit_logs 는 toolName 이 곧 kind 라 자유 문자열이 정상 입력이다 —
      // 대신 그 비트는 params 를 아예 안 싣기 때문에 process 로 고정된다.
      const expected = source === "audit_logs" ? "process" : "private";
      expect(
        classifyBeatSensitivity({ source, kind: "totally.unknown.kind" }),
        `${source} / unknown kind`,
      ).toBe(expected);
    }
  });

  it("TimelineEventType 에 새 값이 추가돼도 분류 없이는 private (§5.6-3)", () => {
    // 미래의 누군가가 types/mission.ts 에 한 줄 더 넣은 상황을 흉내낸다.
    const futureEventType = "orchestrator.whispered_a_secret";
    expect(
      classifyBeatSensitivity({
        source: "mission.contextLog",
        kind: futureEventType,
      }),
    ).toBe("private");
  });

  it("ProjectAuditEventType 에 새 값이 추가돼도 private", () => {
    expect(
      classifyBeatSensitivity({
        source: "projectAuditLog",
        kind: "member.exported_everything",
      }),
    ).toBe("private");
  });

  it("유니온 밖 소스가 캐스팅으로 새어 들어와도 private", () => {
    expect(
      classifyBeatSensitivity({
        source: "terminal.raw_output" as ReplaySource,
        kind: "anything",
      }),
    ).toBe("private");
  });

  it("프로토타입 오염 키(__proto__/constructor)도 private 으로 떨어진다", () => {
    // 표를 plain object 로 두면 `table["constructor"]` 가 함수를 돌려준다.
    // hasOwnProperty 로 걸러지는지 못 박는다 — 안 걸리면 분류가 함수가 되고
    // 뒤따르는 게이트 판정이 무슨 값을 내놓을지 알 수 없어진다.
    for (const kind of ["__proto__", "constructor", "toString"]) {
      for (const source of SOURCES) {
        const result = classifyBeatSensitivity({ source, kind });
        expect(
          ["private", "process"].includes(result),
          `${source}/${kind} → ${String(result)}`,
        ).toBe(true);
      }
    }
  });

  it("자유 텍스트를 들고 다니는 비트는 private 으로 분류된다", () => {
    // 산문은 마스킹 대상이 아니라 제외 대상(§5.2 P3).
    expect(
      classifyBeatSensitivity({
        source: "mission.contextLog",
        kind: "supervisor.note",
      }),
    ).toBe("private");
    expect(
      classifyBeatSensitivity({
        source: "mission.contextLog",
        kind: "user.input",
      }),
    ).toBe("private");
    expect(
      classifyBeatSensitivity({
        source: "task.activity",
        kind: "task.activity",
      }),
    ).toBe("private");
  });

  it("구조적 사실만 담는 비트는 process 다", () => {
    expect(
      classifyBeatSensitivity({
        source: "mission.contextLog",
        kind: "step.completed",
      }),
    ).toBe("process");
    expect(
      classifyBeatSensitivity({
        source: "merge_history",
        kind: "merge.recorded",
      }),
    ).toBe("process");
    expect(
      classifyBeatSensitivity({
        source: "projectAuditLog",
        kind: "task.status_changed",
      }),
    ).toBe("process");
  });

  it("태스크 제목을 실어 나르는 비트는 summary 로 내려간다 (L1 에서 제외)", () => {
    // 전이 자체는 process 급 사실이지만 title 이 자유 텍스트라 비트 단위로는
    // 더 민감한 쪽에 맞춘다(§5.2 P2 — 오탐은 회복 가능, 미탐은 회복 불가).
    expect(
      classifyBeatSensitivity({ source: "task", kind: "task.status" }),
    ).toBe("summary");
    expect(
      classifyBeatSensitivity({
        source: "task.activity",
        kind: "task.completion_report",
      }),
    ).toBe("summary");
  });
});

describe("공개 게이트 — 명시 허용만 통과", () => {
  it("private 은 어떤 등급에서도 못 나간다 (L3 포함)", () => {
    for (const level of LEVELS) {
      expect(isSensitivityAllowed("private", level), level).toBe(false);
      expect(VISIBLE_SENSITIVITIES[level]).not.toContain("private");
    }
  });

  it("L0 은 아무것도 통과시키지 않는다", () => {
    const all: ReplaySensitivity[] = [
      "private",
      "process",
      "summary",
      "detail",
    ];
    for (const sensitivity of all) {
      expect(isSensitivityAllowed(sensitivity, "L0"), sensitivity).toBe(false);
    }
  });

  it("등급이 올라갈수록 허용 집합이 커지기만 한다 (단조)", () => {
    for (let i = 1; i < LEVELS.length; i += 1) {
      const lower = VISIBLE_SENSITIVITIES[LEVELS[i - 1]];
      const upper = VISIBLE_SENSITIVITIES[LEVELS[i]];
      for (const sensitivity of lower) {
        expect(upper, `${LEVELS[i - 1]} ⊆ ${LEVELS[i]}`).toContain(sensitivity);
      }
    }
  });

  it("L1=과정만, L2=+요약, L3=+발췌", () => {
    expect(isSensitivityAllowed("process", "L1")).toBe(true);
    expect(isSensitivityAllowed("summary", "L1")).toBe(false);
    expect(isSensitivityAllowed("summary", "L2")).toBe(true);
    expect(isSensitivityAllowed("detail", "L2")).toBe(false);
    expect(isSensitivityAllowed("detail", "L3")).toBe(true);
  });

  it("모르는 등급 / 모르는 민감도 / null 은 전부 거부", () => {
    expect(isSensitivityAllowed("process", "L4")).toBe(false);
    expect(isSensitivityAllowed("process", "")).toBe(false);
    expect(isSensitivityAllowed("process", null)).toBe(false);
    expect(isSensitivityAllowed("process", undefined)).toBe(false);
    expect(isSensitivityAllowed("public", "L3")).toBe(false);
    expect(isSensitivityAllowed(null, "L3")).toBe(false);
    expect(isSensitivityAllowed(undefined, "L3")).toBe(false);
    // 프로토타입 체인으로 등급을 우회할 수 없다.
    expect(isSensitivityAllowed("process", "constructor")).toBe(false);
    expect(isSensitivityAllowed("constructor", "L3")).toBe(false);
  });

  it("filterBeatsForVisibility 는 등급을 통과한 비트만 남긴다", () => {
    const beats = [
      beat({ id: "p", sensitivity: "process" }),
      beat({ id: "s", sensitivity: "summary" }),
      beat({ id: "x", sensitivity: "private" }),
      beat({ id: "d", sensitivity: "detail" }),
    ];
    expect(filterBeatsForVisibility(beats, "L0")).toEqual([]);
    expect(filterBeatsForVisibility(beats, "L1").map((b) => b.id)).toEqual([
      "p",
    ]);
    expect(filterBeatsForVisibility(beats, "L2").map((b) => b.id)).toEqual([
      "p",
      "s",
    ]);
    expect(filterBeatsForVisibility(beats, "L3").map((b) => b.id)).toEqual([
      "p",
      "s",
      "d",
    ]);
  });

  it("분류가 통째로 빠진 비트(옛 데이터)도 게이트에서 거부된다", () => {
    const unclassified = {
      ...beat(),
      sensitivity: undefined,
    } as unknown as ReplayBeat;
    for (const level of LEVELS) {
      expect(filterBeatsForVisibility([unclassified], level), level).toEqual(
        [],
      );
    }
  });
});
