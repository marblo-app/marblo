// PROCEED 무반응 재호출 회귀 (티켓 xKhErJdSwDH3LIItFe42, P2→P1 격상).
//
// 고정하는 계약:
//   ① ★판정 창(10분, ACTIVE_STALL_WINDOW_MS 재사용)을 넘겨야 재호출 후보다.
//   ② 같은 미션을 쿨다운(기본 = 판정 창) 안에 다시 안 부른다(폭주 방지).
//   ③ 다이제스트 1통 — 정체 미션마다 메시지를 쏘지 않는다.
//   ④ 한도(연속/정체 신호)는 advance-guards 의 것 그대로 — 새로 안 만든다.
//   ⑤ 사장님 입력이 우선한다(guard 위임).
//   ⑥ ★자동 실행이 없다 — 오케 PTY 로 갈 "재호출" 문자열만 만든다. dispatch_task/
//      spawn_agent/update_task_status 를 대신 호출하는 코드가 이 파일 어디에도 없다.
//   ⑦ ★조용한 포기 금지 — HALT 일 때만 사장님 에스컬레이션 본문이 채워진다.
//      SIGNAL/NO_SIGNAL 이면 반드시 빈 문자열이다.

import { describe, expect, it } from "vitest";
import {
  emptyAdvanceState,
  type AdvanceStateSnapshot,
} from "../../electron/mcp-server/advance-guards";
import {
  MISSION_RECALL_WINDOW_MS,
  evaluateMissionRecall,
  formatMissionRecall,
  formatMissionRecallEscalation,
  formatMissionRecallHalt,
  isProceedOverdue,
  selectRecallableMissions,
  type MissionRecallInput,
  type StalledProceedMission,
} from "../../electron/orchestrator-mission-recall";

const NOW = 10_000_000;
const WINDOW = MISSION_RECALL_WINDOW_MS; // 10분

function mission(
  over: Partial<StalledProceedMission> = {},
): StalledProceedMission {
  return {
    missionId: "mission_abc123",
    label: "결제 리팩터",
    handoffAskedAt: NOW - WINDOW,
    nextTaskId: "task_next1",
    nextWhat: "결제 리팩터 2단계 착수",
    ...over,
  };
}

function state(over: Partial<AdvanceStateSnapshot> = {}): AdvanceStateSnapshot {
  return { ...emptyAdvanceState(), ...over };
}

function input(over: Partial<MissionRecallInput> = {}): MissionRecallInput {
  return {
    enabled: true,
    sessionRunning: true,
    now: NOW,
    missions: [mission()],
    recalledAt: new Map(),
    ownerInputPending: false,
    state: state(),
    ...over,
  };
}

// ── ① isProceedOverdue — 순수 판정 ───────────────────────────────────────────

describe("isProceedOverdue — handoffAskedAt 이 판정 창을 채웠는가", () => {
  it("★PROCEED 이후 판정 창을 채웠으면 무반응 후보다", () => {
    expect(isProceedOverdue(mission(), NOW, WINDOW)).toBe(true);
  });

  it("판정 창에 아직 못 미치면 후보가 아니다", () => {
    expect(
      isProceedOverdue(
        mission({ handoffAskedAt: NOW - (WINDOW - 1) }),
        NOW,
        WINDOW,
      ),
    ).toBe(false);
  });

  it("정확히 창에 닿으면 후보다(경계 포함)", () => {
    expect(
      isProceedOverdue(mission({ handoffAskedAt: NOW - WINDOW }), NOW, WINDOW),
    ).toBe(true);
  });
});

// ── ② selectRecallableMissions — 쿨다운 ──────────────────────────────────────

describe("selectRecallableMissions — 쿨다운 안이면 다시 안 부른다", () => {
  it("창을 안 넘겼으면 후보가 아니다", () => {
    const fresh = mission({ handoffAskedAt: NOW - 1_000 });
    expect(
      selectRecallableMissions([fresh], NOW, new Map(), WINDOW, WINDOW),
    ).toEqual([]);
  });

  it("창을 넘겼는데 부른 적 없으면 후보다", () => {
    const stalled = mission();
    expect(
      selectRecallableMissions([stalled], NOW, new Map(), WINDOW, WINDOW),
    ).toEqual([stalled]);
  });

  it("★방금 불렀으면(쿨다운 안) 같은 미션을 다시 안 부른다", () => {
    const stalled = mission();
    const recalledAt = new Map([[stalled.missionId, NOW - 1_000]]);
    expect(
      selectRecallableMissions([stalled], NOW, recalledAt, WINDOW, WINDOW),
    ).toEqual([]);
  });

  it("쿨다운이 지났으면 다시 후보다", () => {
    const stalled = mission();
    const recalledAt = new Map([[stalled.missionId, NOW - WINDOW]]);
    expect(
      selectRecallableMissions([stalled], NOW, recalledAt, WINDOW, WINDOW),
    ).toEqual([stalled]);
  });

  it("여러 미션 중 창을 넘긴 것만 남는다", () => {
    const stalled = mission({ missionId: "mission_stalled" });
    const fresh = mission({
      missionId: "mission_fresh",
      handoffAskedAt: NOW - 1_000,
    });
    expect(
      selectRecallableMissions(
        [stalled, fresh],
        NOW,
        new Map(),
        WINDOW,
        WINDOW,
      ),
    ).toEqual([stalled]);
  });
});

