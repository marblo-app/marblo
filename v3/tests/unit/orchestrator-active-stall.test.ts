// 활성 정체(active stall) 감지 회귀 (티켓 Z4095CT4CpAuTVtnAp9l).
//
// 고정하는 계약:
//   ① ★오케가 busy(활성)인데 판정 창(기본 10분) 동안 티켓 전이·dispatch·PR
//      진전이 전부 0이면 "활성 정체" — 유휴 스위프·자율 픽업이 못 보는 축이다
//      (오케가 사장님과 대화 중이라 유휴가 아니었던 2026-09-05 사건의 직접 회귀).
//   ② 오케가 유휴면 이 축의 관심사가 아니다(유휴 스위프가 담당 — 이중 감시 금지).
//   ③ 판정은 **벽시계**로 잰다 — 스위프 틱 횟수나 출력량이 아니라 실제 진전
//      이벤트의 시각과 활성 구간 시작 시각만 본다(composer-gate 의 함정 회피).
//   ④ 세 축 중 하나라도 알려진 게 없으면(전부 undefined) 정체를 주장하지 않는다.
//   ⑤ 한도는 #1414/#1416 의 것 그대로 — 연속 5 초과 HALT, 정체 2 초과 HALT.
//   ⑥ 사장님 입력이 자율 진행보다 우선한다.
//   ⑦ 같은 정체를 쿨다운(기본 = 판정 창) 안에 다시 알리지 않는다(폭주 방지).

import { describe, expect, it } from "vitest";
import {
  DEFAULT_ADVANCE_CAPS,
  emptyAdvanceState,
  type AdvanceStateSnapshot,
} from "../../electron/mcp-server/advance-guards";
import {
  ACTIVE_STALL_WINDOW_MS,
  evaluateActiveStall,
  formatActiveStall,
  isActiveStall,
  type ActiveStallInput,
  type ActiveStallProgress,
} from "../../electron/orchestrator-active-stall";

const NOW = 10_000_000;
const WINDOW = ACTIVE_STALL_WINDOW_MS; // 10분

function progress(
  over: Partial<ActiveStallProgress> = {},
): ActiveStallProgress {
  return {
    lastTicketTransitionAt: null,
    lastDispatchAt: null,
    lastPrStateChangeAt: null,
    ...over,
  };
}

function state(over: Partial<AdvanceStateSnapshot> = {}): AdvanceStateSnapshot {
  return { ...emptyAdvanceState(), ...over };
}

function input(over: Partial<ActiveStallInput> = {}): ActiveStallInput {
  return {
    enabled: true,
    sessionRunning: true,
    now: NOW,
    orchBusy: true,
    activeSince: NOW - WINDOW,
    progress: progress(),
    lastSignaledAt: null,
    ownerInputPending: false,
    state: state(),
    openCount: 4,
    ...over,
  };
}

// ── ①·③ isActiveStall — 순수 판정 진리표 ────────────────────────────────────

