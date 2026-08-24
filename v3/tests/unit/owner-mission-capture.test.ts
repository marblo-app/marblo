/**
 * ★사장님 미션 포착 — **I/O 경로** (티켓 wx9c4NeVtZ1SGcbEISpg).
 *
 * 판정 규칙은 `work-chain-capture.test.ts` 가 못 박는다. 여기서 못 박는 것은
 * "사장님이 새 미션을 주면 체인에 **실제로** 남는다" 의 실체와, 그게 조용히
 * 죽거나 시끄럽게 넘치는 경로 넷이다.
 *
 *   ① ★재현: 사장님 텔레그램 → 오케가 티켓 생성 → `workChains/{projectId}`
 *      문서에 source=owner 항목이 들어간다. 세션은 이 문서를 다시 읽을 뿐이므로,
 *      문서에 들어갔다는 것이 곧 "오케브레인에 남는다" 이다.
 *   ② **소비 1회**: 같은 메시지의 같은 묶음에서 티켓이 더 생겨도 항목은 늘지
 *      않고 **근거 티켓으로 붙는다.** 항목이 티켓 수만큼 늘면 체인이 보드의
 *      사본이 되고, 그건 §7 설계 위반이다.
 *   ③ **창 밖**: 오래된 사장님 메시지에 지금 만든 티켓이 붙지 않는다. 이게
 *      없으면 오케 자기 티켓이 전부 사장님 미션으로 오분류된다.
 *   ④ ★**인바운드가 없으면 Firestore 를 읽지도 않는다** — 사장님 메시지가 없는
 *      평범한 create_task 의 비용과 소음이 0이어야 이 훅이 살아남는다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

// work-chain-capture-io.test.ts 와 같은 얇은 Firestore 가짜.
interface FakeDocSnap {
  exists(): boolean;
  data(): Record<string, unknown> | undefined;
}

const store = new Map<string, Record<string, unknown>>();
let getDocCalls = 0;

function snapFor(p: string): FakeDocSnap {
  const data = store.get(p);
  return { exists: () => data !== undefined, data: () => data };
}

vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, collection: string, id: string) => ({
    path: `${collection}/${id}`,
  }),
  getDoc: async (ref: { path: string }) => {
    getDocCalls++;
    return snapFor(ref.path);
  },
  runTransaction: async (
    _db: unknown,
    fn: (txn: unknown) => Promise<unknown>,
  ) => {
    const txn = {
      get: async (ref: { path: string }) => snapFor(ref.path),
      set: (ref: { path: string }, data: Record<string, unknown>) =>
        void store.set(ref.path, data),
      update: (ref: { path: string }, data: Record<string, unknown>) =>
        void store.set(ref.path, { ...store.get(ref.path), ...data }),
    };
    return fn(txn);
  },
  Timestamp: { now: () => ({ seconds: 0, nanoseconds: 0 }) },
  collection: () => ({}),
  getDocs: async () => ({ docs: [] }),
  query: () => ({}),
  where: () => ({}),
}));

const { captureOwnerMission, readWorkChain, OWNER_MISSION_WINDOW_MS } =
  await import("../../electron/mcp-server/work-chain");
const { recordOwnerInbound, readOwnerInbound, pruneOwnerInbound } =
  await import("../../electron/mcp-server/owner-inbound");

const db = {} as never;
const PROJECT = "proj1";
const CHAIN = `workChains/${PROJECT}`;
const BY = "orchestrator-proj1";

/**
 * ★2026-08-24 사장님 인바운드 원문(M1 광고 집행). 판정 규칙 테스트의 코퍼스와
 * 같은 문장을 쓴다 — I/O 경로도 실제 문장으로 재현해야 의미가 있다.
 */
const M1 =
  "1일만쓰고 끝이 이미 결론이야. 우린 개선을 했으니 이제 광고로 모수를 늘려보자는거야. " +
  "어쨌든 활성사용자가 3명정도 있다는건 제품의 가치를 보는 사람들이 있는거니까";

/** M5(마블로비서) — 한 통에 여러 가닥인 진짜 사례. */
const M5 =
  "B로 가려고해 왜냐면 헤르메스에이전트나 그록봇처럼 개발자가 아니더라도 마블로를 " +
  "비서형 에이전트로 쓸 수 있게 만들려는 것도 하나의 계획이거든. 위키 가이드도 필요하고 " +
  "슬랙이나 텔레그램 연결 별도 가이드도 한번 더, 이걸 마블로비서 탭으로 가고싶거든";

async function seedInbound(
  text: string,
  at: number,
  key = "telegram:proj1:1",
): Promise<void> {
  await recordOwnerInbound({
    key,
    projectId: PROJECT,
    channel: "telegram",
    from: "사장님",
    text,
    at,
  });
}

beforeEach(() => {
  store.clear();
  getDocCalls = 0;
  process.env.MARBLO_OWNER_INBOUND_PATH = path.join(
    process.cwd(),
    `.owner-inbound-test-${Date.now()}-${Math.random()}.json`,
  );
  process.env.MARBLO_WORK_CHAIN_SPOOL_PATH = path.join(
    process.cwd(),
    `.work-chain-spool-owner-test-${Date.now()}-${Math.random()}.json`,
  );
});

