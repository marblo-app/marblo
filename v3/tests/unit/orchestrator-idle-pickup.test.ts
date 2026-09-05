// 오케 자율 진행 — 깨울 조건의 진리표 (티켓 6hWxqjbzGQs1hzTUTihx).
//
// 설계 단일소스: v3/docs/orch-idle-pickup-design-2026-09-05.md.
//
// 고정하는 계약:
//   ① ★주인 없는 미션 티켓이 픽업된다 — 2026-09-05 REVIEW 19장이 쌓인 사건의
//      직접 회귀. 스위프는 `isMission` 이면 건너뛰고 컨덕터 report-watchdog 은
//      명시 미션에만 있어, 암묵 미션 REVIEW 는 아무도 안 봤다.
//   ② ★정체 항목이 다시 알려진다 — "전했다 ≠ 행동했다". 이미 통보했는데 보드가
//      그대로면 다시 말한다. 통보한 적 없거나 아직 안 낡았으면 픽업하지 않는다.
//   ③ ★승인필요(배포·메일·결제·심사)는 **절대** 자율로 집지 않는다.
//   ④ 오케가 바쁘면 안 깨운다. 같은 틱에 스위프가 이미 밀었어도 안 깨운다.
//   ⑤ 한도는 #1414/#1416 의 그것 그대로 — 연속 5 초과 HALT, 정체 2 초과 HALT,
//      동시 3 은 HALT 가 아니라 back-pressure.
//   ⑥ 사장님 입력이 자율 진행보다 우선하고, 개입은 한도·정지를 푼다.
//   ⑦ 할 일이 없으면 아무것도 만들지 않는다 — 빈 틱이 한도를 태우지 않는다.
//   ⑧ 배선 회귀: 픽업 의존을 안 주면 기존 스위프 동작이 한 줄도 안 바뀐다.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_ADVANCE_CAPS,
  emptyAdvanceState,
  type AdvanceStateSnapshot,
} from "../../electron/mcp-server/advance-guards";
import {
  IDLE_PICKUP_QUIET_WINDOW_MS,
  classifyIdlePickup,
  evaluateIdlePickup,
  pickupNeedsApproval,
  type IdlePickupCandidate,
  type IdlePickupInput,
} from "../../electron/orchestrator-idle-pickup";
import {
  OrchestratorBoardResync,
  type BoardResyncDeps,
  type ResyncTaskRow,
} from "../../electron/orchestrator-board-resync";

const STALE_AFTER = 600_000;
const MIN_AGE = 180_000;

function row(over: Partial<ResyncTaskRow> = {}): ResyncTaskRow {
  return {
    taskId: "t-review",
    projectId: "p1",
    status: "REVIEW",
    title: "createOrganization 콜러블",
    role: "backend",
    prUrl: null,
    contextId: "board",
    isMission: false,
    claimedBy: null,
    ageMs: 20 * 60_000,
    ...over,
  };
}

function candidate(
  over: Partial<IdlePickupCandidate> = {},
): IdlePickupCandidate {
  return { row: row(), kind: "review", why: "stale", ...over };
}

function input(over: Partial<IdlePickupInput> = {}): IdlePickupInput {
  return {
    enabled: true,
    sessionRunning: true,
    orchIdleForMs: 60_000,
    resyncInjectedThisTick: false,
    candidates: [candidate()],
    openCount: 4,
    inFlightCount: 0,
    ownerInputPending: false,
    state: emptyAdvanceState(),
    ...over,
  };
}

function state(over: Partial<AdvanceStateSnapshot> = {}): AdvanceStateSnapshot {
  return { ...emptyAdvanceState(), ...over };
}

// ── ①·② 깨울 조건: 후보 판정 ────────────────────────────────────────────────

