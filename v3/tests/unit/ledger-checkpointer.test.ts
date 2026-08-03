/**
 * 감사 원장 L3 — 주기적 체크포인터 유닛 테스트.
 *
 * 여기서 못박는 것(스펙 §6/§10/§11):
 *  - 첫 실행은 **제네시스**를 찍는다 — 보증 구간의 시작을 원장 안에 남긴다(§10)
 *  - 체크포인트끼리 이어진다 — 체크포인트를 지운 흔적이 드러난다
 *  - ★관측 창에 안 잡힌 조용한 체인을 **삭제로 단정하지 않는다** (거짓 양성 방지)
 *  - 그러면서도 진짜 잘림·갈아끼움은 보고한다
 *  - 쓰기 실패는 던지지 않고 다음 주기로 넘긴다 — 공백은 결과에 남는다(§11)
 */
import { describe, it, expect } from "vitest";

import {
  CHECKPOINT_WINDOW,
  formatCycleNotice,
  runCheckpointCycle,
  type CheckpointerDeps,
} from "../../electron/ledger-checkpointer";
import {
  LedgerChainSealer,
  buildCheckpoint,
  buildGenesisCheckpoint,
  chainsMerkleRoot,
  verifyCheckpointAgainstHeads,
  verifyCheckpointChain,
  type ChainEntry,
  type ChainHead,
  type LedgerCheckpoint,
  type SealedLedgerEvent,
} from "../../electron/mcp-server/ledger-chain";
import type { LedgerEventWrite } from "../../electron/mcp-server/ledger";

const PROJECT = "GFB8JnJrrX6AgahqmGB3";

function evt(n: number, agentId: string): LedgerEventWrite {
  return {
    projectId: PROJECT,
    agentId,
    toolName: `tool_${n}`,
    params: { n },
    result: "ok",
    duration: 1,
    success: true,
    kind: "action",
    actorUid: "uid-1",
    model: "claude",
    tier: "standard",
    instructionHash: null,
    taskId: null,
    worktreeId: null,
  };
}

/** 에이전트 하나의 봉인된 체인. */
function chainFor(agentId: string, count: number): ChainEntry[] {
  const sealer = new LedgerChainSealer(agentId);
  const out: ChainEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = `${agentId}-${i}`;
    const occurredAtMs = 1_000 + i;
    out.push({
      id,
      occurredAtMs,
      event: sealer.seal(evt(i, agentId), { id, occurredAtMs }),
    });
  }
  return out;
}

const headOf = (entries: ChainEntry[]): ChainHead => {
  const last = entries[entries.length - 1].event as SealedLedgerEvent;
  return {
    projectId: last.projectId,
    agentId: last.agentId,
    seq: last.seq,
    hash: last.hash,
  };
};

/** 인메모리 원장. Firestore 를 흉내내되 실패를 주입할 수 있다. */
function makeDeps(opts: {
  checkpoints?: LedgerCheckpoint[];
  events?: ChainEntry[];
  failWrite?: string;
  failLoadCheckpoints?: string;
  failLoadEvents?: string;
}): CheckpointerDeps & { written: LedgerCheckpoint[]; windowAsked: number[] } {
  const written: LedgerCheckpoint[] = [];
  const windowAsked: number[] = [];
  const store = [...(opts.checkpoints ?? [])];
  return {
    written,
    windowAsked,
    now: () => 5_000_000,
    loadCheckpoints: async () => {
      if (opts.failLoadCheckpoints) throw new Error(opts.failLoadCheckpoints);
      return store;
    },
    loadRecentEvents: async (_p, limit) => {
      windowAsked.push(limit);
      if (opts.failLoadEvents) throw new Error(opts.failLoadEvents);
      return opts.events ?? [];
    },
    writeCheckpoint: async (cp) => {
      if (opts.failWrite) throw new Error(opts.failWrite);
      written.push(cp);
      store.push(cp);
    },
  };
}

