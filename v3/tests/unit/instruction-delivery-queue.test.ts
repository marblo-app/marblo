// P5-2 회귀 가드 — "delivered 로 마킹됐는데 PTY 엔 안 들어간" 답변 유실.
//
// 진범: PtyManager.writeAndSubmit 은 실패를 throw 가 아니라 `false` 로 알린다
// (세션 없음 / 위험명령 차단 / CR 미등록). 옛 pending-instruction-listener 는
// 반환값을 보지 않고 try/catch 만 뒀기 때문에 catch 가 영원히 안 걸렸고,
// 실패가 성공처럼 로깅됐다. 아래 테스트는 그 실패 경로들을 직접 재현한다.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  InstructionDeliveryQueue,
  type InstructionDeliveryFailure,
  type InstructionDeliverySuccess,
} from "../../electron/instruction-delivery-queue";

const noSleep = async (): Promise<void> => {};

interface Harness {
  queue: InstructionDeliveryQueue;
  writes: Array<{ sessionId: string; text: string }>;
  failures: InstructionDeliveryFailure[];
  delivered: InstructionDeliverySuccess[];
  setPty: (agentId: string, sid: string | undefined) => void;
}

function harness(opts: {
  /** 시도별 writeAndSubmit 결과. 소진되면 마지막 값을 반복한다. */
  results: Array<boolean | "throw">;
  pty?: Record<string, string | undefined>;
  attemptsPerRound?: number;
  maxTotalAttempts?: number;
  maxBufferedPerAgent?: number;
}): Harness {
  const writes: Array<{ sessionId: string; text: string }> = [];
  const failures: InstructionDeliveryFailure[] = [];
  const delivered: InstructionDeliverySuccess[] = [];
  const ptys: Record<string, string | undefined> = { ...(opts.pty ?? {}) };
  let call = 0;

  const queue = new InstructionDeliveryQueue({
    writer: {
      writeAndSubmit: async (sessionId: string, text: string) => {
        writes.push({ sessionId, text });
        const r = opts.results[Math.min(call, opts.results.length - 1)];
        call++;
        if (r === "throw") throw new Error("pty write exploded");
        return r;
      },
    },
    resolvePty: (agentId) => ptys[agentId],
    onFailure: (f) => failures.push(f),
    onDelivered: (d) => delivered.push(d),
    attemptsPerRound: opts.attemptsPerRound ?? 3,
    maxTotalAttempts: opts.maxTotalAttempts ?? 9,
    maxBufferedPerAgent: opts.maxBufferedPerAgent ?? 50,
    retryDelayMs: 0,
    sleep: noSleep,
  });

  return {
    queue,
    writes,
    failures,
    delivered,
    setPty: (agentId, sid) => {
      ptys[agentId] = sid;
    },
  };
}

