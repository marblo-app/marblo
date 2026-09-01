// 보드 → 오케 주기 재동기화 회귀 (티켓 tHQzXPvFaR29fy0I82rM).
//
// 고정하는 계약:
//   ① ★알림이 유실돼도 스위프가 미처리 REVIEW 를 발견해 오케 PTY 로 민다
//      (2026-09-01 REVIEW 제출 3건이 조용히 증발한 사건의 직접 회귀 테스트 —
//      이 테스트가 없어서 웹링크 건을 놓쳤다는 잣대를 그대로 적용).
//   ② 같은 오케 세션에는 같은 항목을 두 번 밀지 않는다(알림 폭주 방지).
//   ③ 오케 세션이 갈리면(재시작) 미처리분 전체가 재통보된다(재시작 블랙아웃 수리).
//   ④ 주입 실패는 seen 으로 기록하지 않는다 → 다음 틱 자동 재시도.
//   ⑤ 고아 티켓(claim 에이전트가 플릿에 없음)·체인 READY 도 같은 경로로 닿는다.
//
// 순수 DI 하니스 — PR #1354(BrowserPaneOpenUrlDelivery)의 테스트 규율을 따른다.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OrchestratorBoardResync,
  classifyResyncAttention,
  buildBoardResyncDigest,
  directDeliverySeenKeys,
  resyncSeenKey,
  type BoardResyncDeps,
  type ResyncChainReadyRow,
  type ResyncTaskRow,
} from "../../electron/orchestrator-board-resync";

const MIN_AGE = 180_000;
const ORPHAN_MIN_AGE = 600_000;

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
    ageMs: 10 * 60_000,
    ...over,
  };
}

interface Harness {
  resync: OrchestratorBoardResync;
  injects: Array<{ projectId: string; message: string }>;
  setRows(rows: ResyncTaskRow[]): void;
  setChain(items: ResyncChainReadyRow[]): void;
  setInjectResult(ok: boolean): void;
  setSession(session: { ptySessionId: string; status: string } | null): void;
  aliveAgents: Set<string>;
  deps: BoardResyncDeps;
}

function harness(over: Partial<BoardResyncDeps> = {}): Harness {
  let rows: ResyncTaskRow[] = [];
  let chain: ResyncChainReadyRow[] = [];
  let injectResult = true;
  let session: { ptySessionId: string; status: string } | null = {
    ptySessionId: "pty-1",
    status: "running",
  };
  const injects: Array<{ projectId: string; message: string }> = [];
  const aliveAgents = new Set<string>();
  const deps: BoardResyncDeps = {
    listBoardOrchestratorProjects: () => ["p1"],
    getOrchestratorSession: () => session,
    listAttentionTasks: async () => rows,
    isAgentAliveInFleet: (agentId) => aliveAgents.has(agentId),
    listReadyChainItems: async () => chain,
    inject: async (projectId, message) => {
      injects.push({ projectId, message });
      return injectResult;
    },
    log: () => {},
    logError: () => {},
    minAgeMs: MIN_AGE,
    orphanMinAgeMs: ORPHAN_MIN_AGE,
    ...over,
  };
  return {
    resync: new OrchestratorBoardResync(deps),
    injects,
    setRows: (r) => {
      rows = r;
    },
    setChain: (c) => {
      chain = c;
    },
    setInjectResult: (ok) => {
      injectResult = ok;
    },
    setSession: (s) => {
      session = s;
    },
    aliveAgents,
    deps,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("★유실 회귀 — 알림이 떨어진 상태에서도 스위프가 미처리 REVIEW 를 발견한다", () => {
  it("직접 알림 없이 REVIEW 에 머문 티켓이 다이제스트로 오케 PTY 에 닿는다", async () => {
    const h = harness();
    // 시나리오: submit_for_review 의 [Review Submitted] 가 유실됐다(스위프
    // 입장에서는 애초에 그 알림의 존재를 모른다 — 보드 상태만 본다).
    h.setRows([row({ taskId: "R3EZtQPri5wHjix8s833" })]);
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);
    expect(h.injects[0].projectId).toBe("p1");
    expect(h.injects[0].message).toContain("[보드 재동기화]");
    expect(h.injects[0].message).toContain("R3EZtQPri5wHjix8s833");
    expect(h.injects[0].message).toContain("REVIEW 대기");
  });

  it("FAILED·BLOCKED 도 같은 경로로 닿는다", async () => {
    const h = harness();
    h.setRows([
      row({ taskId: "t-f", status: "FAILED" }),
      row({ taskId: "t-b", status: "BLOCKED" }),
    ]);
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);
    expect(h.injects[0].message).toContain("t-f");
    expect(h.injects[0].message).toContain("t-b");
  });
});

