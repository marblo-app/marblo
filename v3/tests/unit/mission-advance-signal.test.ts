/**
 * 티켓 Sf8Id64jLeyDvWIS4cub — 완료가 다음을 부르게 하는 **전진 로직**.
 *
 * 사장님 설계 지시: "이게 그 미션을 닫는 최종 태스크인지 아님 그중 하나인지가
 * 체크되면서, 그중 하나면 다음 태스크를 연달아 오케한테 알아서 스폰하도록 하는
 * 메시지가 오케한테 들어가야 폐루프가 돌 것 같은데."
 *
 * 그래서 이 스위트가 고정하는 것:
 *   • 마지막이면 → 미션이 닫히고 **신호는 안 나간다**
 *   • 중간이면  → 신호가 나가고 그 안에 **"지금 집을 수 있는 것"이 구분돼 있다**
 *   • 미션 밖 단발 티켓이면 → **아무 신호도 없다**
 *   • 명시 미션이면 → 지휘자 소유라 신호 없음(이중 스폰 방지)
 *
 * 설계: v3/docs/mission-advance-signal-design-2026-09-04.md.
 */
import { describe, it, expect } from "vitest";
import {
  classifySiblings,
  evaluateMissionAdvance,
  isMissionContextId,
  type AdvanceInput,
  type AdvanceSiblingTask,
} from "../../electron/mcp-server/mission-advance";
import {
  emptyAdvanceState,
  type AdvanceStateSnapshot,
} from "../../electron/mcp-server/advance-guards";

const MISSION_ID = "mZzImplicit1";

const task = (
  over: Partial<AdvanceSiblingTask> & { id: string },
): AdvanceSiblingTask => ({
  title: `티켓 ${over.id}`,
  status: "TODO",
  role: "backend",
  priority: 3,
  dependsOnCompleted: true,
  ...over,
});

const implicitMission = {
  id: MISSION_ID,
  status: "active",
  missionKind: "implicit",
  implicitLabel: "폐루프 배선",
  steps: [] as unknown[],
};

const input = (over: Partial<AdvanceInput> = {}): AdvanceInput => ({
  finishedTaskId: "done1",
  finishedTaskTitle: "방금 끝난 것",
  contextId: MISSION_ID,
  mission: implicitMission,
  siblings: [
    task({ id: "done1", status: "DONE" }),
    task({ id: "next1" }),
    task({ id: "wait1", dependsOnCompleted: false, dependsOn: ["next1"] }),
  ],
  state: emptyAdvanceState(),
  ownerInputPending: false,
  enabled: true,
  ...over,
});

const state = (
  over: Partial<AdvanceStateSnapshot> = {},
): AdvanceStateSnapshot => ({
  ...emptyAdvanceState(),
  ...over,
});

// ── 귀속 판정 ───────────────────────────────────────────────────────────────

describe("귀속 — 어느 미션에 속하는가", () => {
  it("board 와 Quick Lane 은 미션이 아니다", () => {
    expect(isMissionContextId("board")).toBe(false);
    expect(isMissionContextId("lane")).toBe(false);
    expect(isMissionContextId("lane:abc")).toBe(false);
    expect(isMissionContextId("")).toBe(false);
    expect(isMissionContextId(undefined)).toBe(false);
  });

  it("missionId 는 미션이다", () => {
    expect(isMissionContextId(MISSION_ID)).toBe(true);
  });

  it("★미션에 속하지 않는 단발 티켓이면 아무 신호도 안 나간다", () => {
    const v = evaluateMissionAdvance(
      input({ contextId: "board", mission: null }),
    );
    expect(v.action).toBe("NO_SIGNAL");
    expect(v.code).toBe("not-a-mission");
    expect(v.message).toBe("");
  });

  it("Quick Lane 티켓도 마찬가지다", () => {
    const v = evaluateMissionAdvance(
      input({ contextId: "lane:quick", mission: null }),
    );
    expect(v.action).toBe("NO_SIGNAL");
    expect(v.code).toBe("not-a-mission");
  });
});

