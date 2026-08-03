/**
 * 감사 원장 L3 — 해시 체인 + 머클 체크포인트 유닛 테스트.
 *
 * 티켓 완료기준의 **체인 유닛 4종**이 이 파일의 뼈대다(스펙 §6 표):
 *   ① 정상 검증 통과
 *   ② 중간 삭제 탐지        ─ 체인 단절
 *   ③ 변조 탐지             ─ 체인 단절
 *   ④ 체인 통째 삭제 탐지   ─ 체크포인트 불일치
 *
 * 여기에 설계가 명시한 성질을 함께 못박는다:
 *   - 체인 단위가 (projectId, agentId) 다 — 프로젝트 단일 체인 금지(§6)
 *   - 순서 권위는 createdAt 이 아니라 seq 다 — 시계 왜곡 내성(§11)
 *   - 봉인이 비차단이다 — 툴 호출을 동기적으로 막지 않는다(§6)
 *   - L1 스풀과 결합해도 seq 순서와 체인이 보존된다(티켓 완료기준)
 *   - 크래시로 체인이 끊기면 seq 구멍으로 **드러난다** — 유실을 숨기지 않는다(§11)
 *   - 제네시스 이전 기록은 미보증으로 **표기**된다 — 소급 보증 없음(§10)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import {
  ChainHeadStore,
  EMPTY_MERKLE_ROOT,
  GENESIS_PREV_HASH,
  LedgerChainSealer,
  buildCheckpoint,
  buildGenesisCheckpoint,
  canonicalize,
  chainKey,
  chainsMerkleRoot,
  computeEventHash,
  isSealed,
  mergeObservedHeads,
  merkleRoot,
  summarizeCoverage,
  verifyAllChains,
  verifyChain,
  verifyCheckpointAgainstHeads,
  verifyCheckpointChain,
  type ChainEntry,
  type ChainHead,
  type SealedLedgerEvent,
} from "../../electron/mcp-server/ledger-chain";
import {
  LedgerSpool,
  SPOOL_OVERFLOW_TOOL,
  type SpoolRecord,
} from "../../electron/mcp-server/ledger-spool";
import type { LedgerEventWrite } from "../../electron/mcp-server/ledger";

const PROJECT = "GFB8JnJrrX6AgahqmGB3";
const AGENT = "agent-a";

function evt(
  n: number,
  over: Partial<LedgerEventWrite> = {},
): LedgerEventWrite {
  return {
    projectId: PROJECT,
    agentId: AGENT,
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
    ...over,
  };
}

/** 봉인된 이벤트 n 건으로 이뤄진 정상 체인. */
function sealedChain(
  count: number,
  over: Partial<LedgerEventWrite> = {},
): { entries: ChainEntry[]; sealer: LedgerChainSealer } {
  const sealer = new LedgerChainSealer(AGENT);
  const entries: ChainEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = `doc-${over.agentId ?? AGENT}-${i}`;
    const occurredAtMs = 1_000_000 + i * 10;
    entries.push({
      id,
      occurredAtMs,
      event: sealer.seal(evt(i, over), { id, occurredAtMs }),
    });
  }
  return { entries, sealer };
}

const kinds = (v: { issues: Array<{ kind: string }> }): string[] =>
  v.issues.map((i) => i.kind);

// ═══════════════════════════════════════════════════════════════════
// ① 정상 — 검증 통과
// ═══════════════════════════════════════════════════════════════════