describe("알림 폭주 방지 — seen 추적", () => {
  it("같은 세션에는 같은 (task,status) 를 두 번 밀지 않는다", async () => {
    const h = harness();
    h.setRows([row()]);
    await h.resync.tickOnce();
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);
  });

  it("한 틱의 항목 여러 건은 다이제스트 1통으로 묶인다", async () => {
    const h = harness();
    h.setRows([
      row({ taskId: "a" }),
      row({ taskId: "b", status: "FAILED" }),
      row({ taskId: "c", status: "BLOCKED" }),
    ]);
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);
  });

  it("전이 직후(minAge 미만)의 REVIEW 는 건너뛴다 — 직접 알림에게 먼저 기회를 준다", async () => {
    const h = harness();
    h.setRows([row({ ageMs: MIN_AGE - 1 })]);
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(0);
  });

  it("나이를 모르는(ageMs=null) 티켓은 숨기지 않고 통보한다", async () => {
    const h = harness();
    h.setRows([row({ ageMs: null })]);
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);
  });

  it("다이제스트 항목 수를 캡하고 초과분 수를 밝힌다", async () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      kind: "review" as const,
      row: row({ taskId: `t${i}` }),
    }));
    const msg = buildBoardResyncDigest(entries, [], 3);
    expect(msg).toContain("5건");
    expect(msg).toContain("외 2건");
    expect(msg).not.toContain("t3");
  });
});

describe("★재시작 블랙아웃 수리 — 세션 단위 seen", () => {
  it("오케 세션이 갈리면(새 ptySessionId) 미처리분이 다시 통보된다", async () => {
    const h = harness();
    h.setRows([row()]);
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);
    // 오케 재시작 — 새 PTY 세션. 새 세션은 아무것도 본 적이 없다.
    h.setSession({ ptySessionId: "pty-2", status: "running" });
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(2);
    expect(h.injects[1].message).toContain("t-review");
  });

  it("오케가 내려가 있으면 주입하지 않고, seen 도 남기지 않는다", async () => {
    const h = harness();
    h.setRows([row()]);
    h.setSession(null);
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(0);
    // 오케가 살아나면 그때 통보된다.
    h.setSession({ ptySessionId: "pty-1", status: "running" });
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);
  });

  it("starting 세션에는 아직 밀지 않는다(부팅 게이트 오염 방지)", async () => {
    const h = harness();
    h.setRows([row()]);
    h.setSession({ ptySessionId: "pty-1", status: "starting" });
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(0);
  });
});

describe("주입 실패 = 조용한 실패 금지", () => {
  it("inject 가 false 면 seen 에 기록하지 않아 다음 틱에 재시도된다", async () => {
    const h = harness();
    h.setRows([row()]);
    h.setInjectResult(false);
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);
    h.setInjectResult(true);
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(2);
    // 성공했으니 이제는 멈춘다.
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(2);
  });

  it("티켓 조회가 실패해도 throw 하지 않고 다음 틱을 기다린다", async () => {
    const h = harness({
      listAttentionTasks: async () => {
        throw new Error("firestore offline");
      },
    });
    await expect(h.resync.tickOnce()).resolves.toBeUndefined();
    expect(h.injects).toHaveLength(0);
  });

  it("체인 조회 실패가 티켓 축의 전달을 막지 않는다", async () => {
    const h = harness({
      listReadyChainItems: async () => {
        throw new Error("workChains permission-denied");
      },
    });
    h.setRows([row()]);
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);
    expect(h.injects[0].message).toContain("t-review");
  });
});

