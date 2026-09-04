/**
 * 티켓 Sf8Id64jLeyDvWIS4cub — 미션 전진 신호의 **안전장치 층**.
 *
 * 사장님 지시: "무한루프랑 비용폭주는 방지하도록 설계만 잘해주고 가자."
 * 그래서 이 스위트가 전진 로직보다 먼저 있고, 고정하는 것은 하나다 —
 * **한도에 걸리면 멈추고, 멈춤에는 반드시 사유가 남는다.**
 * 조용히 멈추면 오늘 고친 #1412 의 문제가 그대로 재발한다.
 *
 * 설계: v3/docs/mission-advance-signal-design-2026-09-04.md §7.
 */
import { describe, it, expect } from "vitest";
import {
  ADVANCE_SIGNAL_ENV,
  DEFAULT_ADVANCE_CAPS,
  alreadySignaled,
  detectApprovalSignals,
  emptyAdvanceState,
  evaluateAdvanceGuards,
  evaluateSlotPressure,
  isAdvanceSignalEnabled,
  requiresOwnerApproval,
  type AdvanceStateSnapshot,
} from "../../electron/mcp-server/advance-guards";

const state = (
  over: Partial<AdvanceStateSnapshot> = {},
): AdvanceStateSnapshot => ({
  ...emptyAdvanceState(),
  ...over,
});

type GuardArgs = Parameters<typeof evaluateAdvanceGuards>[0];

const guard = (over: Partial<GuardArgs> = {}) =>
  evaluateAdvanceGuards({
    state: state(),
    openCount: 3,
    ownerInputPending: false,
    ...over,
  });

// ── 기본값 OFF ──────────────────────────────────────────────────────────────

describe("플래그 — 기본값 OFF", () => {
  it("미설정이면 꺼져 있다", () => {
    expect(isAdvanceSignalEnabled({})).toBe(false);
  });

  it("정확히 'on' 일 때만 켜진다 (대소문자·공백은 허용)", () => {
    expect(isAdvanceSignalEnabled({ [ADVANCE_SIGNAL_ENV]: "on" })).toBe(true);
    expect(isAdvanceSignalEnabled({ [ADVANCE_SIGNAL_ENV]: " ON " })).toBe(true);
  });

  it("오타·유사값·빈 값은 전부 OFF — 비용이 나가는 스위치는 좁게 받는다", () => {
    for (const v of [
      "",
      " ",
      "true",
      "1",
      "yes",
      "ON!",
      "onn",
      "off",
      "orchestrator",
    ]) {
      expect(isAdvanceSignalEnabled({ [ADVANCE_SIGNAL_ENV]: v })).toBe(false);
    }
  });
});

// ── 한도 1: 연속 자율 스폰 ──────────────────────────────────────────────────

describe("한도 — 연속 자율 스폰", () => {
  it("한도 미만이면 통과한다", () => {
    const d = guard({ state: state({ consecutiveSignals: 4 }) });
    expect(d.outcome).toBe("pass");
  });

  it("한도에 도달하면 멈추고 사유가 남는다", () => {
    const d = guard({ state: state({ consecutiveSignals: 5 }) });
    expect(d.outcome).toBe("halt");
    expect(d.code).toBe("consecutive-spawn-cap");
    expect(d.reason).not.toBe("");
    // 사유가 "몇 번 중 몇 번" 인지 말해야 사람이 판단할 수 있다.
    expect(d.reason).toContain("5/5");
  });

  it("캡은 주입 가능하다 — 사장님이 조정하실 값", () => {
    const d = guard({
      state: state({ consecutiveSignals: 1 }),
      caps: { ...DEFAULT_ADVANCE_CAPS, maxConsecutiveSignals: 1 },
    });
    expect(d.outcome).toBe("halt");
  });
});

// ── 한도 2: 동시 슬롯 (back-pressure) ───────────────────────────────────────

describe("한도 — 동시 슬롯", () => {
  it("한도 미만이면 포화가 아니다", () => {
    expect(evaluateSlotPressure(2).saturated).toBe(false);
  });

  it("한도에 도달하면 포화이고 사유가 남는다", () => {
    const p = evaluateSlotPressure(3);
    expect(p.saturated).toBe(true);
    expect(p.reason).toContain("3/3");
  });

  it("★HALT 가 아니다 — 티켓이 끝나면 자연히 풀리는 back-pressure", () => {
    // 슬롯은 guard 판정에 들어가지 않는다(전진 로직에서 readyNow 만 비운다).
    const d = guard({ state: state({ consecutiveSignals: 0 }) });
    expect(d.outcome).toBe("pass");
  });
});

// ── 한도 3: 진행 없음 (무한루프의 실제 모양) ────────────────────────────────