describe("제네시스 (§10 — 소급 보증 포기, 경계 명시)", () => {
  it("체크포인트가 하나도 없으면 제네시스를 찍는다", async () => {
    const deps = makeDeps({});

    const r = await runCheckpointCycle(PROJECT, deps);

    expect(r.genesis).toBe(true);
    expect(r.written?.kind).toBe("genesis");
    expect(r.written?.seqNo).toBe(0);
    expect(r.written?.chains).toEqual([]);
    expect(r.error).toBeNull();
  });

  it("★제네시스 주기에는 원장을 읽지 않는다 — 소급해서 봉인하지 않는다", async () => {
    const deps = makeDeps({ events: chainFor("a", 3) });

    await runCheckpointCycle(PROJECT, deps);

    // 이미 쓰인 기록은 그 시점에 무결성 증거가 없었다. 지금 읽어 명부에 넣으면
    // 없던 보증을 있는 것처럼 만들게 된다.
    expect(deps.windowAsked).toEqual([]);
  });

  it("제네시스 기록에 실패하면 던지지 않고 다음 주기로 넘긴다 (§11)", async () => {
    const deps = makeDeps({ failWrite: "permission-denied" });

    const r = await runCheckpointCycle(PROJECT, deps);

    expect(r.written).toBeNull();
    expect(r.error).toContain("permission-denied");
    expect(formatCycleNotice(r)).toContain("다음 주기에 재시도");
  });
});

describe("주기 체크포인트", () => {
  const genesis = buildGenesisCheckpoint(PROJECT, 1_000);

  it("관측된 체인 머리를 봉인하고 앞 장에 잇는다", async () => {
    const a = chainFor("a", 3);
    const b = chainFor("b", 5);
    const deps = makeDeps({ checkpoints: [genesis], events: [...a, ...b] });

    const r = await runCheckpointCycle(PROJECT, deps);

    expect(r.genesis).toBe(false);
    expect(r.written?.seqNo).toBe(1);
    expect(r.written?.prevCheckpointHash).toBe(genesis.hash);
    expect(r.chains).toBe(2);
    expect(r.checkedEvents).toBe(8);
    expect(r.chainIssues).toEqual([]);
    // 봉인된 명부가 실제 머리와 일치한다.
    expect(r.written?.merkleRoot).toBe(
      chainsMerkleRoot([headOf(a), headOf(b)]),
    );
  });

  it("연속 주기가 체크포인트 체인을 이룬다 (지우면 드러나는 구조)", async () => {
    const deps = makeDeps({ checkpoints: [genesis], events: chainFor("a", 2) });

    await runCheckpointCycle(PROJECT, deps);
    await runCheckpointCycle(PROJECT, deps);

    const all = [genesis, ...deps.written];
    expect(all.map((c) => c.seqNo)).toEqual([0, 1, 2]);
    expect(verifyCheckpointChain(all).ok).toBe(true);
  });

  it("창 상한을 넘겨 요청한다 (전량 스캔하지 않는다)", async () => {
    const deps = makeDeps({ checkpoints: [genesis] });

    await runCheckpointCycle(PROJECT, deps);

    expect(deps.windowAsked).toEqual([CHECKPOINT_WINDOW]);
  });
});

describe("★관측 창과 거짓 양성 — 조용한 체인을 삭제로 단정하지 않는다", () => {
  it("이번 창에 안 잡힌 체인도 명부에 남고, 이상으로 보고되지 않는다", async () => {
    const a = chainFor("a", 3);
    const b = chainFor("b", 4);
    // ★제네시스까지 온전히 넣는다. 제네시스를 빼면 체크포인트 체인 자체에 구멍이
    // 생겨(checkpoint-gap) "조용한 체인은 이상이 아니다"라는 이 테스트의 주장이
    // 다른 이유로 오염된다.
    const g = buildGenesisCheckpoint(PROJECT, 1_000);
    const first = buildCheckpoint({
      projectId: PROJECT,
      kind: "periodic",
      seqNo: 1,
      atMs: 2_000,
      chains: [headOf(a), headOf(b)],
      prevCheckpointHash: g.hash,
    });
    // 다음 주기의 창에는 a 만 잡혔다 — b 는 그냥 조용했을 뿐이다.
    const deps = makeDeps({ checkpoints: [g, first], events: a });

    const r = await runCheckpointCycle(PROJECT, deps);

    expect(r.chains).toBe(2); // b 가 명부에서 빠지지 않았다
    expect(r.checkpointIssues).toEqual([]); // 삭제로 단정하지 않았다
    expect(r.written?.chains.map((c) => c.agentId).sort()).toEqual(["a", "b"]);
  });

  it("★명부에 남기 때문에 나중에 진짜 삭제되면 전체 감사에서 잡힌다", async () => {
    // 조용해서 이월된 체인이 그 다음에 통째로 삭제되는 시나리오. 이월이 없었다면
    // 대조할 명부 자체가 없어 탐지가 죽는다.
    const a = chainFor("a", 3);
    const b = chainFor("b", 4);
    const first = buildCheckpoint({
      projectId: PROJECT,
      kind: "periodic",
      seqNo: 1,
      atMs: 2_000,
      chains: [headOf(a), headOf(b)],
      prevCheckpointHash: "g",
    });
    const deps = makeDeps({ checkpoints: [first], events: a });
    const r = await runCheckpointCycle(PROJECT, deps);

    // 전체 감사: 원장에 남은 머리를 전부 열거해 대조한다(a 만 남았다).
    const verdict = verifyCheckpointAgainstHeads(r.written!, [headOf(a)]);

    expect(verdict.ok).toBe(false);
    expect(verdict.issues[0].kind).toBe("chain-missing");
    expect(verdict.issues[0].agentId).toBe("b");
  });

  it("관측된 체인의 머리가 뒤로 가면 잘림으로 보고하고 앞선 값을 유지한다", async () => {
    const a = chainFor("a", 5);
    const first = buildCheckpoint({
      projectId: PROJECT,
      kind: "periodic",
      seqNo: 1,
      atMs: 2_000,
      chains: [headOf(a)],
      prevCheckpointHash: "g",
    });
    // 뒤 2건이 삭제된 상태로 관측된다.
    const deps = makeDeps({ checkpoints: [first], events: a.slice(0, 3) });

    const r = await runCheckpointCycle(PROJECT, deps);

    expect(r.checkpointIssues.map((i) => i.kind)).toContain("chain-truncated");
    // ★잘린 머리를 새 체크포인트에 정상으로 박제하지 않는다.
    expect(r.written?.chains[0].seq).toBe(4);
    expect(formatCycleNotice(r)).toContain("chain-truncated");
  });
});