afterEach(async () => {
  for (const key of [
    "MARBLO_OWNER_INBOUND_PATH",
    "MARBLO_WORK_CHAIN_SPOOL_PATH",
  ]) {
    const p = process.env[key];
    if (p) await fs.rm(p, { force: true });
    delete process.env[key];
  }
});

describe("① ★재현 — 사장님이 준 미션이 오케브레인에 남는다", () => {
  it("사장님 메시지 직후 티켓이 생기면 source=owner 항목이 문서에 들어간다", async () => {
    const now = 1_700_000_000_000;
    await seedInbound(M5, now - 60_000);

    const res = await captureOwnerMission(db, {
      projectId: PROJECT,
      by: BY,
      tool: "create_tasks_bulk",
      now,
      tasks: [
        { id: "t1", title: "위키 탭", missionLabel: "marblo-secretary" },
        { id: "t2", title: "채널 연결 가이드", missionLabel: "marblo-secretary" },
        { id: "t3", title: "역할별 서브에이전트", missionLabel: "sub-agents" },
      ],
    });

    expect(res.error).toBeUndefined();
    // ★한 통에 미션이 여럿이면 갈라진다 — 라벨당 항목 하나.
    expect(res.written).toHaveLength(2);

    // 새 세션이 읽는 그 문서를 그대로 읽는다.
    const reread = await readWorkChain(db, PROJECT);
    expect(reread.items).toHaveLength(2);
    const [wiki, agents] = reread.items;
    expect(wiki.what).toBe("사장님 미션: marblo-secretary");
    expect(wiki.source).toBe("owner");
    expect(wiki.sourceTool).toBe("create_tasks_bulk");
    // ★티켓이 근거로 붙어 있어야 보드가 완료를 판정하고, 자기보고가 막힌다.
    expect(wiki.taskIds).toEqual(["t1", "t2"]);
    expect(wiki.missionLabel).toBe("marblo-secretary");
    expect(agents.what).toBe("사장님 미션: sub-agents");
    // 원문은 why 에 근거로만 남는다.
    expect(wiki.why).toContain("마블로비서 탭으로 가고싶거든");
  });

  it("질문 메시지 뒤에 티켓이 생겨도 잡지 않는다 — 오늘 실제 문장", async () => {
    const now = 1_700_000_000_000;
    await seedInbound("봇은 거를수있나?", now - 60_000);
    const res = await captureOwnerMission(db, {
      projectId: PROJECT,
      by: BY,
      tool: "create_task",
      now,
      tasks: [{ id: "t1", title: "무관한 티켓" }],
    });
    expect(res.written).toEqual([]);
    expect(res.skipped).toBe("all_questions");
    expect(store.get(CHAIN)).toBeUndefined();
  });

  it("포착 알림이 근거 티켓과 닫는 규칙을 같이 준다", async () => {
    const now = 1_700_000_000_000;
    await seedInbound(M1, now - 1000);
    const res = await captureOwnerMission(db, {
      projectId: PROJECT,
      by: BY,
      tool: "create_task",
      now,
      tasks: [{ id: "t1", title: "광고비 배포·어드민 입력", missionLabel: "ads-launch" }],
    });
    expect(res.note).toContain("사장님 미션");
    expect(res.note).toContain("t1");
    expect(res.note).toContain("자기보고로 닫히지 않는다");
  });
});

describe("② ★소비 1회 — 체인이 보드의 사본이 되지 않는다", () => {
  it("같은 미션의 두 번째 티켓은 새 항목이 아니라 근거로 붙는다", async () => {
    const now = 1_700_000_000_000;
    await seedInbound(M1, now - 60_000);
    const first = await captureOwnerMission(db, {
      projectId: PROJECT,
      by: BY,
      tool: "create_task",
      now,
      tasks: [{ id: "t1", title: "광고비 배포·어드민 입력", missionLabel: "ads-launch" }],
    });
    expect(first.written).toHaveLength(1);

    const second = await captureOwnerMission(db, {
      projectId: PROJECT,
      by: BY,
      tool: "create_task",
      now: now + 60_000,
      tasks: [{ id: "t2", title: "UTM 규약", missionLabel: "ads-launch" }],
    });
    expect(second.written).toEqual([]);
    expect(second.attached).toHaveLength(1);
    expect(second.attached[0].taskIds).toEqual(["t2"]);

    const reread = await readWorkChain(db, PROJECT);
    expect(reread.items).toHaveLength(1);
    expect(reread.items[0].taskIds).toEqual(["t1", "t2"]);
  });

  it("같은 티켓이 다시 와도 근거가 중복되지 않는다(멱등)", async () => {
    const now = 1_700_000_000_000;
    await seedInbound(M1, now - 60_000);
    const input = {
      projectId: PROJECT,
      by: BY,
      tool: "create_task",
      tasks: [{ id: "t1", title: "광고비 배포·어드민 입력", missionLabel: "ads-launch" }],
    };
    await captureOwnerMission(db, { ...input, now });
    const again = await captureOwnerMission(db, { ...input, now: now + 1000 });
    expect(again.written).toEqual([]);
    expect(again.attached).toEqual([]);
    const reread = await readWorkChain(db, PROJECT);
    expect(reread.items).toHaveLength(1);
    expect(reread.items[0].taskIds).toEqual(["t1"]);
  });
});