describe("한도 — 진행 없음", () => {
  it("열린 티켓이 줄면 stagnant 가 0으로 리셋된다", () => {
    const d = guard({
      state: state({ stagnantSignals: 2, lastOpenCount: 5 }),
      openCount: 4,
    });
    expect(d.outcome).toBe("pass");
    expect(d.nextStagnantSignals).toBe(0);
  });

  it("안 줄면 누적된다", () => {
    const d = guard({
      state: state({ stagnantSignals: 0, lastOpenCount: 5 }),
      openCount: 5,
    });
    expect(d.outcome).toBe("pass");
    expect(d.nextStagnantSignals).toBe(1);
  });

  it("★늘어나도 진행 없음이다 — 오케가 형제를 집는 대신 새 티켓을 더 만드는 모양", () => {
    const d = guard({
      state: state({ stagnantSignals: 1, lastOpenCount: 5 }),
      openCount: 8,
    });
    expect(d.nextStagnantSignals).toBe(2);
  });

  it("한도를 넘으면 멈추고 사유에 실제 수치가 남는다", () => {
    const d = guard({
      state: state({ stagnantSignals: 2, lastOpenCount: 5 }),
      openCount: 5,
    });
    expect(d.outcome).toBe("halt");
    expect(d.code).toBe("no-progress");
    expect(d.reason).toContain("5건");
    expect(d.reason).not.toBe("");
  });

  it("첫 신호(직전 관측 없음)는 stagnant 로 세지 않는다", () => {
    const d = guard({
      state: state({ lastOpenCount: undefined }),
      openCount: 9,
    });
    expect(d.outcome).toBe("pass");
    expect(d.nextStagnantSignals).toBe(0);
  });
});

// ── 우선순위 ────────────────────────────────────────────────────────────────

describe("우선순위", () => {
  it("★사장님 입력이 오면 자율 진행보다 항상 우선한다", () => {
    const d = guard({ ownerInputPending: true });
    expect(d.outcome).toBe("hold");
    expect(d.code).toBe("owner-input-pending");
    expect(d.reason).not.toBe("");
  });

  it("사장님 입력은 hold 이지 halt 가 아니다 — 입력이 처리되면 스스로 재개된다", () => {
    expect(guard({ ownerInputPending: true }).outcome).toBe("hold");
    expect(guard({ ownerInputPending: false }).outcome).toBe("pass");
  });

  it("사장님 입력이 한도 판정보다 앞선다", () => {
    const d = guard({
      ownerInputPending: true,
      state: state({ consecutiveSignals: 99 }),
    });
    expect(d.code).toBe("owner-input-pending");
  });

  it("이미 HALT 면 최초 사유를 새 사유로 덮지 않는다", () => {
    const d = guard({
      state: state({
        haltReason: "no-progress: 열린 티켓 5건 고정",
        consecutiveSignals: 99,
      }),
    });
    expect(d.outcome).toBe("halt");
    expect(d.code).toBe("already-halted");
    expect(d.reason).toContain("열린 티켓 5건 고정");
  });
});

// ── 승인 필요 작업 ──────────────────────────────────────────────────────────

describe("승인 필요 작업 — 자율 스폰 대상에서 제외", () => {
  it("사장님이 지목하신 네 갈래를 전부 잡는다", () => {
    expect(requiresOwnerApproval({ title: "프로덕션 배포" })).toBe(true);
    expect(requiresOwnerApproval({ title: "가입자 전체 메일 발송" })).toBe(
      true,
    );
    expect(requiresOwnerApproval({ title: "결제 모듈 전환" })).toBe(true);
    expect(
      requiresOwnerApproval({ title: "심사 기간 중 온보딩 화면 변경" }),
    ).toBe(true);
  });

  it("영문 표기도 잡는다", () => {
    expect(requiresOwnerApproval({ title: "deploy to production" })).toBe(true);
    expect(
      requiresOwnerApproval({ description: "needs approval before rollout" }),
    ).toBe(true);
  });

  it("★본문(description)도 스캔한다 — 여기서는 누락이 오탐보다 무겁다", () => {
    expect(
      requiresOwnerApproval({
        title: "후속 정리",
        description: "마지막 단계에서 배포까지 진행한다",
      }),
    ).toBe(true);
  });

  it("comment / notes 도 스캔한다", () => {
    expect(requiresOwnerApproval({ comment: "승인 필요" })).toBe(true);
    expect(requiresOwnerApproval({ notes: ["환불 처리 포함"] })).toBe(true);
  });

  it("부정어는 오탐하지 않는다", () => {
    expect(requiresOwnerApproval({ title: "리팩터링 — 배포 없음" })).toBe(
      false,
    );
    expect(requiresOwnerApproval({ comment: "결제 아님, 화면만 수정" })).toBe(
      false,
    );
    expect(requiresOwnerApproval({ description: "no deploy required" })).toBe(
      false,
    );
  });

  it("한 번이라도 부정되지 않은 등장이 있으면 살아 있는 표지다", () => {
    expect(
      requiresOwnerApproval({
        description: "이번 단계는 배포 없음. 그러나 마무리에 배포가 필요하다",
      }),
    ).toBe(true);
  });

  it("잡힌 표지를 돌려준다 — 사유 없는 제외는 사유 없는 정지만큼 나쁘다", () => {
    const signals = detectApprovalSignals({
      title: "스토어 심사 기간 결제 화면 변경",
    });
    expect(signals.length).toBeGreaterThan(0);
    expect(signals).toContain("결제");
  });

  it("무관한 티켓은 승인 필요가 아니다", () => {
    expect(
      requiresOwnerApproval({
        title: "유닛 테스트 보강",
        description: "게이트 판정 분기를 전수로 고정한다",
        comment: "진행 중",
      }),
    ).toBe(false);
  });
});

// ── 중복 방지 ───────────────────────────────────────────────────────────────

describe("중복 방지", () => {
  it("이미 신호를 낸 티켓은 다시 세지 않는다", () => {
    const s = state({ signaledTaskIds: ["t1", "t2"] });
    expect(alreadySignaled(s, "t1")).toBe(true);
    expect(alreadySignaled(s, "t3")).toBe(false);
  });
});