describe("InstructionDeliveryQueue — 주입 실패 관측", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("★writeAndSubmit 이 false 면 성공으로 치지 않는다 (유실 진범)", async () => {
    const h = harness({ results: [false], pty: { a1: "pty-1" } });

    const ok = await h.queue.deliver("a1", "doc-1", "답변 본문");

    expect(ok).toBe(false);
    expect(h.delivered).toHaveLength(0);
    // 라운드 안에서 3회 시도했고, 그 실패가 명시적으로 보고됐다.
    expect(h.writes).toHaveLength(3);
    expect(h.failures).toHaveLength(1);
    expect(h.failures[0]).toMatchObject({
      docId: "doc-1",
      agentId: "a1",
      permanent: false,
      attempts: 3,
    });
    // 원문이 실패 보고에 그대로 실려 수동 복구가 가능하다.
    expect(h.failures[0].message).toBe("답변 본문");
    // 아직 버려지지 않았다 — 재연결 때 재시도할 몫으로 남는다.
    expect(h.queue.pendingCount("a1")).toBe(1);
  });

  it("라운드 안에서 재시도해 성공하면 유실 없음", async () => {
    const h = harness({ results: [false, false, true], pty: { a1: "pty-1" } });

    const ok = await h.queue.deliver("a1", "doc-1", "hi");

    expect(ok).toBe(true);
    expect(h.writes).toHaveLength(3);
    expect(h.failures).toHaveLength(0);
    expect(h.delivered[0]).toMatchObject({ attempts: 3, recovered: false });
    expect(h.queue.pendingCount()).toBe(0);
  });

  it("writeAndSubmit 이 throw 해도 실패로 처리되고 큐가 죽지 않는다", async () => {
    const h = harness({ results: ["throw", true], pty: { a1: "pty-1" } });

    const ok = await h.queue.deliver("a1", "doc-1", "hi");

    expect(ok).toBe(true);
    expect(h.delivered[0].attempts).toBe(2);
  });

  it("★PTY 가 없으면 죽은 세션에 쓰지 않고, 새 PTY 가 붙으면 그리로 간다", async () => {
    // 전달 시점엔 에이전트가 재시작 중(PTY 없음) → 한 글자도 못 쓴다.
    const h = harness({ results: [true], pty: { a1: undefined } });

    const ok = await h.queue.deliver("a1", "doc-1", "재시작 중 도착한 답변");
    expect(ok).toBe(false);
    expect(h.writes).toHaveLength(0);
    expect(h.failures[0].reason).toContain("no PTY");

    // 재시작 완료 → 새 sid 로 attach. 캡처된 옛 sid 가 아니라 "지금의 PTY" 로 간다.
    h.setPty("a1", "pty-NEW");
    const flushed = await h.queue.flush("a1");

    expect(flushed).toBe(1);
    expect(h.writes).toEqual([
      { sessionId: "pty-NEW", text: "재시작 중 도착한 답변" },
    ]);
    expect(h.queue.pendingCount("a1")).toBe(0);
    expect(h.delivered[0]).toMatchObject({
      ptySessionId: "pty-NEW",
      recovered: true,
    });
  });

  it("flush 는 FIFO 순서를 지키고, 실패하면 순서를 보존한 채 멈춘다", async () => {
    const h = harness({ results: [false], pty: { a1: undefined } });
    await h.queue.deliver("a1", "d1", "first");
    await h.queue.deliver("a1", "d2", "second");
    expect(h.queue.pendingCount("a1")).toBe(2);

    // PTY 는 붙었지만 write 는 계속 거부 → 첫 건에서 라운드가 끊긴다.
    h.setPty("a1", "pty-1");
    const flushed = await h.queue.flush("a1");
    expect(flushed).toBe(0);
    expect(h.writes.every((w) => w.text === "first")).toBe(true);
    expect(h.queue.pendingCount("a1")).toBe(2);
  });

  it("누적 예산을 소진하면 permanent 실패로 명시 보고하고 큐에서 내린다", async () => {
    const h = harness({
      results: [false],
      pty: { a1: "pty-1" },
      attemptsPerRound: 2,
      maxTotalAttempts: 4,
    });

    await h.queue.deliver("a1", "doc-1", "본문");
    expect(h.failures.at(-1)?.permanent).toBe(false);

    await h.queue.flush("a1");

    const last = h.failures.at(-1);
    expect(last?.permanent).toBe(true);
    expect(last?.attempts).toBe(4);
    expect(last?.message).toBe("본문");
    // 무한 재시도로 남지 않는다 — 명시 보고 후 큐가 비워진다.
    expect(h.queue.pendingCount("a1")).toBe(0);
  });

  it("버퍼 용량을 넘으면 가장 오래된 것을 permanent 로 보고하고 버린다", async () => {
    const h = harness({
      results: [false],
      pty: { a1: undefined },
      maxBufferedPerAgent: 2,
    });

    await h.queue.deliver("a1", "d1", "one");
    await h.queue.deliver("a1", "d2", "two");
    await h.queue.deliver("a1", "d3", "three");

    expect(h.queue.pendingCount("a1")).toBe(2);
    const permanent = h.failures.filter((f) => f.permanent);
    expect(permanent).toHaveLength(1);
    expect(permanent[0]).toMatchObject({ docId: "d1", message: "one" });
    expect(permanent[0].reason).toContain("buffer overflow");
  });

  it("무회귀: 첫 시도에 성공하면 write 1회, 실패 보고 0", async () => {
    const h = harness({ results: [true], pty: { a1: "pty-1" } });

    const ok = await h.queue.deliver("a1", "doc-1", "instruction");

    expect(ok).toBe(true);
    expect(h.writes).toEqual([{ sessionId: "pty-1", text: "instruction" }]);
    expect(h.failures).toHaveLength(0);
    expect(h.delivered[0]).toMatchObject({ attempts: 1, recovered: false });
    expect(h.queue.pendingCount()).toBe(0);
  });

  it("동시 flush 는 재진입하지 않는다(중복 주입 0)", async () => {
    const h = harness({ results: [true], pty: { a1: undefined } });
    await h.queue.deliver("a1", "d1", "msg");
    h.setPty("a1", "pty-1");

    const [a, b] = await Promise.all([
      h.queue.flush("a1"),
      h.queue.flush("a1"),
    ]);

    expect(a + b).toBe(1);
    expect(h.writes).toHaveLength(1);
  });
});
