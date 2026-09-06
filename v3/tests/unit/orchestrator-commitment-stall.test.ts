// 약속 정체(commitment stall) 감지 회귀 (티켓 WLC9OjIJ8lbCAuz6WlNG).
//
// 고정하는 계약:
//   ① ★진전은 항목의 updatedAt 이다 — 포착된 뒤 아무도 안 건드렸으면 정체.
//      티켓이 생겨도 update_work_chain_item 으로 붙이지 않으면(실측 사례
//      "네이버 티켓을 만들어놓고 배치를 안 했다") 여전히 정체로 본다.
//   ② `orchestrator-active-stall.ts`(보드 전체)와는 다른 축이다 — 오케가
//      계속 바쁘게 다른 일을 해도, 이 항목 하나가 안 움직이면 그것으로 정체.
//   ③ 같은 항목을 쿨다운(기본 = 판정 창) 안에 다시 안 묻는다(폭주 방지).
//   ④ 다이제스트 1통 — 정체 항목마다 메시지를 쏘지 않는다.
//   ⑤ 한도(연속/정체 신호)는 advance-guards 의 것 그대로 — 새로 안 만든다.
//   ⑥ 사장님 입력이 우선한다(guard 위임).
//   ⑦ ★자동 실행이 없다 — 이 모듈은 오케 PTY 로 갈 "질문" 문자열만 만든다.
//      update_work_chain_item 을 대신 호출하는 코드가 이 파일 어디에도 없다.

import { describe, expect, it } from "vitest";
import {
  emptyAdvanceState,
  type AdvanceStateSnapshot,
} from "../../electron/mcp-server/advance-guards";
import {
  COMMITMENT_STALL_WINDOW_MS,
  evaluateCommitmentStall,
  formatCommitmentStallHalt,
  formatCommitmentStallQuestion,
  isCommitmentStalled,
  selectAskableStalledCommitments,
  type CommitmentItem,
  type CommitmentStallInput,
} from "../../electron/orchestrator-commitment-stall";

const NOW = 10_000_000;
const WINDOW = COMMITMENT_STALL_WINDOW_MS; // 10분

function item(over: Partial<CommitmentItem> = {}): CommitmentItem {
  return {
    id: "wc_abc123",
    what: "별도로 정리해서 드리겠습니다",
    createdAt: NOW - WINDOW,
    updatedAt: NOW - WINDOW,
    ...over,
  };
}

function state(over: Partial<AdvanceStateSnapshot> = {}): AdvanceStateSnapshot {
  return { ...emptyAdvanceState(), ...over };
}

function input(over: Partial<CommitmentStallInput> = {}): CommitmentStallInput {
  return {
    enabled: true,
    sessionRunning: true,
    now: NOW,
    items: [item()],
    askedAt: new Map(),
    ownerInputPending: false,
    state: state(),
    ...over,
  };
}

// ── ① isCommitmentStalled — 순수 판정 ────────────────────────────────────────

describe("isCommitmentStalled — updatedAt 이 판정 창을 채웠는가", () => {
  it("★포착 이후 아무도 안 건드렸고 창을 채웠으면 정체다", () => {
    expect(isCommitmentStalled(item(), NOW, WINDOW)).toBe(true);
  });

  it("★티켓이 생겨도 항목 자체를 안 건드렸으면 여전히 정체다 — 실측 사례 2", () => {
    // "네이버 티켓을 만들어놓고 배치를 안 했다" — 티켓 생성은 이 항목의
    // updatedAt 을 바꾸지 않는다(update_work_chain_item 을 따로 불러야 바뀐다).
    expect(
      isCommitmentStalled(item({ updatedAt: NOW - WINDOW }), NOW, WINDOW),
    ).toBe(true);
  });

  it("방금 갱신됐으면(update_work_chain_item 호출) 정체가 아니다", () => {
    expect(
      isCommitmentStalled(item({ updatedAt: NOW - 1_000 }), NOW, WINDOW),
    ).toBe(false);
  });

  it("판정 창에 아직 못 미치면 정체가 아니다", () => {
    expect(
      isCommitmentStalled(item({ updatedAt: NOW - (WINDOW - 1) }), NOW, WINDOW),
    ).toBe(false);
  });

  it("정확히 창에 닿으면 정체다(경계 포함)", () => {
    expect(
      isCommitmentStalled(item({ updatedAt: NOW - WINDOW }), NOW, WINDOW),
    ).toBe(true);
  });
});

// ── ③ selectAskableStalledCommitments — 쿨다운 ──────────────────────────────

