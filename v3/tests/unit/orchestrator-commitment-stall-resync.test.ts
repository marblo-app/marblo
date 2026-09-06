// 약속 정체 패스의 배선 회귀 (티켓 WLC9OjIJ8lbCAuz6WlNG) — OrchestratorBoardResync
// 통합. 순수 판정 자체의 진리표는 tests/unit/orchestrator-commitment-stall.test.ts
// 가 고정한다. 여기서는 "매 틱 워크체인의 open+auto 항목을 읽어 실제로 질문을
// 주입하는가" 라는 배선만 본다.
//
// 고정하는 계약:
//   ① ★배선을 안 주면(commitmentStallEnabled 미지정) 기존 동작이 한 줄도 안
//      바뀐다 — 워크체인을 아예 안 읽는다(listOpenAutoCommitments 호출 안 됨).
//   ② 항목이 판정 창(10분) 동안 안 움직이면 질문을 주입한다.
//   ③ ★같은 항목을 쿨다운 안에 다시 안 묻는다.
//   ④ updatedAt 이 갱신되면(오케가 실제로 손댔다는 뜻) 더는 후보가 아니다.
//   ⑤ 다른 패스가 이미 이번 틱에 뭔가 밀었으면 이 패스는 조용히 넘어간다
//      (같은 틱 이중 통보 방지 규율).

import { describe, expect, it, vi } from "vitest";
import {
  OrchestratorBoardResync,
  type BoardResyncDeps,
  type ResyncTaskRow,
} from "../../electron/orchestrator-board-resync";
import {
  COMMITMENT_STALL_WINDOW_MS,
  type CommitmentItem,
} from "../../electron/orchestrator-commitment-stall";

const WINDOW = COMMITMENT_STALL_WINDOW_MS; // 10분

interface Harness {
  resync: OrchestratorBoardResync;
  injects: string[];
  now: { value: number };
  commitments: CommitmentItem[];
  listOpenAutoCommitmentsSpy: ReturnType<typeof vi.fn>;
}

function commitment(over: Partial<CommitmentItem> = {}): CommitmentItem {
  return {
    id: "wc_promise1",
    what: "별도로 정리해서 드리겠습니다",
    createdAt: 1_000_000,
    updatedAt: 1_000_000,
    ...over,
  };
}

function harness(over: Partial<BoardResyncDeps> = {}): Harness {
  const injects: string[] = [];
  const now = { value: 1_000_000 };
  const commitments: CommitmentItem[] = [commitment()];
  const listOpenAutoCommitmentsSpy = vi.fn(async () => commitments);
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
    now: () => now.value,
    commitmentStallEnabled: () => true,
    listOpenAutoCommitments: listOpenAutoCommitmentsSpy,
    isOwnerInputPending: async () => false,
    ...over,
  });
  return { resync, injects, now, commitments, listOpenAutoCommitmentsSpy };
}

describe("OrchestratorBoardResync — 약속 정체 패스 배선", () => {
  it("★배선을 안 주면(commitmentStallEnabled 미지정) 워크체인을 아예 안 읽는다", async () => {
    const h = harness({ commitmentStallEnabled: undefined });
    h.now.value += WINDOW + 60_000;
    await h.resync.tickOnce();
    expect(h.injects).toEqual([]);
    expect(h.listOpenAutoCommitmentsSpy).not.toHaveBeenCalled();
  });

  it("플래그가 꺼져 있으면 안 읽는다", async () => {
    const h = harness({ commitmentStallEnabled: () => false });
    h.now.value += WINDOW + 60_000;
    await h.resync.tickOnce();
    expect(h.injects).toEqual([]);
    expect(h.listOpenAutoCommitmentsSpy).not.toHaveBeenCalled();
  });

  it("★판정 창 안에서는 안 묻는다", async () => {
    const h = harness();
    h.now.value += WINDOW - 60_000;
    await h.resync.tickOnce();
    expect(h.injects).toEqual([]);
  });

  it("★판정 창을 채우면 질문을 주입한다", async () => {
    const h = harness();
    h.now.value += WINDOW;
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);
    expect(h.injects[0]).toContain("[약속 확인]");
    expect(h.injects[0]).toContain("별도로 정리해서 드리겠습니다");
    expect(h.injects[0]).toContain("wc_promise1");
  });

  it("★같은 항목을 쿨다운 안에 다시 안 묻는다", async () => {
    const h = harness();
    h.now.value += WINDOW;
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);

    h.now.value += 60_000; // 쿨다운 안
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1); // 늘지 않았다
  });

  it("★쿨다운이 지나면 여전히 안 움직였을 때 다시 묻는다", async () => {
    const h = harness();
    h.now.value += WINDOW;
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);

    h.now.value += WINDOW; // 쿨다운 경과
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(2);
  });

  it("★오케가 항목을 실제로 건드리면(updatedAt 갱신) 정체 시계가 리셋된다", async () => {
    const h = harness();
    h.now.value += WINDOW;
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);

    // update_work_chain_item 이 호출된 상황을 흉내낸다 — updatedAt 이 지금으로 갱신됨.
    h.commitments[0] = { ...h.commitments[0], updatedAt: h.now.value };
    h.now.value += WINDOW - 60_000; // 갱신 이후로는 아직 판정 창 전
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1); // 늘지 않았다 — 갱신 이후 기준으로는 아직 정체가 아니다

    h.now.value += 60_000; // 갱신 이후로 판정 창을 채웠다 — 다시 정체
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(2);
  });

  it("같은 틱에 다른 패스가 이미 밀었으면 조용히 넘어간다", async () => {
    const h = harness({
      listAttentionTasks: async () => [
        {
          taskId: "t1",
          projectId: "p1",
          status: "REVIEW",
          title: "제목",
          role: "backend",
          prUrl: null,
          contextId: "board",
          isMission: false,
          claimedBy: null,
          ageMs: 10 * 60_000,
        } satisfies ResyncTaskRow,
      ],
    });
    h.now.value += WINDOW;
    await h.resync.tickOnce();
    // 다이제스트가 REVIEW 티켓을 먼저 밀었으므로 약속 정체 패스는 이번 틱에
    // 안 돈다(워크체인 조회 자체를 안 한다).
    expect(h.injects).toHaveLength(1);
    expect(h.injects[0]).not.toContain("[약속 확인]");
    expect(h.listOpenAutoCommitmentsSpy).not.toHaveBeenCalled();
  });

  it("항목이 없으면 조용하다 — 워크체인 조회는 하되 아무것도 안 민다", async () => {
    const h = harness();
    h.commitments.length = 0;
    h.now.value += WINDOW;
    await h.resync.tickOnce();
    expect(h.injects).toEqual([]);
  });
});