describe("classifyIdlePickup — 무엇이 후보인가", () => {
  it("★주인 없는 미션 티켓은 통보 이력과 무관하게 후보다 (19장 회귀)", () => {
    // 스위프는 이 행을 건너뛰므로 seen 에 절대 안 들어간다(alreadyTold=false).
    // 그래도 후보여야 한다 — 안 그러면 아무도 이 티켓을 보지 않는다.
    expect(
      classifyIdlePickup(
        row({ isMission: true, contextId: "mission-abc" }),
        "review",
        false,
        false,
        STALE_AFTER,
      ),
    ).toBe("unowned-mission");
  });

  it("미션 오케가 돌면 미션 티켓은 후보가 아니다 (이중 감시 금지)", () => {
    expect(
      classifyIdlePickup(
        row({ isMission: true }),
        "review",
        false,
        true,
        STALE_AFTER,
      ),
    ).toBeNull();
  });

  it("★이미 통보했는데 안 움직인 항목은 후보다", () => {
    expect(
      classifyIdlePickup(
        row({ ageMs: STALE_AFTER }),
        "review",
        true,
        false,
        STALE_AFTER,
      ),
    ).toBe("stale");
  });

  it("통보한 적 없는 항목은 후보가 아니다 — 스위프가 이번 틱에 처음 민다", () => {
    expect(
      classifyIdlePickup(
        row({ ageMs: STALE_AFTER * 3 }),
        "review",
        false,
        false,
        STALE_AFTER,
      ),
    ).toBeNull();
  });

  it("아직 안 낡은 항목은 후보가 아니다", () => {
    expect(
      classifyIdlePickup(
        row({ ageMs: STALE_AFTER - 1 }),
        "review",
        true,
        false,
        STALE_AFTER,
      ),
    ).toBeNull();
  });

  it("나이를 모르면 정체라고 부르지 않는다 — 안 움직였다는 근거가 없다", () => {
    expect(
      classifyIdlePickup(
        row({ ageMs: null }),
        "review",
        true,
        false,
        STALE_AFTER,
      ),
    ).toBeNull();
  });
});

// ── ③ 승인필요는 절대 자율로 집지 않는다 ────────────────────────────────────

describe("승인필요 티켓", () => {
  it.each([
    ["배포", "프로덕션 배포 스크립트 정리"],
    ["메일 발송", "웨이트리스트 메일 발송"],
    ["결제", "결제 실패 재시도 로직"],
    ["심사", "앱스토어 심사 기간 화면 문구"],
  ])("%s 표지가 잡히면 자율 대상이 아니다", (_label, title) => {
    expect(pickupNeedsApproval(row({ title }))).toBe(true);
  });

  it('"배포 없음" 같은 부정어는 표지를 죽인다 — 멀쩡한 티켓을 빼앗지 않는다', () => {
    expect(pickupNeedsApproval(row({ title: "리팩터링 (배포 없음)" }))).toBe(
      false,
    );
  });

  it("★승인필요는 picked 에 절대 안 들어가고 withheld 로만 실린다", () => {
    const d = evaluateIdlePickup(
      input({
        candidates: [
          candidate(),
          candidate({
            row: row({ taskId: "t-deploy", title: "스테이징 배포 확인" }),
          }),
        ],
      }),
    );
    expect(d.action).toBe("PICKUP");
    expect(d.picked.map((c) => c.row.taskId)).toEqual(["t-review"]);
    expect(d.withheld.map((c) => c.row.taskId)).toEqual(["t-deploy"]);
    expect(d.message).toContain("자율 대상 아님");
  });

  it("후보가 전부 승인필요면 아무도 안 깨운다", () => {
    const d = evaluateIdlePickup(
      input({
        candidates: [candidate({ row: row({ title: "결제 웹훅 점검" }) })],
      }),
    );
    expect(d.action).toBe("NO_PICKUP");
    expect(d.code).toBe("nothing-stale");
    expect(d.message).toBe("");
  });
});

// ── ④·⑦ 안 깨울 조건 ───────────────────────────────────────────────────────

describe("evaluateIdlePickup — 안 깨우는 자리", () => {
  it("플래그 OFF 면 아무것도 하지 않는다 (기본값 OFF)", () => {
    const d = evaluateIdlePickup(input({ enabled: false }));
    expect(d.action).toBe("NO_PICKUP");
    expect(d.code).toBe("flag-off");
    expect(d.message).toBe("");
  });

  it("오케 세션이 없으면 하지 않는다", () => {
    expect(evaluateIdlePickup(input({ sessionRunning: false })).code).toBe(
      "no-session",
    );
  });

  it("★오케가 바쁘면 깨우지 않는다 — 바쁜데 넣으면 큐만 쌓인다", () => {
    const d = evaluateIdlePickup(
      input({ orchIdleForMs: IDLE_PICKUP_QUIET_WINDOW_MS - 1 }),
    );
    expect(d.action).toBe("NO_PICKUP");
    expect(d.code).toBe("orch-busy");
  });

  it("busy 관측이 아예 없으면(null) 모름이지 바쁨이 아니다 — 통과시킨다", () => {
    expect(evaluateIdlePickup(input({ orchIdleForMs: null })).action).toBe(
      "PICKUP",
    );
  });

  it("★같은 틱에 스위프가 이미 밀었으면 또 밀지 않는다", () => {
    const d = evaluateIdlePickup(input({ resyncInjectedThisTick: true }));
    expect(d.code).toBe("resync-just-injected");
  });

  it("이미 HALT 면 조용히 빠진다 — 같은 정지를 틱마다 떠들지 않는다", () => {
    const d = evaluateIdlePickup(
      input({ state: state({ haltReason: "연속 자율 스폰 한도 도달" }) }),
    );
    expect(d.action).toBe("NO_PICKUP");
    expect(d.code).toBe("already-halted");
    expect(d.message).toBe("");
  });

  it("★할 일이 없으면 상태를 건드리지 않는다 — 빈 틱이 한도를 태우지 않는다", () => {
    const d = evaluateIdlePickup(input({ candidates: [] }));
    expect(d.action).toBe("NO_PICKUP");
    expect(d.code).toBe("nothing-stale");
    expect(d.nextState).toBeUndefined();
  });

  it("★바쁜 틱은 한도보다 먼저 걸린다 — 한도가 헛되이 소진되지 않는다", () => {
    // 연속 카운터가 한도 코앞인데 바쁜 틱이 들어와도 HALT 로 떨어지지 않는다.
    const d = evaluateIdlePickup(
      input({
        orchIdleForMs: 0,
        state: state({
          consecutiveSignals: DEFAULT_ADVANCE_CAPS.maxConsecutiveSignals,
        }),
      }),
    );
    expect(d.code).toBe("orch-busy");
  });
});