// ── ④⑤ evaluateMissionRecall — 전체 판정 ────────────────────────────────────

describe("evaluateMissionRecall — 판정 순서", () => {
  it("플래그 OFF 면 아무것도 안 한다", () => {
    const d = evaluateMissionRecall(input({ enabled: false }));
    expect(d.action).toBe("NO_SIGNAL");
    expect(d.code).toBe("flag-off");
  });

  it("세션이 없으면 안 한다", () => {
    const d = evaluateMissionRecall(input({ sessionRunning: false }));
    expect(d.action).toBe("NO_SIGNAL");
    expect(d.code).toBe("no-session");
  });

  it("이미 HALT 상태면 조용히 빠진다(메시지·에스컬레이션 없음)", () => {
    const d = evaluateMissionRecall(
      input({ state: state({ haltReason: "테스트 정지" }) }),
    );
    expect(d.action).toBe("NO_SIGNAL");
    expect(d.code).toBe("already-halted");
    expect(d.message).toBe("");
    expect(d.ownerEscalationMessage).toBe("");
  });

  it("무반응 미션이 없으면 안 한다", () => {
    const d = evaluateMissionRecall(
      input({ missions: [mission({ handoffAskedAt: NOW - 1_000 })] }),
    );
    expect(d.action).toBe("NO_SIGNAL");
    expect(d.code).toBe("no-candidates");
  });

  it("★무반응 미션이 있으면 재호출 신호를 낸다", () => {
    const d = evaluateMissionRecall(input());
    expect(d.action).toBe("SIGNAL");
    expect(d.message).toContain("[PROCEED 재호출]");
    expect(d.message).toContain(mission().nextTaskId);
    expect(d.recalledIds).toEqual([mission().missionId]);
    expect(d.ownerEscalationMessage).toBe("");
  });

  it("사장님 입력이 대기 중이면 guard 가 보류시킨다", () => {
    const d = evaluateMissionRecall(input({ ownerInputPending: true }));
    expect(d.action).toBe("NO_SIGNAL");
    expect(d.code).toBe("owner-input-pending");
  });

  it("★연속 신호 한도를 넘으면 HALT 하고 사장님 에스컬레이션 본문을 채운다 — 새 한도를 안 만들고 기존 것을 쓴다", () => {
    const d = evaluateMissionRecall(
      input({ state: state({ consecutiveSignals: 5 }) }),
    );
    expect(d.action).toBe("HALT");
    expect(d.haltReason).toBeTruthy();
    expect(d.message).toContain("[PROCEED 재호출]");
    // ★조용한 포기 금지 — HALT 는 반드시 사장님 에스컬레이션 본문을 들고 있다.
    expect(d.ownerEscalationMessage).toContain("🚨 [PROCEED 무반응]");
    expect(d.ownerEscalationMessage).toContain(mission().missionId);
  });

  it("여러 미션이 무반응이면 다이제스트 1통에 전부 담는다", () => {
    const a = mission({ missionId: "mission_a", label: "A 미션" });
    const b = mission({ missionId: "mission_b", label: "B 미션" });
    const d = evaluateMissionRecall(input({ missions: [a, b] }));
    expect(d.action).toBe("SIGNAL");
    expect(d.message).toContain("A 미션");
    expect(d.message).toContain("B 미션");
    expect(d.recalledIds).toEqual(["mission_a", "mission_b"]);
  });
});

// ── ⑥ 재호출까지다 — 대신 실행하지 않는다 ────────────────────────────────────

describe("★재호출 문구 — 대신 dispatch/claim 하지 않는다", () => {
  it("미션 id·근거 티켓 id·경과 시간을 담고, 오케에게 행동을 미룬다", () => {
    const msg = formatMissionRecall([mission()], NOW);
    expect(msg).toContain(mission().missionId);
    expect(msg).toContain(mission().nextTaskId);
    expect(msg).toContain("dispatch/claim");
    // ★"내가 대신 진행했다" 류의 1인칭 실행 서술이 없다.
    expect(msg).not.toMatch(/진행했습니다|배정했습니다|시작했습니다/);
  });

  it("HALT 문구도 사람이 볼 곳에 사유를 남긴다", () => {
    const msg = formatMissionRecallHalt("연속 5회 초과");
    expect(msg).toContain("연속 5회 초과");
    expect(msg).toContain("사장님 지시가 오면 해제된다");
  });

  it("에스컬레이션 문구는 미션 id 와 경과 시간을 담는다", () => {
    const msg = formatMissionRecallEscalation([mission()], NOW);
    expect(msg).toContain(mission().missionId);
    expect(msg).toContain("확인해 주세요");
  });
});