describe("③ 창 밖의 메시지에는 붙지 않는다", () => {
  it("창을 넘긴 사장님 메시지에 지금 만든 티켓이 붙지 않는다", async () => {
    const now = 1_700_000_000_000;
    await seedInbound(M1, now - OWNER_MISSION_WINDOW_MS - 1000);
    const res = await captureOwnerMission(db, {
      projectId: PROJECT,
      by: BY,
      tool: "create_task",
      now,
      tasks: [{ id: "t1", title: "오케가 스스로 연 티켓" }],
    });
    expect(res.written).toEqual([]);
    expect(res.skipped).toBe("out_of_window");
    expect(store.get(CHAIN)).toBeUndefined();
  });

  it("가장 최근 인바운드 하나만 본다 — 그 앞 메시지는 자기 차례에 판정됐다", async () => {
    const now = 1_700_000_000_000;
    await seedInbound(M1, now - 600_000, "telegram:proj1:1");
    await seedInbound("어드민 재설계하자", now - 60_000, "telegram:proj1:2");
    const res = await captureOwnerMission(db, {
      projectId: PROJECT,
      by: BY,
      tool: "create_task",
      now,
      tasks: [{ id: "t1", title: "어드민 정보구조" }],
    });
    expect(res.written).toHaveLength(1);
    expect(res.written[0].what).toBe("사장님 지시: 어드민 정보구조");
    const reread = await readWorkChain(db, PROJECT);
    expect(reread.items[0].why).toContain("어드민 재설계하자");
  });
});

describe("④ ★인바운드가 없으면 Firestore 를 건드리지도 않는다", () => {
  it("평범한 create_task 의 비용과 소음은 0이다", async () => {
    const res = await captureOwnerMission(db, {
      projectId: PROJECT,
      by: BY,
      tool: "create_task",
      now: 1_700_000_000_000,
      tasks: [{ id: "t1", title: "오케가 스스로 연 티켓" }],
    });
    expect(res.note).toBe("");
    expect(res.skipped).toBe("no_inbound");
    expect(getDocCalls).toBe(0);
    expect(store.size).toBe(0);
  });

  it("티켓이 0건이면 아무것도 하지 않는다", async () => {
    await seedInbound(M1, Date.now());
    const res = await captureOwnerMission(db, {
      projectId: PROJECT,
      by: BY,
      tool: "create_task",
      tasks: [],
    });
    expect(res.skipped).toBe("no_tasks");
    expect(getDocCalls).toBe(0);
  });
});

// ── 저널 자체 ────────────────────────────────────────────────────────────
//
// 이 파일은 메인 프로세스(폴러)와 MCP 서버 사이의 유일한 통로다. 여기가
// 조용히 깨지면 사장님 미션은 다시 0건이 된다.

describe("owner-inbound 저널", () => {
  it("적고 최신순으로 읽는다", async () => {
    await seedInbound("먼저", 100, "k1");
    await seedInbound("나중", 200, "k2");
    const entries = await readOwnerInbound(PROJECT);
    expect(entries.map((e) => e.text)).toEqual(["나중", "먼저"]);
  });

  it("★같은 key 는 덮어쓰지 않는다 — 재전달이 consumed 표시를 지우면 안 된다", async () => {
    await seedInbound("원본", 100, "k1");
    await seedInbound("재전달", 200, "k1");
    const entries = await readOwnerInbound(PROJECT);
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe("원본");
  });

  it("다른 프로젝트의 인바운드는 섞이지 않는다", async () => {
    await seedInbound("우리 것", 100, "k1");
    await recordOwnerInbound({
      key: "k2",
      projectId: "other",
      channel: "telegram",
      from: "누구",
      text: "남의 것",
      at: 200,
    });
    const entries = await readOwnerInbound(PROJECT);
    expect(entries.map((e) => e.text)).toEqual(["우리 것"]);
  });

  it("프로젝트별 상한을 넘으면 오래된 것부터 버린다", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      key: `k${i}`,
      projectId: PROJECT,
      channel: "telegram" as const,
      from: "사장님",
      text: `m${i}`,
      at: i,
    }));
    const kept = pruneOwnerInbound(many);
    expect(kept).toHaveLength(12);
    // 최신 12건이 남고, 저장 순서는 오래된 것부터.
    expect(kept[0].text).toBe("m18");
    expect(kept[kept.length - 1].text).toBe("m29");
  });

  it("파일이 없으면 빈 배열 — 읽기는 절대 안 죽는다", async () => {
    process.env.MARBLO_OWNER_INBOUND_PATH = path.join(
      process.cwd(),
      ".owner-inbound-does-not-exist.json",
    );
    expect(await readOwnerInbound(PROJECT)).toEqual([]);
  });
});