// ── 지휘자와의 경계 (이중 스폰 방지) ────────────────────────────────────────

describe("지휘자 루프와의 관계 — 구조적 배타", () => {
  it("★명시 미션(steps 보유)은 지휘자가 운전한다 — 완료후크는 개입하지 않는다", () => {
    const v = evaluateMissionAdvance(
      input({
        mission: {
          id: MISSION_ID,
          status: "active",
          missionKind: "explicit",
          steps: [{ type: "dispatch" }, { type: "wait" }],
        },
      }),
    );
    expect(v.action).toBe("NO_SIGNAL");
    expect(v.code).toBe("conductor-owned");
    expect(v.message).toBe("");
  });

  it("missionKind 미지정도 지휘자 소유로 본다 — 의심스러우면 개입하지 않는다", () => {
    const v = evaluateMissionAdvance(
      input({ mission: { id: MISSION_ID, status: "active", steps: [] } }),
    );
    expect(v.code).toBe("conductor-owned");
  });

  it("암묵 미션만 전진 대상이다 — 지휘자가 설계상 건너뛰는 유일한 population", () => {
    expect(evaluateMissionAdvance(input()).action).toBe("SIGNAL_ADVANCE");
  });
});

// ── 종결 판정 ───────────────────────────────────────────────────────────────

describe("종결 판정", () => {
  it("★마지막 태스크면 미션이 닫히고 신호는 안 나간다", () => {
    const v = evaluateMissionAdvance(
      input({
        siblings: [
          task({ id: "done1", status: "DONE" }),
          task({ id: "done2", status: "DONE" }),
        ],
      }),
    );
    expect(v.action).toBe("CLOSE_MISSION");
    expect(v.message).toBe("");
    expect(v.openCount).toBe(0);
    expect(v.reason).toContain("마지막");
  });

  it("FAILED 로 끝난 형제가 있어도 열린 것이 없으면 닫는다", () => {
    const v = evaluateMissionAdvance(
      input({
        siblings: [
          task({ id: "done1", status: "DONE" }),
          task({ id: "f1", status: "FAILED" }),
        ],
      }),
    );
    expect(v.action).toBe("CLOSE_MISSION");
  });

  it("이미 닫힌 미션에는 신호를 내지 않는다", () => {
    const v = evaluateMissionAdvance(
      input({ mission: { ...implicitMission, status: "completed" } }),
    );
    expect(v.action).toBe("NO_SIGNAL");
    expect(v.code).toBe("mission-terminal");
  });
});

// ── ★신호 내용: "지금 집을 수 있는 것"이 구분돼 있는가 ─────────────────────