// ── ⑤ 한도는 기존 것 그대로 ─────────────────────────────────────────────────

describe("한도 — #1414/#1416 의 것을 그대로 탄다", () => {
  it("★연속 자율 진행이 5에 닿으면 HALT 하고 사유를 남긴다", () => {
    const d = evaluateIdlePickup(
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
    expect(d.picked).toEqual([]);
  });

  it("4회까지는 진행하고 카운터가 1 올라간다", () => {
    const d = evaluateIdlePickup(
      input({ state: state({ consecutiveSignals: 4 }) }),
    );
    expect(d.action).toBe("PICKUP");
    expect(d.nextState?.consecutiveSignals).toBe(5);
  });

  it("★큐가 안 줄어든 채 정체 한도를 넘으면 HALT", () => {
    const d = evaluateIdlePickup(
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

  it("큐가 줄면 정체 카운터가 0으로 떨어진다", () => {
    const d = evaluateIdlePickup(
      input({
        openCount: 3,
        state: state({ lastOpenCount: 9, stagnantSignals: 2 }),
      }),
    );
    expect(d.action).toBe("PICKUP");
    expect(d.nextState?.stagnantSignals).toBe(0);
  });

  it("★동시 슬롯 포화는 HALT 가 아니라 back-pressure — 신호는 나가되 뽑지 말라고 한다", () => {
    const d = evaluateIdlePickup(
      input({ inFlightCount: DEFAULT_ADVANCE_CAPS.maxConcurrentInFlight }),
    );
    expect(d.action).toBe("PICKUP");
    expect(d.message).toContain("슬롯 포화 (3/3)");
    expect(d.message).toContain("새로 뽑지 말고");
  });
});

// ── 토큰 잔여 게이트 (#1416 의 게이트를 그대로 탄다) ────────────────────────

describe("토큰 잔여", () => {
  it("★예비선 이하면 밀지 않는다", () => {
    const d = evaluateIdlePickup(
      input({
        quota: {
          rows: [
            { harness: "claude", remainingPercent: 4 },
            { harness: "codex", remainingPercent: 2 },
          ],
          reservePct: 10,
        },
      }),
    );
    expect(d.action).toBe("NO_PICKUP");
    expect(d.code).toBe("token-insufficient");
  });

  it("예비선 위 하네스가 하나라도 있으면 민다", () => {
    const d = evaluateIdlePickup(
      input({
        quota: {
          rows: [
            { harness: "claude", remainingPercent: 4 },
            { harness: "codex", remainingPercent: 55 },
          ],
          reservePct: 10,
        },
      }),
    );
    expect(d.action).toBe("PICKUP");
  });

  it("잔여를 못 읽었으면(모름) 막지 않는다 — 모름은 소진이 아니다", () => {
    const unread = evaluateIdlePickup(input({ quota: null }));
    const allNull = evaluateIdlePickup(
      input({
        quota: {
          rows: [{ harness: "claude", remainingPercent: null }],
          reservePct: 10,
        },
      }),
    );
    expect(unread.action).toBe("PICKUP");
    expect(allNull.action).toBe("PICKUP");
  });

  it("★잔여 부족은 HALT 가 아니다 — 한도 창이 지나면 저절로 풀린다", () => {
    const d = evaluateIdlePickup(
      input({
        quota: {
          rows: [{ harness: "claude", remainingPercent: 1 }],
          reservePct: 10,
        },
      }),
    );
    expect(d.action).not.toBe("HALT");
    expect(d.haltReason).toBeUndefined();
  });
});

// ── ⑥ 사장님 우선 ──────────────────────────────────────────────────────────

describe("사장님 입력 우선", () => {
  it("미소비 인바운드가 있으면 자율 진행을 보류한다", () => {
    const d = evaluateIdlePickup(input({ ownerInputPending: true }));
    expect(d.action).toBe("NO_PICKUP");
    expect(d.code).toBe("owner-input-pending");
  });
});

// ── 신호 본문 ──────────────────────────────────────────────────────────────

describe("보내는 본문", () => {
  it('★"계속 돌아라"가 아니라 무엇이 왜 대기 중인지를 담는다', () => {
    const d = evaluateIdlePickup(
      input({
        candidates: [
          candidate({ row: row({ ageMs: 25 * 60_000 }) }),
          candidate({
            row: row({ taskId: "t-m", isMission: true, title: "위키 링크맵" }),
            why: "unowned-mission",
          }),
        ],
      }),
    );
    expect(d.message).not.toContain("계속 돌아라");
    // 항목마다 "왜 지금 이게 실렸는지"가 함께 간다.
    expect(d.message).toContain("t-review");
    expect(d.message).toContain("25분째 그대로이고 이미 통보한 항목입니다");
    expect(d.message).toContain("미션 오케가 돌지 않아");
    // 자율로 집은 것을 사장님이 구분할 수 있게 표시를 요구한다.
    expect(d.message).toContain("자율 진행으로 집음");
  });
});

// ── ⑧ 배선 회귀 — 스위프에 얹은 두 번째 패스 ────────────────────────────────

interface Harness {
  resync: OrchestratorBoardResync;
  injects: string[];
  now: { value: number };
}

function harness(over: Partial<BoardResyncDeps> = {}): Harness {
  const injects: string[] = [];
  const now = { value: 1_000_000 };
  const resync = new OrchestratorBoardResync({
    listBoardOrchestratorProjects: () => ["p1"],
    getOrchestratorSession: () => ({ ptySessionId: "s1", status: "running" }),
    listAttentionTasks: async () => [],
    isAgentAliveInFleet: () => true,
    listReadyChainItems: async () => [],
    inject: async (_p, m) => {
      injects.push(m);
      return true;
    },
    log: () => {},
    logError: () => {},
    minAgeMs: MIN_AGE,
    orphanMinAgeMs: STALE_AFTER,
    now: () => now.value,
    idlePickupEnabled: () => true,
    isMissionOrchestratorRunning: () => false,
    isOwnerInputPending: async () => false,
    ...over,
  });
  return { resync, injects, now };
}

const missionReview = row({
  taskId: "t-mission-review",
  isMission: true,
  contextId: "mission-abc",
  title: "폐루프 위키 노트",
  ageMs: 30 * 60_000,
});

describe("OrchestratorBoardResync — 자율 픽업 패스", () => {
  it("★픽업 의존을 안 주면 기존 동작 그대로 — 미션 티켓은 여전히 안 민다", async () => {
    const h = harness({
      idlePickupEnabled: undefined,
      isMissionOrchestratorRunning: undefined,
      isOwnerInputPending: undefined,
      listAttentionTasks: async () => [missionReview],
    });
    await h.resync.tickOnce();
    expect(h.injects).toEqual([]);
  });

  it("플래그가 꺼져 있으면 픽업하지 않는다", async () => {
    const h = harness({
      idlePickupEnabled: () => false,
      listAttentionTasks: async () => [missionReview],
    });
    await h.resync.tickOnce();
    expect(h.injects).toEqual([]);
  });

  it("★플래그가 켜지면 주인 없는 미션 REVIEW 가 오케 PTY 로 간다 (19장 회귀)", async () => {
    const h = harness({ listAttentionTasks: async () => [missionReview] });
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);
    expect(h.injects[0]).toContain("[자율 진행]");
    expect(h.injects[0]).toContain("t-mission-review");
  });

  it("미션 오케가 돌면 픽업하지 않는다 — 그쪽이 주인이다", async () => {
    const h = harness({
      listAttentionTasks: async () => [missionReview],
      isMissionOrchestratorRunning: () => true,
    });
    await h.resync.tickOnce();
    expect(h.injects).toEqual([]);
  });

  it("★한 번 실은 항목은 쿨다운 동안 다시 싣지 않는다 — 폴링이 되지 않게", async () => {
    const h = harness({ listAttentionTasks: async () => [missionReview] });
    await h.resync.tickOnce();
    h.now.value += 120_000; // 다음 스위프 틱
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);

    h.now.value += STALE_AFTER; // 쿨다운 경과
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(2);
  });

  it("★오케가 바쁘면 픽업이 나가지 않는다", async () => {
    const h = harness({ listAttentionTasks: async () => [missionReview] });
    h.resync.markOrchestratorActivity("p1");
    await h.resync.tickOnce();
    expect(h.injects).toEqual([]);

    h.now.value += IDLE_PICKUP_QUIET_WINDOW_MS;
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);
  });

  it("★주입 실패는 한도를 태우지 않는다 — 다음 틱에 그대로 재시도된다", async () => {
    let ok = false;
    const injects: string[] = [];
    const now = { value: 1_000_000 };
    const resync = new OrchestratorBoardResync({
      listBoardOrchestratorProjects: () => ["p1"],
      getOrchestratorSession: () => ({ ptySessionId: "s1", status: "running" }),
      listAttentionTasks: async () => [missionReview],
      isAgentAliveInFleet: () => true,
      listReadyChainItems: async () => [],
      inject: async (_p, m) => {
        if (!ok) return false;
        injects.push(m);
        return true;
      },
      log: () => {},
      logError: () => {},
      minAgeMs: MIN_AGE,
      orphanMinAgeMs: STALE_AFTER,
      now: () => now.value,
      idlePickupEnabled: () => true,
      isMissionOrchestratorRunning: () => false,
    });
    await resync.tickOnce();
    expect(injects).toEqual([]);
    ok = true;
    now.value += 120_000;
    await resync.tickOnce();
    expect(injects).toHaveLength(1);
  });

  it("★밀 것이 없으면 토큰 프로브도 돌리지 않는다 — 조용한 틱은 비용이 0이다", async () => {
    let probes = 0;
    const h = harness({
      listAttentionTasks: async () => [],
      readQuota: async () => {
        probes += 1;
        return { rows: [], reservePct: 10 };
      },
    });
    await h.resync.tickOnce();
    expect(probes).toBe(0);
    expect(h.injects).toEqual([]);
  });

  it("밀 이유가 있으면 프로브를 한 번 돌리고, 잔여가 없으면 밀지 않는다", async () => {
    let probes = 0;
    const h = harness({
      listAttentionTasks: async () => [missionReview],
      readQuota: async () => {
        probes += 1;
        return {
          rows: [{ harness: "claude", remainingPercent: 1 }],
          reservePct: 10,
        };
      },
    });
    await h.resync.tickOnce();
    expect(probes).toBe(1);
    expect(h.injects).toEqual([]);
  });

  it("★사장님 입력이 대기 중이면 픽업이 보류된다", async () => {
    const h = harness({
      listAttentionTasks: async () => [missionReview],
      isOwnerInputPending: async () => true,
    });
    await h.resync.tickOnce();
    expect(h.injects).toEqual([]);
  });

  it("오너 인바운드 조회가 깨져도 픽업은 계속된다 (조용한 정지 금지)", async () => {
    const h = harness({
      listAttentionTasks: async () => [missionReview],
      isOwnerInputPending: async () => {
        throw new Error("journal unreadable");
      },
    });
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);
  });

  it("★다이제스트가 방금 밀었으면 같은 틱에 픽업이 겹치지 않는다", async () => {
    // 보드 REVIEW(다이제스트 축) + 미션 REVIEW(픽업 축)가 같은 틱에 있다.
    const h = harness({
      listAttentionTasks: async () => [
        row({ taskId: "t-board" }),
        missionReview,
      ],
    });
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);
    expect(h.injects[0]).toContain("[보드 재동기화]");

    // 다음 틱엔 다이제스트가 밀 것이 없으므로 픽업이 나간다.
    h.now.value += 120_000;
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(2);
    expect(h.injects[1]).toContain("[자율 진행]");
  });

  it("★다이제스트로 통보한 보드 REVIEW 가 안 움직이면 픽업이 다시 알린다 (전했다 ≠ 행동했다)", async () => {
    const stuck = row({ taskId: "t-board", ageMs: 40 * 60_000 });
    const h = harness({ listAttentionTasks: async () => [stuck] });

    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);
    expect(h.injects[0]).toContain("[보드 재동기화]");

    // 예전에는 여기서 끝이었다 — 같은 세션에 같은 항목을 다시 말하지 않으므로
    // 오케가 그때 바빴으면 이 티켓은 영영 재통보되지 않았다.
    h.now.value += 120_000;
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(2);
    expect(h.injects[1]).toContain("[자율 진행]");
    expect(h.injects[1]).toContain("t-board");
  });
});