describe("① 정상 체인 — 검증을 통과한다", () => {
  it("봉인된 체인은 ok 이고 이슈가 없다", () => {
    const { entries } = sealedChain(5);
    const v = verifyChain(entries);

    expect(v.ok).toBe(true);
    expect(v.issues).toEqual([]);
    expect(v.checked).toBe(5);
    expect(v.preLedger).toBe(0);
  });

  it("seq 는 0 부터 연속이고 첫 이벤트의 prevHash 는 제네시스다", () => {
    const { entries } = sealedChain(3);
    const seqs = entries.map((e) => (e.event as SealedLedgerEvent).seq);

    expect(seqs).toEqual([0, 1, 2]);
    expect((entries[0].event as SealedLedgerEvent).prevHash).toBe(
      GENESIS_PREV_HASH,
    );
  });

  it("각 이벤트의 prevHash 가 앞 이벤트의 hash 와 같다 (실제로 이어져 있다)", () => {
    const { entries } = sealedChain(4);
    for (let i = 1; i < entries.length; i += 1) {
      expect((entries[i].event as SealedLedgerEvent).prevHash).toBe(
        (entries[i - 1].event as SealedLedgerEvent).hash,
      );
    }
  });

  it("★순서 권위는 createdAt 이 아니라 seq — 시각이 뒤죽박죽이어도 통과한다", () => {
    // §11 시계 왜곡: 시계를 되돌려 이벤트 순서를 뒤집으려는 시도는 seq 정렬 앞에서
    // 무력해야 한다. 입력 배열을 섞고 occurredAt 도 역순으로 준다.
    const sealer = new LedgerChainSealer(AGENT);
    const entries: ChainEntry[] = [];
    for (let i = 0; i < 5; i += 1) {
      const id = `doc-${i}`;
      // 시각이 뒤로 흐른다 — 시계 왜곡 재현.
      const occurredAtMs = 5_000_000 - i * 1_000;
      entries.push({
        id,
        occurredAtMs,
        event: sealer.seal(evt(i), { id, occurredAtMs }),
      });
    }
    const shuffled = [
      entries[3],
      entries[0],
      entries[4],
      entries[1],
      entries[2],
    ];

    expect(verifyChain(shuffled).ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// ② 중간 삭제 탐지
// ═══════════════════════════════════════════════════════════════════

describe("② 중간 삭제 — 체인 단절로 탐지된다", () => {
  it("가운데 이벤트를 지우면 broken-link 와 seq-gap 이 함께 잡힌다", () => {
    const { entries } = sealedChain(5);
    // seq 2 를 원장에서 삭제.
    const surviving = entries.filter(
      (e) => (e.event as SealedLedgerEvent).seq !== 2,
    );

    const v = verifyChain(surviving);

    expect(v.ok).toBe(false);
    expect(kinds(v)).toContain("seq-gap");
    expect(kinds(v)).toContain("broken-link");
    // 끊긴 자리는 삭제된 것의 **다음** 이벤트다.
    const link = v.issues.find((i) => i.kind === "broken-link");
    expect(link?.seq).toBe(3);
  });

  it("연속 여러 건을 지워도 구멍의 크기가 보고된다", () => {
    const { entries } = sealedChain(6);
    const surviving = entries.filter((e) => {
      const s = (e.event as SealedLedgerEvent).seq;
      return s < 1 || s > 3; // seq 1,2,3 삭제
    });

    const v = verifyChain(surviving);
    const gap = v.issues.find((i) => i.kind === "seq-gap");

    expect(v.ok).toBe(false);
    expect(gap?.detail).toContain("3건");
  });

  it("체인 앞부분을 통째로 잘라내면 missing-head 로 잡힌다", () => {
    const { entries } = sealedChain(5);
    const tail = entries.slice(2);

    const v = verifyChain(tail);

    expect(v.ok).toBe(false);
    expect(kinds(v)).toContain("missing-head");
  });

  it("★앞을 잘라내고 첫 이벤트로 위장해도 forged-genesis 로 잡힌다", () => {
    // 공격자가 seq 를 0 으로 고쳐 "이게 시작"이라고 주장하는 경우. prevHash 가
    // 제네시스가 아니므로 위장이 드러나고, 해시도 안 맞아 변조까지 잡힌다.
    const { entries } = sealedChain(5);
    const forged = entries.slice(2).map((e, i) => ({
      ...e,
      event: { ...(e.event as SealedLedgerEvent), seq: i },
    }));

    const v = verifyChain(forged);

    expect(v.ok).toBe(false);
    expect(kinds(v)).toContain("forged-genesis");
  });

  it("창(window)으로 잘라 읽은 구간은 expectFullChain:false 로 거짓 양성을 내지 않는다", () => {
    const { entries } = sealedChain(5);
    const window = entries.slice(2);

    const v = verifyChain(window, { expectFullChain: false });

    expect(v.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// ③ 변조 탐지
// ═══════════════════════════════════════════════════════════════════

describe("③ 변조 — 내용이 바뀌면 탐지된다", () => {
  it("본문(result)을 고치면 tampered 로 잡힌다", () => {
    const { entries } = sealedChain(4);
    const tampered = entries.map((e, i) =>
      i === 2
        ? {
            ...e,
            event: { ...(e.event as SealedLedgerEvent), result: "조작됨" },
          }
        : e,
    );

    const v = verifyChain(tampered);

    expect(v.ok).toBe(false);
    const issue = v.issues.find((i) => i.kind === "tampered");
    expect(issue?.seq).toBe(2);
  });

  it("★귀속 필드(actorUid)를 바꿔치기해도 잡힌다 — '누가 시켰나'가 감사의 핵심이다", () => {
    const { entries } = sealedChain(3);
    const tampered = entries.map((e, i) =>
      i === 1
        ? {
            ...e,
            event: {
              ...(e.event as SealedLedgerEvent),
              actorUid: "남의-uid",
            },
          }
        : e,
    );

    expect(kinds(verifyChain(tampered))).toContain("tampered");
  });

  it("★발생 시각(createdAt 의 근원)을 옮겨도 잡힌다", () => {
    const { entries } = sealedChain(3);
    const tampered = entries.map((e, i) =>
      i === 1 ? { ...e, occurredAtMs: e.occurredAtMs + 86_400_000 } : e,
    );

    expect(kinds(verifyChain(tampered))).toContain("tampered");
  });

  it("★문서 id 를 갈아끼워도 잡힌다", () => {
    const { entries } = sealedChain(3);
    const tampered = entries.map((e, i) =>
      i === 1 ? { ...e, id: "다른-문서" } : e,
    );

    expect(kinds(verifyChain(tampered))).toContain("tampered");
  });

  it("★해시까지 같이 고쳐 봉합해도 다음 이벤트의 prevHash 에서 끊긴다", () => {
    // 변조를 숨기려면 해시를 다시 계산해야 하는데, 그러면 뒤 이벤트의 prevHash 가
    // 안 맞는다. 뒤까지 전부 다시 계산하면 마지막 머리가 바뀌고, 그건 체크포인트가
    // 잡는다(④). 이 테스트는 그 사슬의 첫 고리다.
    const { entries } = sealedChain(4);
    const i = 1;
    const rewritten = {
      ...(entries[i].event as SealedLedgerEvent),
      result: "조작됨",
    };
    const resealed: SealedLedgerEvent = {
      ...rewritten,
      hash: computeEventHash(rewritten, {
        id: entries[i].id,
        occurredAtMs: entries[i].occurredAtMs,
        seq: rewritten.seq,
        prevHash: rewritten.prevHash,
      }),
    };
    const tampered = entries.map((e, idx) =>
      idx === i ? { ...e, event: resealed } : e,
    );

    const v = verifyChain(tampered);

    // 재봉인했으니 tampered 는 안 뜨지만, 연결이 끊긴다.
    expect(kinds(v)).not.toContain("tampered");
    expect(kinds(v)).toContain("broken-link");
    expect(v.ok).toBe(false);
  });

  it("params 의 키 순서만 다른 것은 변조가 아니다 (거짓 양성 방지)", () => {
    // Firestore 왕복에서 키 순서는 보존되지 않는다. 정규 직렬화가 이걸 흡수하지
    // 못하면 멀쩡한 원장이 통째로 "변조됨"으로 보고돼 도구 자체가 못 쓰게 된다.
    const sealer = new LedgerChainSealer(AGENT);
    const id = "doc-0";
    const occurredAtMs = 1_000;
    const original = sealer.seal(
      evt(0, { params: { a: 1, b: { x: 1, y: 2 }, c: [1, 2] } }),
      { id, occurredAtMs },
    );
    const reordered: SealedLedgerEvent = {
      ...original,
      params: { c: [1, 2], b: { y: 2, x: 1 }, a: 1 },
    };

    const v = verifyChain([{ id, occurredAtMs, event: reordered }]);

    expect(v.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// ④ 체인 통째 삭제 — 체크포인트가 탐지
// ═══════════════════════════════════════════════════════════════════

describe("④ 체인 통째 삭제 — 체크포인트 불일치로 탐지된다", () => {
  /** 에이전트 2기가 각자 체인을 굴리는 상황. */
  function twoChains(): {
    heads: ChainHead[];
    a: ChainEntry[];
    b: ChainEntry[];
  } {
    const a = sealedChain(3).entries;
    const b = sealedChain(4, { agentId: "agent-b" }).entries;
    const headOf = (entries: ChainEntry[]): ChainHead => {
      const last = entries[entries.length - 1].event as SealedLedgerEvent;
      return {
        projectId: last.projectId,
        agentId: last.agentId,
        seq: last.seq,
        hash: last.hash,
      };
    };
    return { heads: [headOf(a), headOf(b)], a, b };
  }

  it("★체인이 통째로 사라지면 체인 내부 검증은 아무것도 못 잡지만 체크포인트가 잡는다", () => {
    const { heads, a } = twoChains();
    const cp = buildCheckpoint({
      projectId: PROJECT,
      kind: "periodic",
      seqNo: 1,
      atMs: 2_000_000,
      chains: heads,
      prevCheckpointHash: buildGenesisCheckpoint(PROJECT, 1_000_000).hash,
    });

    // agent-b 의 이벤트를 원장에서 통째로 삭제 → 남은 것만 관측된다.
    const observedAfterDeletion = verifyAllChains(a).map((v) => v.head!);

    // 체인 내부 검증만으로는 멀쩡해 보인다 — 검증할 대상 자체가 사라졌기 때문이다.
    expect(verifyAllChains(a).every((v) => v.ok)).toBe(true);

    // 봉인된 명부와 대조하면 "있어야 할 것이 없다"가 드러난다.
    const verdict = verifyCheckpointAgainstHeads(cp, observedAfterDeletion);

    expect(verdict.ok).toBe(false);
    const missing = verdict.issues.find((i) => i.kind === "chain-missing");
    expect(missing?.agentId).toBe("agent-b");
    expect(missing?.detail).toContain("통째로 삭제");
  });

  it("체인 꼬리만 잘라도 chain-truncated 로 잡힌다", () => {
    const { heads, a } = twoChains();
    const cp = buildCheckpoint({
      projectId: PROJECT,
      kind: "periodic",
      seqNo: 1,
      atMs: 2_000_000,
      chains: heads,
      prevCheckpointHash: "prev",
    });

    // agent-a 의 마지막 1건만 삭제 → 머리가 뒤로 간다.
    const truncated = verifyChain(a.slice(0, -1)).head!;
    const observed = [truncated, heads[1]];

    const verdict = verifyCheckpointAgainstHeads(cp, observed);

    expect(verdict.ok).toBe(false);
    expect(kinds(verdict)).toContain("chain-truncated");
  });

  it("같은 자리를 다른 이벤트로 갈아끼우면 chain-diverged 로 잡힌다", () => {
    const { heads } = twoChains();
    const cp = buildCheckpoint({
      projectId: PROJECT,
      kind: "periodic",
      seqNo: 1,
      atMs: 2_000_000,
      chains: heads,
      prevCheckpointHash: "prev",
    });
    const swapped = [{ ...heads[0], hash: "sha256:다른해시" }, heads[1]];

    const verdict = verifyCheckpointAgainstHeads(cp, swapped);

    expect(verdict.ok).toBe(false);
    expect(kinds(verdict)).toContain("chain-diverged");
  });

  it("모든 체인이 그대로면 체크포인트 대조가 통과한다", () => {
    const { heads } = twoChains();
    const cp = buildCheckpoint({
      projectId: PROJECT,
      kind: "periodic",
      seqNo: 1,
      atMs: 2_000_000,
      chains: heads,
      prevCheckpointHash: "prev",
    });

    expect(verifyCheckpointAgainstHeads(cp, heads).ok).toBe(true);
  });

  it("체크포인트 자체를 고치면 checkpoint-tampered 로 잡힌다", () => {
    const { heads } = twoChains();
    const cp = buildCheckpoint({
      projectId: PROJECT,
      kind: "periodic",
      seqNo: 1,
      atMs: 2_000_000,
      chains: heads,
      prevCheckpointHash: "prev",
    });
    // 명부에서 한 체인을 빼서 삭제를 정당화하려는 시도.
    const doctored = { ...cp, chains: [heads[0]] };

    const verdict = verifyCheckpointAgainstHeads(doctored, [heads[0]]);

    expect(verdict.ok).toBe(false);
    expect(kinds(verdict)).toContain("checkpoint-tampered");
  });

  it("★체크포인트를 지우면 체크포인트 체인이 끊겨 드러난다", () => {
    // 체인과 그 체인을 담은 체크포인트를 **함께** 지우는 공격. 체크포인트끼리도
    // 이어 뒀기 때문에 지운 사실이 다음 장의 불일치로 남는다.
    const g = buildGenesisCheckpoint(PROJECT, 1_000);
    const c1 = buildCheckpoint({
      projectId: PROJECT,
      kind: "periodic",
      seqNo: 1,
      atMs: 2_000,
      chains: [],
      prevCheckpointHash: g.hash,
    });
    const c2 = buildCheckpoint({
      projectId: PROJECT,
      kind: "periodic",
      seqNo: 2,
      atMs: 3_000,
      chains: [],
      prevCheckpointHash: c1.hash,
    });

    expect(verifyCheckpointChain([g, c1, c2]).ok).toBe(true);

    const verdict = verifyCheckpointChain([g, c2]); // c1 삭제

    expect(verdict.ok).toBe(false);
    expect(kinds(verdict)).toContain("checkpoint-gap");
    expect(kinds(verdict)).toContain("checkpoint-broken-link");
  });

  it("제네시스 체크포인트가 없으면 checkpoint-gap 으로 드러난다", () => {
    const c1 = buildCheckpoint({
      projectId: PROJECT,
      kind: "periodic",
      seqNo: 1,
      atMs: 2_000,
      chains: [],
      prevCheckpointHash: "whatever",
    });

    expect(kinds(verifyCheckpointChain([c1]))).toContain("checkpoint-gap");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 체인 단위 = (projectId, agentId) — 프로젝트 단일 체인 금지 (§6)
// ═══════════════════════════════════════════════════════════════════

describe("체인 단위 — 에이전트별로 독립이다 (프로젝트 단일 체인 금지)", () => {
  it("에이전트가 다르면 seq 가 서로 독립적으로 0 부터 흐른다", () => {
    const sealer = new LedgerChainSealer("proc");
    const a = sealer.seal(evt(1, { agentId: "a" }), {
      id: "1",
      occurredAtMs: 1,
    });
    const b = sealer.seal(evt(2, { agentId: "b" }), {
      id: "2",
      occurredAtMs: 2,
    });
    const a2 = sealer.seal(evt(3, { agentId: "a" }), {
      id: "3",
      occurredAtMs: 3,
    });

    expect(a.seq).toBe(0);
    expect(b.seq).toBe(0); // ★프로젝트 단일 체인이었다면 1 이었을 것
    expect(a2.seq).toBe(1);
    expect(a2.prevHash).toBe(a.hash); // b 를 건너뛰고 a 에 이어진다
  });

  it("한 프로세스가 여러 projectId 를 내도 체인이 섞이지 않는다", () => {
    const sealer = new LedgerChainSealer("proc");
    const p1 = sealer.seal(evt(1, { projectId: "P1" }), {
      id: "1",
      occurredAtMs: 1,
    });
    const p2 = sealer.seal(evt(2, { projectId: "P2" }), {
      id: "2",
      occurredAtMs: 2,
    });

    expect(p1.seq).toBe(0);
    expect(p2.seq).toBe(0);
    expect(sealer.heads()).toHaveLength(2);
  });

  it("★에이전트 여러 기를 섞어 봉인해도 각 체인이 개별적으로 검증을 통과한다", () => {
    // 라이브에서 에이전트 5기가 동시에 도는 상황의 코드 대응물. 봉인은 잠금 없이
    // 인메모리 연산 하나로 끝나므로 경합이 발생할 구조 자체가 없다.
    const sealer = new LedgerChainSealer("proc");
    const agents = ["a", "b", "c", "d", "e"];
    const entries: ChainEntry[] = [];
    for (let round = 0; round < 20; round += 1) {
      for (const ag of agents) {
        const id = `${ag}-${round}`;
        const occurredAtMs = 1_000 + round;
        entries.push({
          id,
          occurredAtMs,
          event: sealer.seal(evt(round, { agentId: ag }), { id, occurredAtMs }),
        });
      }
    }

    const verdicts = verifyAllChains(entries);

    expect(verdicts).toHaveLength(5);
    expect(verdicts.every((v) => v.ok)).toBe(true);
    expect(verdicts.every((v) => v.checked === 20)).toBe(true);
  });

  it("chainKey 는 구분자가 섞인 id 에도 두 체인을 뭉치지 않는다", () => {
    expect(chainKey("a", "b:c")).not.toBe(chainKey("a:b", "c"));
  });
});

// ═══════════════════════════════════════════════════════════════════
// 봉인기 — 비차단 + 재기동 연속성
// ═══════════════════════════════════════════════════════════════════

describe("봉인기 — 비차단이고 재기동에 이어진다", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "marblo-chain-test-"));
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("★seal 은 동기 함수다 — 프로미스를 돌려주지 않는다(툴 호출을 막지 않는다)", () => {
    const sealer = new LedgerChainSealer(AGENT);
    const out = sealer.seal(evt(1), { id: "1", occurredAtMs: 1 });

    expect(out).not.toBeInstanceOf(Promise);
    expect(typeof out.hash).toBe("string");
  });

  it("재기동 시 이전 머리를 이어받아 seq 가 연속된다", async () => {
    const store = new ChainHeadStore(dir, AGENT);
    const first = new LedgerChainSealer(AGENT);
    for (let i = 0; i < 3; i += 1) {
      first.seal(evt(i), { id: `a-${i}`, occurredAtMs: i });
    }
    store.save(first.snapshot());
    await store.settled();

    // 프로세스 재기동.
    const second = new LedgerChainSealer(AGENT);
    const restored = second.restoreFrom(await store.load());
    const next = second.seal(evt(3), { id: "a-3", occurredAtMs: 3 });

    expect(restored).toBe(1);
    expect(next.seq).toBe(3); // 0 으로 되돌아가지 않는다
    expect(next.prevHash).toBe(first.heads()[0].hash);
  });

  it("★머리 파일이 없으면 seq 0 에서 다시 시작한다 — 그리고 그 불연속은 검증에서 드러난다", async () => {
    const store = new ChainHeadStore(dir, AGENT);
    const first = new LedgerChainSealer(AGENT);
    const entries: ChainEntry[] = [];
    for (let i = 0; i < 3; i += 1) {
      entries.push({
        id: `a-${i}`,
        occurredAtMs: i,
        event: first.seal(evt(i), { id: `a-${i}`, occurredAtMs: i }),
      });
    }

    // 머리를 저장하지 못한 채 크래시 → 새 프로세스는 이어받을 것이 없다.
    const second = new LedgerChainSealer(AGENT);
    expect(second.restoreFrom(await store.load())).toBe(0);
    entries.push({
      id: "a-3",
      occurredAtMs: 3,
      event: second.seal(evt(3), { id: "a-3", occurredAtMs: 3 }),
    });

    // 원장에는 seq 0 이 두 벌 있다 — 조용히 지나가지 않고 duplicate-seq 로 잡힌다.
    const v = verifyChain(entries);
    expect(v.ok).toBe(false);
    expect(kinds(v)).toContain("duplicate-seq");
  });

  it("손상된 머리 파일은 지우지 않고 .corrupt 로 격리한다 (증거 보존)", async () => {
    const store = new ChainHeadStore(dir, AGENT);
    await fs.writeFile(store.filePath, "{ 깨진 json", "utf8");

    expect(await store.load()).toBeNull();
    await expect(
      fs.access(`${store.filePath}.corrupt`),
    ).resolves.toBeUndefined();
  });

  it("reseal 은 자리를 옮기지 않고 해시만 다시 계산한다", () => {
    const sealer = new LedgerChainSealer(AGENT);
    const first = sealer.seal(evt(1), { id: "1", occurredAtMs: 1 });
    const updated = sealer.reseal(
      { ...first, result: "갱신된 내용" },
      { id: "1", occurredAtMs: 1, seq: first.seq, prevHash: first.prevHash },
    );

    expect(updated.seq).toBe(first.seq);
    expect(updated.prevHash).toBe(first.prevHash);
    expect(updated.hash).not.toBe(first.hash);
    // 머리도 같이 갱신돼 다음 이벤트가 올바르게 이어진다.
    const next = sealer.seal(evt(2), { id: "2", occurredAtMs: 2 });
    expect(next.prevHash).toBe(updated.hash);
  });
});

// ═══════════════════════════════════════════════════════════════════
// L1 스풀과의 결합 (티켓 완료기준)
// ═══════════════════════════════════════════════════════════════════

describe("L1 스풀 결합 — 오프라인 적재 후 복구해도 seq 순서와 체인이 보존된다", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "marblo-chain-spool-"));
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });

  function harness(overrides: Record<string, unknown> = {}) {
    const written: SpoolRecord[] = [];
    const state = { fail: false };
    const pending: Array<() => void> = [];
    let n = 0;
    const sealer = new LedgerChainSealer(AGENT);
    const spool = new LedgerSpool({
      dir,
      agentId: AGENT,
      sink: async (rec) => {
        if (state.fail) throw new Error("network offline");
        written.push(rec);
      },
      now: () => 1_000_000 + n * 10,
      newId: () => `id-${++n}`,
      schedule: (fn) => {
        pending.push(fn);
      },
      seal: (event, meta) =>
        typeof meta.seq === "number"
          ? sealer.reseal(event, {
              id: meta.id,
              occurredAtMs: meta.occurredAtMs,
              seq: meta.seq,
              prevHash: meta.prevHash ?? GENESIS_PREV_HASH,
            })
          : sealer.seal(event, {
              id: meta.id,
              occurredAtMs: meta.occurredAtMs,
            }),
      ...overrides,
    });
    const fire = () => {
      const batch = pending.splice(0, pending.length);
      for (const fn of batch) fn();
    };
    return { spool, written, state, fire, sealer };
  }

  const toEntries = (written: SpoolRecord[]): ChainEntry[] =>
    written.map((r) => ({
      id: r.id,
      occurredAtMs: r.occurredAtMs,
      event: r.event,
    }));

  it("★enqueue 는 봉인기를 꽂아도 여전히 동기다 (비차단 성질 유지)", () => {
    const { spool } = harness();
    const id = spool.enqueue(evt(1));

    expect(typeof id).toBe("string");
    expect(spool.status().pending).toBe(1); // 아직 sink 가 돌지 않았다
  });

  it("정상 경로에서 적재된 것들이 온전한 체인을 이룬다", async () => {
    const { spool, written } = harness();
    for (let i = 0; i < 5; i += 1) spool.enqueue(evt(i));
    await spool.settled();

    const v = verifyChain(toEntries(written));

    expect(written).toHaveLength(5);
    expect(v.ok).toBe(true);
    expect(v.checked).toBe(5);
  });

  it("★오프라인 구간을 거쳐 복구돼도 seq 가 발생 순서대로다 (적재 순서가 아니다)", async () => {
    const { spool, written, state, fire } = harness();

    spool.enqueue(evt(0));
    await spool.settled();

    // 단절: 3건이 스풀에 쌓인다.
    state.fail = true;
    spool.enqueue(evt(1));
    await spool.settled();
    spool.enqueue(evt(2));
    spool.enqueue(evt(3));
    await spool.settled();
    expect(spool.status().pending).toBe(3);

    // 복구.
    state.fail = false;
    fire();
    await spool.settled();

    const seqs = written.map((r) => (r.event as SealedLedgerEvent).seq);
    expect(seqs).toEqual([0, 1, 2, 3]);
    expect(verifyChain(toEntries(written)).ok).toBe(true);
  });

  it("★프로세스가 죽었다 살아나도 (스풀 restore) 체인이 이어진다", async () => {
    const first = harness();
    first.spool.enqueue(evt(0));
    await first.spool.settled();
    first.state.fail = true;
    first.spool.enqueue(evt(1));
    first.spool.enqueue(evt(2));
    await first.spool.settled();
    // 디스크에 스풀이 남았다.
    await expect(fs.access(first.spool.spoolPath)).resolves.toBeUndefined();

    // 새 프로세스: 체인 머리를 이어받고 스풀을 복원한다.
    const store = new ChainHeadStore(dir, AGENT);
    store.save(first.sealer.snapshot());
    await store.settled();

    const revived = harness();
    revived.sealer.restoreFrom(await store.load());
    await revived.spool.restore();
    await revived.spool.settled();
    // 재기동 후 발생한 새 이벤트.
    revived.spool.enqueue(evt(3));
    await revived.spool.settled();

    const all = toEntries([...first.written, ...revived.written]);
    const v = verifyChain(all);

    expect(v.ok).toBe(true);
    expect(all.map((e) => (e.event as SealedLedgerEvent).seq)).toEqual([
      0, 1, 2, 3,
    ]);
  });

  it("★상한 초과로 버려진 구간은 seq 구멍으로 드러난다 — 유실을 숨기지 않는다", async () => {
    const { spool, written, state, fire } = harness({ maxRecords: 3 });

    state.fail = true;
    for (let i = 0; i < 6; i += 1) spool.enqueue(evt(i));
    await spool.settled();
    expect(spool.status().droppedCount).toBeGreaterThan(0);

    state.fail = false;
    fire();
    await spool.settled();

    const v = verifyChain(toEntries(written));

    // 버려진 이벤트 자리가 구멍으로 남는다. "일어나지 않았다"가 아니라
    // "기록이 없다"를 말할 수 있는 상태다.
    expect(v.ok).toBe(false);
    expect(kinds(v)).toContain("seq-gap");
    // 그리고 그 공백은 tombstone 으로도 원장에 남는다(L1).
    expect(written.some((r) => r.event.toolName === SPOOL_OVERFLOW_TOOL)).toBe(
      true,
    );
  });

  it("★오버플로 tombstone 은 내용이 갱신돼도 해시가 내용과 일치한다 (거짓 변조 방지)", async () => {
    const { spool, written, state, fire } = harness({ maxRecords: 3 });

    state.fail = true;
    // 두 차례 상한을 넘겨 tombstone 이 병합(내용 갱신)되게 한다.
    for (let i = 0; i < 8; i += 1) spool.enqueue(evt(i));
    await spool.settled();
    state.fail = false;
    fire();
    await spool.settled();

    const tomb = written.find((r) => r.event.toolName === SPOOL_OVERFLOW_TOOL)!;
    const recomputed = computeEventHash(tomb.event, {
      id: tomb.id,
      occurredAtMs: tomb.occurredAtMs,
      seq: (tomb.event as SealedLedgerEvent).seq,
      prevHash: (tomb.event as SealedLedgerEvent).prevHash,
    });

    expect(recomputed).toBe((tomb.event as SealedLedgerEvent).hash);
  });

  it("재시도해도 봉인은 1회 — 페이로드가 결정적으로 동일하다 (멱등 재시도 유지)", async () => {
    const { spool, written, state, fire } = harness();

    state.fail = true;
    spool.enqueue(evt(1));
    await spool.settled();
    state.fail = false;
    fire();
    await spool.settled();
    fire();
    await spool.settled();

    // 같은 문서가 두 번 쓰여도 내용이 완전히 같아야 룰의
    // `request.resource.data == resource.data` 를 통과한다.
    expect(written).toHaveLength(1);
    const e = written[0].event as SealedLedgerEvent;
    expect(e.seq).toBe(0);
    expect(e.prevHash).toBe(GENESIS_PREV_HASH);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 머클 루트
// ═══════════════════════════════════════════════════════════════════

describe("머클 루트", () => {
  const head = (agentId: string, seq: number, hash: string): ChainHead => ({
    projectId: PROJECT,
    agentId,
    seq,
    hash,
  });

  it("빈 집합은 고정된 빈 루트를 낸다", () => {
    expect(chainsMerkleRoot([])).toBe(EMPTY_MERKLE_ROOT);
  });

  it("★관측 순서가 달라도 같은 집합이면 같은 루트다 (거짓 불일치 방지)", () => {
    const a = head("a", 1, "h1");
    const b = head("b", 2, "h2");
    const c = head("c", 3, "h3");

    expect(chainsMerkleRoot([a, b, c])).toBe(chainsMerkleRoot([c, a, b]));
  });

  it("머리 하나만 바뀌어도 루트가 바뀐다", () => {
    const before = [head("a", 1, "h1"), head("b", 2, "h2")];
    const after = [head("a", 1, "h1"), head("b", 2, "h2-변조")];

    expect(chainsMerkleRoot(before)).not.toBe(chainsMerkleRoot(after));
  });

  it("체인이 하나 빠지면 루트가 바뀐다 (통째 삭제 탐지의 근거)", () => {
    const full = [head("a", 1, "h1"), head("b", 2, "h2"), head("c", 3, "h3")];

    expect(chainsMerkleRoot(full)).not.toBe(chainsMerkleRoot(full.slice(0, 2)));
  });

  it("홀수 개도 처리한다", () => {
    expect(merkleRoot(["l1", "l2", "l3"])).toMatch(/^sha256:/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 명부 이월 (조용해진 체인이 명부에서 빠지지 않아야 한다)
// ═══════════════════════════════════════════════════════════════════

describe("mergeObservedHeads — 조용해진 체인을 명부에서 떨어뜨리지 않는다", () => {
  const h = (agentId: string, seq: number, hash: string): ChainHead => ({
    projectId: PROJECT,
    agentId,
    seq,
    hash,
  });

  it("이번 주기에 관측되지 않은 체인도 명부에 남는다", () => {
    const { heads } = mergeObservedHeads(
      [h("a", 5, "ha"), h("b", 3, "hb")],
      [h("a", 7, "ha7")], // b 는 조용했다
    );

    expect(heads.map((x) => x.agentId).sort()).toEqual(["a", "b"]);
    expect(heads.find((x) => x.agentId === "a")?.seq).toBe(7);
  });

  it("★뒤로 간 머리는 덮어쓰지 않는다 — 잘림을 새 체크포인트에 박제하지 않는다", () => {
    const { heads, issues } = mergeObservedHeads(
      [h("a", 5, "ha5")],
      [h("a", 2, "ha2")],
    );

    expect(heads[0].seq).toBe(5); // 앞선 값 유지
    expect(issues.map((i) => i.kind)).toContain("chain-truncated");
  });

  it("같은 seq 인데 hash 가 다르면 갈아끼움으로 보고하고 앞선 값을 유지한다", () => {
    const { heads, issues } = mergeObservedHeads(
      [h("a", 5, "ha5")],
      [h("a", 5, "다른해시")],
    );

    expect(heads[0].hash).toBe("ha5");
    expect(issues.map((i) => i.kind)).toContain("chain-diverged");
  });

  it("새 체인은 그대로 들어온다", () => {
    const { heads, issues } = mergeObservedHeads([], [h("z", 0, "hz")]);

    expect(heads).toHaveLength(1);
    expect(issues).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// §10 소급 보증 포기 — 미보증 구간 표기
// ═══════════════════════════════════════════════════════════════════

describe("§10 마이그레이션 — 소급 보증을 하지 않고 경계를 명시한다", () => {
  it("체인이 없는 기존 기록은 preLedger 로 분리 집계된다 (실패가 아니다)", () => {
    const { entries } = sealedChain(3);
    const legacy: ChainEntry = {
      id: "old-1",
      occurredAtMs: 1,
      event: evt(99), // 체인 필드 없음 = 제네시스 이전 기록
    };

    const v = verifyChain([legacy, ...entries]);

    expect(v.ok).toBe(true); // 미보증이지 위반이 아니다
    expect(v.preLedger).toBe(1);
    expect(v.checked).toBe(3);
  });

  it("isSealed 는 체인 필드 유무로 보증 여부를 가른다", () => {
    const { entries } = sealedChain(1);

    expect(isSealed(entries[0].event)).toBe(true);
    expect(isSealed(evt(1))).toBe(false);
  });

  it("★리포트가 미보증 구간을 숨기지 않는다", () => {
    const { entries } = sealedChain(2);
    const legacy: ChainEntry = { id: "old", occurredAtMs: 1, event: evt(9) };

    const cov = summarizeCoverage([legacy, ...entries], 1_700_000_000_000);

    expect(cov.sealed).toBe(2);
    expect(cov.preLedger).toBe(1);
    expect(cov.summary).toContain("판정할 수 없습니다");
    expect(cov.summary).toContain("소급 보증은 하지 않습니다");
  });

  it("제네시스가 없으면 원장 전체가 미보증이라고 말한다", () => {
    const cov = summarizeCoverage([], null);

    expect(cov.guaranteedFromMs).toBeNull();
    expect(cov.summary).toContain("무결성 미보증");
  });

  it("제네시스 체크포인트는 빈 명부와 seqNo 0 으로 시작한다", () => {
    const g = buildGenesisCheckpoint(PROJECT, 12_345);

    expect(g.kind).toBe("genesis");
    expect(g.seqNo).toBe(0);
    expect(g.chains).toEqual([]);
    expect(g.merkleRoot).toBe(EMPTY_MERKLE_ROOT);
    expect(verifyCheckpointChain([g]).ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 정규 직렬화
// ═══════════════════════════════════════════════════════════════════

describe("canonicalize — 해시 입력의 결정성", () => {
  it("키 순서가 달라도 같은 문자열을 낸다", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it("중첩 객체도 재귀적으로 정렬한다", () => {
    expect(canonicalize({ x: { q: 1, p: 2 } })).toBe(
      canonicalize({ x: { p: 2, q: 1 } }),
    );
  });

  it("배열 순서는 의미가 있으므로 보존한다", () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  it("undefined 는 생략한다 (Firestore 와 같은 취급)", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe(canonicalize({ a: 1 }));
  });

  it("★비유한 수는 거부한다 — JSON 왕복에서 null 로 뭉개져 해시가 충돌한다", () => {
    expect(() => canonicalize({ a: NaN })).toThrow(/비유한 수/);
    expect(() => canonicalize({ a: Infinity })).toThrow(/비유한 수/);
  });

  it("직렬화 불가 타입은 조용히 통과시키지 않는다", () => {
    expect(() => canonicalize({ fn: () => 1 })).toThrow(/직렬화 불가/);
  });
});