describe("전진 신호 — 4갈래 분류", () => {
  it("★중간이면 신호가 나가고 지금 집을 수 있는 것이 구분돼 있다", () => {
    const v = evaluateMissionAdvance(input());
    expect(v.action).toBe("SIGNAL_ADVANCE");
    expect(v.buckets.readyNow.map((t) => t.id)).toEqual(["next1"]);
    expect(v.buckets.blocked.map((t) => t.id)).toEqual(["wait1"]);
    expect(v.message).toContain("지금 집을 수 있음");
    expect(v.message).toContain("next1");
  });

  it("막힌 것에는 무엇을 기다리는지 함께 적는다", () => {
    const v = evaluateMissionAdvance(input());
    expect(v.message).toContain("아직 막힘");
    expect(v.message).toContain("대기: next1");
  });

  it("선행 미충족은 readyNow 에 안 들어간다", () => {
    const b = classifySiblings(
      [task({ id: "x", dependsOnCompleted: false, dependsOn: ["y"] })],
      "done1",
    );
    expect(b.readyNow).toHaveLength(0);
    expect(b.blocked.map((t) => t.id)).toEqual(["x"]);
  });

  it("이미 클레임된 TODO 는 readyNow 가 아니다 — 중복 dispatch 방지", () => {
    const b = classifySiblings(
      [task({ id: "x", claimedBy: "agent-1" })],
      "done1",
    );
    expect(b.readyNow).toHaveLength(0);
  });

  it("진행중은 별도 갈래로 나가 '또 뽑지 마라'가 된다", () => {
    const b = classifySiblings(
      [
        task({ id: "a", status: "CLAIMED" }),
        task({ id: "b", status: "IN_PROGRESS" }),
        task({ id: "c", status: "REVIEW" }),
      ],
      "done1",
    );
    expect(b.inFlight.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(b.readyNow).toHaveLength(0);
  });

  it("방금 닫힌 티켓과 삭제된 티켓은 어느 갈래에도 안 들어간다", () => {
    const b = classifySiblings(
      [
        task({ id: "done1", status: "DONE" }),
        task({ id: "gone", deleted: true }),
        task({ id: "live" }),
      ],
      "done1",
    );
    expect(b.readyNow.map((t) => t.id)).toEqual(["live"]);
    expect(b.blocked).toHaveLength(0);
    expect(b.inFlight).toHaveLength(0);
  });

  it("오케가 이 메시지만 읽고 판단할 수 있게 권고 한 줄이 붙는다", () => {
    expect(evaluateMissionAdvance(input()).message).toContain("권고:");
  });

  it("집을 게 없으면 권고가 '기다려라' 로 바뀐다", () => {
    const v = evaluateMissionAdvance(
      input({
        siblings: [
          task({ id: "done1", status: "DONE" }),
          task({ id: "busy", status: "IN_PROGRESS" }),
        ],
      }),
    );
    expect(v.action).toBe("SIGNAL_ADVANCE");
    expect(v.buckets.readyNow).toHaveLength(0);
    expect(v.message).toContain("끝나기를 기다려라");
  });
});

// ── 안전장치가 전진 로직 아래에 깔려 있는가 ────────────────────────────────

describe("안전장치 — 전진 판정보다 위에 있다", () => {
  it("★승인 필요 작업은 자율 경로가 안 집는다", () => {
    const v = evaluateMissionAdvance(
      input({
        siblings: [
          task({ id: "done1", status: "DONE" }),
          task({ id: "deploy1", title: "스테이징 배포" }),
          task({ id: "safe1", title: "테스트 보강" }),
        ],
      }),
    );
    expect(v.buckets.readyNow.map((t) => t.id)).toEqual(["safe1"]);
    expect(v.buckets.needsOwnerApproval.map((t) => t.id)).toEqual(["deploy1"]);
    expect(v.message).toContain("사장님 승인 필요");
    expect(v.message).toContain("자율 스폰 대상 아님");
  });

  it("★같은 완료가 두 번 들어와도 신호는 한 번", () => {
    const first = evaluateMissionAdvance(input());
    expect(first.action).toBe("SIGNAL_ADVANCE");

    const second = evaluateMissionAdvance(
      input({ state: state({ signaledTaskIds: ["done1"] }) }),
    );
    expect(second.action).toBe("NO_SIGNAL");
    expect(second.code).toBe("duplicate-completion");
    expect(second.message).toBe("");
  });

  it("연속 스폰 한도에 걸리면 HALT 이고 사유가 메시지에 실린다", () => {
    const v = evaluateMissionAdvance(
      input({ state: state({ consecutiveSignals: 5 }) }),
    );
    expect(v.action).toBe("HALT");
    expect(v.code).toBe("consecutive-spawn-cap");
    expect(v.haltReason).not.toBe("");
    expect(v.message).toContain("자율 전진 정지");
    expect(v.message).toContain("사유:");
  });

  it("진행 없음이면 HALT — 스폰만 반복되고 티켓이 안 닫히는 모양", () => {
    const v = evaluateMissionAdvance(
      input({ state: state({ stagnantSignals: 2, lastOpenCount: 2 }) }),
    );
    expect(v.action).toBe("HALT");
    expect(v.code).toBe("no-progress");
  });

  it("사장님 입력이 대기 중이면 자율 신호가 안 나간다", () => {
    const v = evaluateMissionAdvance(input({ ownerInputPending: true }));
    expect(v.action).toBe("NO_SIGNAL");
    expect(v.code).toBe("owner-input-pending");
    expect(v.reason).toContain("사장님");
  });

  it("슬롯 포화면 신호는 나가되 readyNow 가 비워진다 (back-pressure)", () => {
    const v = evaluateMissionAdvance(
      input({
        siblings: [
          task({ id: "done1", status: "DONE" }),
          task({ id: "r1" }),
          task({ id: "a", status: "IN_PROGRESS" }),
          task({ id: "b", status: "IN_PROGRESS" }),
          task({ id: "c", status: "CLAIMED" }),
        ],
      }),
    );
    expect(v.action).toBe("SIGNAL_ADVANCE");
    expect(v.buckets.readyNow).toHaveLength(0);
    expect(v.buckets.inFlight).toHaveLength(3);
    expect(v.message).toContain("슬롯 포화");
  });

  it("★기본값 OFF — 꺼져 있으면 아무 신호도 안 나간다", () => {
    const v = evaluateMissionAdvance(input({ enabled: false }));
    expect(v.action).toBe("NO_SIGNAL");
    expect(v.code).toBe("flag-off");
    expect(v.message).toBe("");
  });
});

// ── 카운터 갱신 (배달된 신호만 센다) ───────────────────────────────────────

describe("상태 갱신", () => {
  it("전진 신호는 저장할 다음 상태를 함께 돌려준다", () => {
    const v = evaluateMissionAdvance(
      input({ state: state({ consecutiveSignals: 2 }) }),
    );
    expect(v.nextState).toEqual({
      consecutiveSignals: 3,
      stagnantSignals: 0,
      lastOpenCount: 2,
      signaledTaskId: "done1",
    });
  });

  it("열린 티켓이 줄지 않으면 stagnant 가 누적된다", () => {
    const v = evaluateMissionAdvance(
      input({ state: state({ lastOpenCount: 2, stagnantSignals: 0 }) }),
    );
    expect(v.nextState?.stagnantSignals).toBe(1);
  });

  it("신호를 안 내는 경로는 저장할 상태가 없다 — 닿지 않은 신호를 한도에 세지 않는다", () => {
    expect(
      evaluateMissionAdvance(input({ enabled: false })).nextState,
    ).toBeUndefined();
    expect(
      evaluateMissionAdvance(input({ state: state({ consecutiveSignals: 5 }) }))
        .nextState,
    ).toBeUndefined();
  });
});

// ── #1412 규약: 사유 축으로 원문이 새지 않는다 ─────────────────────────────

describe("#1412 규약 — 신호 본문에 원문이 안 들어간다", () => {
  it("PTY 원문·주입 본문·토큰을 담지 않는다", () => {
    const secret = "ghp_SHOULD_NEVER_APPEAR";
    const v = evaluateMissionAdvance(
      input({
        siblings: [
          task({ id: "done1", status: "DONE" }),
          task({
            id: "n1",
            title: "정상 티켓",
            // 본문·코멘트는 분류에만 쓰이고 신호 본문으로는 나가지 않는다.
            description: `내부 메모 ${secret}`,
            comment: `PTY 원문 ${secret}`,
            notes: [`노트 ${secret}`],
          }),
        ],
      }),
    );
    expect(v.action).toBe("SIGNAL_ADVANCE");
    expect(v.message).not.toContain(secret);
    expect(v.message).toContain("n1");
    expect(v.message).toContain("정상 티켓");
  });

  it("HALT 본문도 고정 어휘 + 사유만 담는다", () => {
    const v = evaluateMissionAdvance(
      input({ state: state({ consecutiveSignals: 5 }) }),
    );
    expect(v.message).toContain("[Mission Advance]");
    expect(v.message).toContain("자율 스폰은 여기서 멈춘다");
  });
});