describe("고아 티켓 축 (③)", () => {
  it("claim 한 에이전트가 플릿에 없는 IN_PROGRESS 는 고아로 통보된다", async () => {
    const h = harness();
    h.setRows([
      row({
        taskId: "t-orphan",
        status: "IN_PROGRESS",
        claimedBy: "dead-agent",
        ageMs: ORPHAN_MIN_AGE,
      }),
    ]);
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);
    expect(h.injects[0].message).toContain("고아 티켓");
    expect(h.injects[0].message).toContain("t-orphan");
  });

  it("ghost reclaim 이 claim 만 푼(claimedBy 없음) IN_PROGRESS 도 고아다", async () => {
    const h = harness();
    h.setRows([
      row({
        taskId: "t-released",
        status: "IN_PROGRESS",
        claimedBy: null,
        ageMs: ORPHAN_MIN_AGE,
      }),
    ]);
    await h.resync.tickOnce();
    expect(h.injects[0]?.message).toContain("t-released");
  });

  it("플릿에 살아 있는 에이전트의 티켓은 고아가 아니다", async () => {
    const h = harness();
    h.aliveAgents.add("live-agent");
    h.setRows([
      row({
        taskId: "t-live",
        status: "IN_PROGRESS",
        claimedBy: "live-agent",
        ageMs: ORPHAN_MIN_AGE,
      }),
    ]);
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(0);
  });

  it("보드 침묵이 짧으면(다른 머신 에이전트 가능성) 고아로 부르지 않는다", async () => {
    const h = harness();
    h.setRows([
      row({
        taskId: "t-young",
        status: "IN_PROGRESS",
        claimedBy: "remote-agent",
        ageMs: ORPHAN_MIN_AGE - 1,
      }),
    ]);
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(0);
  });
});

describe("체인 READY 축 (④)", () => {
  it("READY 항목이 다이제스트에 실리고, 같은 세션에는 1회만", async () => {
    const h = harness();
    h.setChain([{ itemId: "wc1", what: "온보딩 2단계 티켓 발행" }]);
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);
    expect(h.injects[0].message).toContain("체인 READY");
    expect(h.injects[0].message).toContain("온보딩 2단계 티켓 발행");
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);
  });
});

describe("classifyResyncAttention — 축 판정(순수)", () => {
  const alive = (id: string) => id === "live";
  const classify = (r: ResyncTaskRow) =>
    classifyResyncAttention(r, alive, MIN_AGE, ORPHAN_MIN_AGE);

  it("미션 티켓은 컨덕터 소관 — 항상 제외", () => {
    expect(classify(row({ isMission: true }))).toBeNull();
    expect(
      classify(
        row({
          isMission: true,
          status: "IN_PROGRESS",
          claimedBy: "dead",
          ageMs: ORPHAN_MIN_AGE,
        }),
      ),
    ).toBeNull();
  });

  it("레인은 REVIEW 만 통과(P4 — 리뷰 게이트), FAILED/BLOCKED/고아는 침묵", () => {
    expect(classify(row({ contextId: "lane:abc" }))).toBe("review");
    expect(classify(row({ contextId: "lane:abc", status: "FAILED" }))).toBeNull();
    expect(
      classify(row({ contextId: "lane:abc", status: "BLOCKED" })),
    ).toBeNull();
    expect(
      classify(
        row({
          contextId: "lane:abc",
          status: "IN_PROGRESS",
          claimedBy: "dead",
          ageMs: ORPHAN_MIN_AGE,
        }),
      ),
    ).toBeNull();
  });

  it("TODO/DONE 등 그 외 상태는 관심사가 아니다", () => {
    expect(classify(row({ status: "TODO" }))).toBeNull();
    expect(classify(row({ status: "DONE" }))).toBeNull();
  });

  it("CLAIMED 도 고아 판정 대상이다", () => {
    expect(
      classify(
        row({ status: "CLAIMED", claimedBy: "dead", ageMs: ORPHAN_MIN_AGE }),
      ),
    ).toBe("orphan");
    expect(
      classify(
        row({ status: "CLAIMED", claimedBy: "live", ageMs: ORPHAN_MIN_AGE }),
      ),
    ).toBeNull();
  });
});