describe("isActiveStall — 세 축이 전부 0(또는 모름)이고 창을 채웠는가", () => {
  it("★오케가 busy 고 활성 구간이 창을 채웠고 세 축이 전부 조용하면 정체다", () => {
    expect(isActiveStall(NOW, true, NOW - WINDOW, progress(), WINDOW)).toBe(
      true,
    );
  });

  it("오케가 유휴면 정체가 아니다 — 유휴 스위프의 관심사다", () => {
    expect(isActiveStall(NOW, false, NOW - WINDOW, progress(), WINDOW)).toBe(
      false,
    );
  });

  it("활성 구간을 모르면(null) 정체가 아니다", () => {
    expect(isActiveStall(NOW, true, null, progress(), WINDOW)).toBe(false);
  });

  it("활성 구간이 아직 창에 못 미치면 정체가 아니다", () => {
    expect(
      isActiveStall(NOW, true, NOW - (WINDOW - 1), progress(), WINDOW),
    ).toBe(false);
  });

  it("티켓 전이가 창 안에 있으면 정체가 아니다", () => {
    expect(
      isActiveStall(
        NOW,
        true,
        NOW - WINDOW,
        progress({ lastTicketTransitionAt: NOW - 1_000 }),
        WINDOW,
      ),
    ).toBe(false);
  });

  it("dispatch 가 창 안에 있으면 정체가 아니다", () => {
    expect(
      isActiveStall(
        NOW,
        true,
        NOW - WINDOW,
        progress({ lastDispatchAt: NOW - 1_000 }),
        WINDOW,
      ),
    ).toBe(false);
  });

  it("PR 변화가 창 안에 있으면 정체가 아니다", () => {
    expect(
      isActiveStall(
        NOW,
        true,
        NOW - WINDOW,
        progress({ lastPrStateChangeAt: NOW - 1_000 }),
        WINDOW,
      ),
    ).toBe(false);
  });

  it("★PR 축이 배선 안 됐어도(undefined) 다른 두 축이 조용하면 정체다 — 모름이 진행중을 위장하지 않는다", () => {
    expect(
      isActiveStall(
        NOW,
        true,
        NOW - WINDOW,
        progress({ lastPrStateChangeAt: undefined }),
        WINDOW,
      ),
    ).toBe(true);
  });

  it("★세 축이 전부 배선 안 됐으면(전부 undefined) 정체를 주장하지 않는다 — 근거 없음", () => {
    expect(
      isActiveStall(
        NOW,
        true,
        NOW - WINDOW,
        {
          lastTicketTransitionAt: undefined as unknown as number | null,
          lastDispatchAt: undefined as unknown as number | null,
          lastPrStateChangeAt: undefined,
        },
        WINDOW,
      ),
    ).toBe(false);
  });
});

// ── 결정 코어 — 안 밀 자리 ───────────────────────────────────────────────────

describe("evaluateActiveStall — 신호를 내지 않는 자리", () => {
  it("플래그 OFF 면 아무것도 하지 않는다(기본값 OFF)", () => {
    const d = evaluateActiveStall(input({ enabled: false }));
    expect(d.action).toBe("NO_SIGNAL");
    expect(d.code).toBe("flag-off");
    expect(d.message).toBe("");
  });

  it("오케 세션이 없으면 하지 않는다", () => {
    expect(evaluateActiveStall(input({ sessionRunning: false })).code).toBe(
      "no-session",
    );
  });

  it("★오케가 유휴면 이 축의 관심사가 아니다", () => {
    const d = evaluateActiveStall(input({ orchBusy: false }));
    expect(d.action).toBe("NO_SIGNAL");
    expect(d.code).toBe("orch-idle");
  });

  it("활성 구간이 아직 판정 창에 못 미치면 기다린다", () => {
    const d = evaluateActiveStall(input({ activeSince: NOW - (WINDOW - 1) }));
    expect(d.code).toBe("warming-up");
  });

  it("★판정 창 안에 진전이 있었으면 정체가 아니다", () => {
    const d = evaluateActiveStall(
      input({
        progress: progress({ lastTicketTransitionAt: NOW - 60_000 }),
      }),
    );
    expect(d.code).toBe("making-progress");
    expect(d.message).toBe("");
  });

  it("이미 HALT 면 조용히 빠진다 — 같은 정지를 매 틱 떠들지 않는다", () => {
    const d = evaluateActiveStall(
      input({ state: state({ haltReason: "연속 자율 스폰 한도 도달" }) }),
    );
    expect(d.action).toBe("NO_SIGNAL");
    expect(d.code).toBe("already-halted");
    expect(d.message).toBe("");
  });

  it("★쿨다운 안이면 같은 정체를 다시 알리지 않는다", () => {
    const d = evaluateActiveStall(
      input({ lastSignaledAt: NOW - (WINDOW - 1) }),
    );
    expect(d.action).toBe("NO_SIGNAL");
    expect(d.code).toBe("cooldown");
  });

  it("쿨다운이 지났으면 다시 신호를 낸다", () => {
    const d = evaluateActiveStall(input({ lastSignaledAt: NOW - WINDOW }));
    expect(d.action).toBe("SIGNAL");
  });

  it("사장님 입력이 대기 중이면 보류한다", () => {
    const d = evaluateActiveStall(input({ ownerInputPending: true }));
    expect(d.action).toBe("NO_SIGNAL");
    expect(d.code).toBe("owner-input-pending");
  });
});