describe("selectAskableStalledCommitments — 쿨다운 안이면 다시 안 묻는다", () => {
  it("정체가 아니면 후보가 아니다", () => {
    const fresh = item({ updatedAt: NOW - 1_000 });
    expect(
      selectAskableStalledCommitments([fresh], NOW, new Map(), WINDOW, WINDOW),
    ).toEqual([]);
  });

  it("정체인데 물은 적 없으면 후보다", () => {
    const stalled = item();
    expect(
      selectAskableStalledCommitments(
        [stalled],
        NOW,
        new Map(),
        WINDOW,
        WINDOW,
      ),
    ).toEqual([stalled]);
  });

  it("★방금 물었으면(쿨다운 안) 같은 항목을 다시 안 묻는다", () => {
    const stalled = item();
    const askedAt = new Map([[stalled.id, NOW - 1_000]]);
    expect(
      selectAskableStalledCommitments([stalled], NOW, askedAt, WINDOW, WINDOW),
    ).toEqual([]);
  });

  it("쿨다운이 지났으면 다시 후보다", () => {
    const stalled = item();
    const askedAt = new Map([[stalled.id, NOW - WINDOW]]);
    expect(
      selectAskableStalledCommitments([stalled], NOW, askedAt, WINDOW, WINDOW),
    ).toEqual([stalled]);
  });

  it("여러 항목 중 정체인 것만 남는다", () => {
    const stalled = item({ id: "wc_stalled" });
    const fresh = item({ id: "wc_fresh", updatedAt: NOW - 1_000 });
    expect(
      selectAskableStalledCommitments(
        [stalled, fresh],
        NOW,
        new Map(),
        WINDOW,
        WINDOW,
      ),
    ).toEqual([stalled]);
  });
});

// ── ⑤⑥ evaluateCommitmentStall — 전체 판정 ──────────────────────────────────

describe("evaluateCommitmentStall — 판정 순서", () => {
  it("플래그 OFF 면 아무것도 안 한다", () => {
    const d = evaluateCommitmentStall(input({ enabled: false }));
    expect(d.action).toBe("NO_SIGNAL");
    expect(d.code).toBe("flag-off");
  });

  it("세션이 없으면 안 한다", () => {
    const d = evaluateCommitmentStall(input({ sessionRunning: false }));
    expect(d.action).toBe("NO_SIGNAL");
    expect(d.code).toBe("no-session");
  });

  it("이미 HALT 상태면 조용히 빠진다(메시지 없음)", () => {
    const d = evaluateCommitmentStall(
      input({ state: state({ haltReason: "테스트 정지" }) }),
    );
    expect(d.action).toBe("NO_SIGNAL");
    expect(d.code).toBe("already-halted");
    expect(d.message).toBe("");
  });

  it("정체 항목이 없으면 안 한다", () => {
    const d = evaluateCommitmentStall(
      input({ items: [item({ updatedAt: NOW - 1_000 })] }),
    );
    expect(d.action).toBe("NO_SIGNAL");
    expect(d.code).toBe("no-candidates");
  });

  it("★정체 항목이 있으면 질문 신호를 낸다", () => {
    const d = evaluateCommitmentStall(input());
    expect(d.action).toBe("SIGNAL");
    expect(d.message).toContain("[약속 확인]");
    expect(d.message).toContain(item().what);
    expect(d.askedIds).toEqual([item().id]);
  });

  it("사장님 입력이 대기 중이면 guard 가 보류시킨다", () => {
    const d = evaluateCommitmentStall(input({ ownerInputPending: true }));
    expect(d.action).toBe("NO_SIGNAL");
    expect(d.code).toBe("owner-input-pending");
  });

  it("연속 신호 한도를 넘으면 HALT 한다 — 새 한도를 안 만들고 기존 것을 쓴다", () => {
    const d = evaluateCommitmentStall(
      input({ state: state({ consecutiveSignals: 5 }) }),
    );
    expect(d.action).toBe("HALT");
    expect(d.haltReason).toBeTruthy();
  });

  it("여러 항목이 정체면 다이제스트 1통에 전부 담는다", () => {
    const a = item({ id: "wc_a", what: "A 를 하겠습니다" });
    const b = item({ id: "wc_b", what: "B 도 하겠습니다" });
    const d = evaluateCommitmentStall(input({ items: [a, b] }));
    expect(d.action).toBe("SIGNAL");
    expect(d.message).toContain("A 를 하겠습니다");
    expect(d.message).toContain("B 도 하겠습니다");
    expect(d.askedIds).toEqual(["wc_a", "wc_b"]);
  });
});

// ── ⑦ 물어보는 것까지다 — 대신 실행하지 않는다 ───────────────────────────────

describe("★질문 문구 — 대신 닫거나 대신 붙이라고 하지 않는다", () => {
  it("항목 id·제목·경과 시간을 담고, 스스로 할 일을 오케에게 미룬다", () => {
    const msg = formatCommitmentStallQuestion([item()], NOW);
    expect(msg).toContain(item().id);
    expect(msg).toContain(item().what);
    expect(msg).toContain("update_work_chain_item");
    // ★"내가 대신 닫았다" 류의 1인칭 실행 서술이 없다 — 전부 오케에게 묻는
    // 명령형("붙여라"·"닫아라")이다.
    expect(msg).not.toMatch(/닫았습니다|붙였습니다|만들었습니다/);
  });

  it("HALT 문구도 사람이 볼 곳에 사유를 남긴다", () => {
    const msg = formatCommitmentStallHalt("연속 5회 초과");
    expect(msg).toContain("연속 5회 초과");
    expect(msg).toContain("사장님 지시가 오면 해제된다");
  });
});