describe("이중 검증 방지 — 직접 알림이 성공 전달된 항목은 다이제스트가 밀지 않는다", () => {
  it("[Review Submitted] 주입 성공 관찰 후에는 그 REVIEW 를 재통보하지 않는다", async () => {
    const h = harness();
    h.setRows([row({ taskId: "t-delivered" })]);
    // 브리지 관찰자 경로: 직접 알림이 현재 세션에 주입 성공했다.
    h.resync.noteDirectDelivery(
      "p1",
      "t-delivered",
      '[Review Submitted] "T" is ready for review (backend, id=t-delivered)',
    );
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(0);
  });

  it("직접 전달을 본 세션이 재시작되면(새 pty) 다시 통보한다", async () => {
    const h = harness();
    h.setRows([row({ taskId: "t-delivered" })]);
    h.resync.noteDirectDelivery(
      "p1",
      "t-delivered",
      '[Review Submitted] "T" is ready for review (backend, id=t-delivered)',
    );
    h.setSession({ ptySessionId: "pty-2", status: "running" });
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);
    expect(h.injects[0].message).toContain("t-delivered");
  });

  it("오케 세션이 없을 때의 관찰은 기록하지 않는다(누가 봤는지 모르면 mark 금지)", async () => {
    const h = harness();
    h.setRows([row({ taskId: "t-x" })]);
    h.setSession(null);
    h.resync.noteDirectDelivery(
      "p1",
      "t-x",
      '[Review Submitted] "T" is ready for review (backend, id=t-x)',
    );
    h.setSession({ ptySessionId: "pty-1", status: "running" });
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);
  });

  it("directDeliverySeenKeys — 아는 포맷만 mark, 모르면 빈 배열(fail-open)", () => {
    expect(
      directDeliverySeenKeys(
        "t1",
        '[Review Submitted] "T" is ready for review (backend, id=t1)',
      ),
    ).toEqual(["review:t1:REVIEW"]);
    expect(
      directDeliverySeenKeys(
        "t1",
        '[Task Update] "T" IN_PROGRESS → FAILED (backend, id=t1)',
      ),
    ).toEqual(["failed:t1:FAILED"]);
    expect(
      directDeliverySeenKeys(
        "t1",
        '[Task Update] "T" IN_PROGRESS → BLOCKED (backend, id=t1)',
      ),
    ).toEqual(["blocked:t1:BLOCKED"]);
    // DONE 은 스위프 관심사가 아니라 mark 하지 않는다.
    expect(
      directDeliverySeenKeys(
        "t1",
        '[Task Update] "T" REVIEW → DONE (backend, id=t1)',
      ),
    ).toEqual([]);
    // taskId 없으면 아무것도 mark 하지 않는다.
    expect(
      directDeliverySeenKeys(
        undefined,
        '[Review Submitted] "T" is ready for review (backend, id=t1)',
      ),
    ).toEqual([]);
    // 모르는 포맷 — 중복 통보가 잘못 삼키는 것보다 낫다.
    expect(directDeliverySeenKeys("t1", "[Question] 무엇을 할까요")).toEqual([]);
  });
});

describe("resyncSeenKey — 재통보 단위", () => {
  it("고아 키는 claim 주체가 갈리면 새 사건으로 본다", () => {
    const a = resyncSeenKey({
      kind: "orphan",
      row: row({ status: "IN_PROGRESS", claimedBy: "agent-1" }),
    });
    const b = resyncSeenKey({
      kind: "orphan",
      row: row({ status: "IN_PROGRESS", claimedBy: "agent-2" }),
    });
    expect(a).not.toBe(b);
  });

  it("같은 티켓이라도 상태가 다르면 키가 다르다(FAILED 후 재 REVIEW 등)", () => {
    const a = resyncSeenKey({ kind: "review", row: row() });
    const b = resyncSeenKey({
      kind: "failed",
      row: row({ status: "FAILED" }),
    });
    expect(a).not.toBe(b);
  });
});