// ── 한도 — #1414/#1416 의 것을 그대로 탄다 ──────────────────────────────────

describe("evaluateActiveStall — 한도는 기존 캡 아래에 있다", () => {
  it("★연속 신호가 5에 닿으면 HALT 하고 사유를 남긴다", () => {
    const d = evaluateActiveStall(
      input({
        state: state({
          consecutiveSignals: DEFAULT_ADVANCE_CAPS.maxConsecutiveSignals,
        }),
      }),
    );
    expect(d.action).toBe("HALT");
    expect(d.code).toBe("consecutive-spawn-cap");
    expect(d.haltReason).toBeTruthy();
    expect(d.message).toContain("정지");
  });

  it("4회까지는 신호를 내고 카운터가 1 올라간다", () => {
    const d = evaluateActiveStall(
      input({ state: state({ consecutiveSignals: 4 }) }),
    );
    expect(d.action).toBe("SIGNAL");
    expect(d.nextState?.consecutiveSignals).toBe(5);
  });

  it("★열린 항목이 안 줄어든 채 정체 한도를 넘으면 HALT", () => {
    const d = evaluateActiveStall(
      input({
        openCount: 9,
        state: state({
          lastOpenCount: 9,
          stagnantSignals: DEFAULT_ADVANCE_CAPS.maxStagnantSignals,
        }),
      }),
    );
    expect(d.action).toBe("HALT");
    expect(d.code).toBe("no-progress");
  });
});

// ── 신호 본문 ──────────────────────────────────────────────────────────────

describe("formatActiveStall — 무엇이 멈췄는지 담는다", () => {
  it('★"계속 돌아라"가 아니라 진전 없는 사실과 배경 수치를 담는다', () => {
    const msg = formatActiveStall({
      activeForMs: WINDOW,
      windowMs: WINDOW,
      context: { reviewCount: 17, stuckPrCount: 3 },
    });
    expect(msg).not.toContain("계속 돌아라");
    expect(msg).toContain("REVIEW 대기 17건");
    expect(msg).toContain("PR 3건 정체");
    expect(msg).toContain("활성 정체 감지로 처리");
  });
});

// ── 완료 기준의 두 시나리오 (티켓 본문 그대로) ───────────────────────────────

describe("완료 기준 시나리오", () => {
  it('★"오케 활성 + REVIEW 17건 + PR 3건 정체 + 10분간 상태 전이 0" → 밀어야 한다', () => {
    const d = evaluateActiveStall(
      input({
        orchBusy: true,
        activeSince: NOW - WINDOW,
        progress: progress(), // 이번 활성 구간에 세 축 전부 없었다
        ownerInputPending: false, // 사장님은 PTY 로 직접 대화 중이지 인바운드 큐가 아니다
        openCount: 17 + 3,
        context: { reviewCount: 17, stuckPrCount: 3 },
      }),
    );
    expect(d.action).toBe("SIGNAL");
    expect(d.code).toBe("stalled");
    expect(d.message).toContain("[활성 정체]");
    expect(d.message).toContain("REVIEW 대기 17건");
    expect(d.message).toContain("PR 3건 정체");
  });

  it('★"오케 활성 + 5분 사이 티켓 2건 DONE 전이" → 밀지 않는다', () => {
    const d = evaluateActiveStall(
      input({
        orchBusy: true,
        // 활성 구간은 충분히 길다(창을 이미 채웠다) — 그런데도 최근 5분 안에
        // 진전이 있었으므로 정체가 아니다.
        activeSince: NOW - 12 * 60_000,
        progress: progress({ lastTicketTransitionAt: NOW - 5 * 60_000 }),
      }),
    );
    expect(d.action).toBe("NO_SIGNAL");
    expect(d.code).toBe("making-progress");
  });
});