describe("창 안에서 발견된 체인 이상", () => {
  const genesis = buildGenesisCheckpoint(PROJECT, 1_000);

  it("중간이 삭제된 체인은 chainIssues 로 보고된다", async () => {
    const a = chainFor("a", 5);
    const holed = a.filter((e) => (e.event as SealedLedgerEvent).seq !== 2);
    const deps = makeDeps({ checkpoints: [genesis], events: holed });

    const r = await runCheckpointCycle(PROJECT, deps);

    expect(r.chainIssues.map((i) => i.kind)).toContain("broken-link");
    expect(formatCycleNotice(r)).toContain("체인 이상");
  });

  it("★창의 앞이 잘린 것은 이상이 아니다 (거짓 양성 방지)", async () => {
    const a = chainFor("a", 10);
    // 창에 뒤쪽 4건만 담겼다 — 정상적인 상황이다.
    const deps = makeDeps({ checkpoints: [genesis], events: a.slice(6) });

    const r = await runCheckpointCycle(PROJECT, deps);

    expect(r.chainIssues).toEqual([]);
    expect(formatCycleNotice(r)).toBeNull();
  });

  it("정상 주기는 알림을 만들지 않는다 (건강한 앱의 로그를 늘리지 않는다)", async () => {
    const deps = makeDeps({ checkpoints: [genesis], events: chainFor("a", 3) });

    expect(
      formatCycleNotice(await runCheckpointCycle(PROJECT, deps)),
    ).toBeNull();
  });
});

describe("§11 실패 모드 — 던지지 않고 공백을 남긴다", () => {
  const genesis = buildGenesisCheckpoint(PROJECT, 1_000);

  it("체크포인트 조회 실패", async () => {
    const r = await runCheckpointCycle(
      PROJECT,
      makeDeps({ failLoadCheckpoints: "offline" }),
    );

    expect(r.error).toContain("offline");
    expect(r.written).toBeNull();
  });

  it("원장 조회 실패해도 던지지 않는다", async () => {
    const r = await runCheckpointCycle(
      PROJECT,
      makeDeps({ checkpoints: [genesis], failLoadEvents: "permission-denied" }),
    );

    expect(r.error).toContain("permission-denied");
    expect(r.written).toBeNull();
  });

  it("★쓰기 실패 시에도 그 주기에 관측된 이상은 결과에 남는다", async () => {
    const a = chainFor("a", 5);
    const holed = a.filter((e) => (e.event as SealedLedgerEvent).seq !== 2);
    const deps = makeDeps({
      checkpoints: [genesis],
      events: holed,
      failWrite: "quota exceeded",
    });

    const r = await runCheckpointCycle(PROJECT, deps);

    expect(r.written).toBeNull();
    expect(r.error).toContain("quota exceeded");
    // 봉인은 못 했지만 무엇을 봤는지는 잃지 않는다.
    expect(r.chainIssues.map((i) => i.kind)).toContain("broken-link");
  });
});
