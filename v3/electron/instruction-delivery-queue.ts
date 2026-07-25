/**
 * PTY 주입 재시도 큐 — "delivered 로 마킹됐는데 실제로는 안 들어간" 유실을 막는다.
 *
 * ── 왜 필요한가 (P5-2, INTELLIGENT-ROUTING-PLAN §6 갭③) ──────────────────────
 * `pendingInstructions` 전달은 Firestore 트랜잭션으로 `isDelivered:true` 를 먼저
 * 찍어 교차-머신 once-only 를 보장한 뒤 PTY 로 주입한다. 그런데 주입 호출
 * (`PtyManager.writeAndSubmit`)은 **throw 하지 않는다** — 세션이 없거나(에이전트
 * 재시작/PTY 교체 중), 위험명령 정책에 막히거나, CR 이 끝내 안 먹히면 그냥
 * `false` 로 resolve 한다. 호출부가 이 반환값을 안 보고 try/catch 만 두면 실패가
 * 100% 은폐된다: 원장엔 delivered, 로그엔 "injected", 실제 답변은 증발.
 *
 * 이 큐는 그 구멍을 이렇게 막는다.
 *   1. 반환값을 **await 해서** 성공/실패를 판정한다(예외도 실패로 취급).
 *   2. 실패하면 즉시 유한 재시도한다. 재시도마다 **PTY 를 다시 해석**한다 —
 *      전달 대기 중 에이전트가 재시작해 sid 가 바뀌면 옛 sid 로 쓰는 순간
 *      영구 유실이므로(메모 injectmessage_expectpty_silent_drop 과 같은 함정),
 *      캡처된 sid 가 아니라 "지금의 PTY" 를 매번 묻는다.
 *   3. 그래도 실패하면 메시지를 **메모리에 보관**하고, 그 에이전트의 PTY 가
 *      다시 붙을 때(`flush`) 재주입한다. Firestore 재큐잉은 보안룰상 불가
 *      (firestore.rules 의 pendingInstructions update 는 isDelivered false→true
 *      1회 전이만 허용) — 그래서 재시도 상태는 프로세스 안에 산다.
 *   4. 총 시도 예산을 소진하면 **명시적으로 실패를 보고**한다(onFailure).
 *      조용히 사라지는 경로는 남기지 않는다.
 *
 * Firestore/Electron 의존이 없어 유닛 테스트로 실패 경로를 직접 재현할 수 있다.
 */

/** PTY 로 한 턴을 제출하는 최소 계약 — `PtyManager.writeAndSubmit` 의 부분집합. */
export interface InstructionPtyWriter {
  writeAndSubmit(sessionId: string, text: string): Promise<boolean> | boolean;
}

/** 전달을 포기(또는 한 라운드 실패)했을 때 보고되는 내역. */
export interface InstructionDeliveryFailure {
  /** pendingInstructions doc id. */
  docId: string;
  /** 주입 대상 에이전트 (`orch-<projectId>` 면 오케 PTY). */
  agentId: string;
  /** 유실되면 안 되는 원문. 보고에 전문을 실어 수동 복구가 가능하게 한다. */
  message: string;
  /** 지금까지 누적 시도 횟수. */
  attempts: number;
  /** 마지막 실패 사유. */
  reason: string;
  /**
   * true 면 이 큐는 더 이상 재시도하지 않는다(예산 소진/버퍼 초과) —
   * 사람이나 오케가 개입해야 한다. false 면 아직 버퍼에 남아 다음 attach 때
   * 재시도한다.
   */
  permanent: boolean;
}

export interface InstructionDeliverySuccess {
  docId: string;
  agentId: string;
  /** 성공까지 걸린 누적 시도 횟수(1 이면 첫 시도에 성공). */
  attempts: number;
  /** 실제로 주입된 PTY 세션 id. */
  ptySessionId: string;
  /** 이전 라운드 실패 후 버퍼에서 복구된 전달이면 true. */
  recovered: boolean;
}

export interface InstructionDeliveryQueueOptions {
  writer: InstructionPtyWriter;
  /** 지금 이 에이전트가 붙어 있는 PTY 세션 id. 없으면 undefined. */
  resolvePty: (agentId: string) => string | undefined;
  /** 전달 성공 훅(로깅/관측용). */
  onDelivered?: (result: InstructionDeliverySuccess) => void;
  /** ★실패 싱크. 지정하지 않아도 콘솔에는 남지만, 배선하는 쪽이 오케에 알린다. */
  onFailure?: (failure: InstructionDeliveryFailure) => void;
  /** 한 라운드(deliver 또는 flush 1회)에서의 최대 시도 횟수. 기본 3. */
  attemptsPerRound?: number;
  /** 누적 시도 예산. 넘으면 permanent 실패로 보고하고 버려진다. 기본 9. */
  maxTotalAttempts?: number;
  /** 라운드 내 재시도 간격(ms). 기본 500. */
  retryDelayMs?: number;
  /** 에이전트당 보관 가능한 미전달 메시지 수. 넘으면 가장 오래된 것부터 permanent 실패. 기본 50. */
  maxBufferedPerAgent?: number;
  /** 테스트에서 시간을 건너뛰기 위한 주입점. */
  sleep?: (ms: number) => Promise<void>;
}

interface BufferedInstruction {
  docId: string;
  agentId: string;
  message: string;
  attempts: number;
  lastReason: string;
}

const DEFAULTS = {
  attemptsPerRound: 3,
  maxTotalAttempts: 9,
  retryDelayMs: 500,
  maxBufferedPerAgent: 50,
};

export class InstructionDeliveryQueue {
  private readonly writer: InstructionPtyWriter;
  private readonly resolvePty: (agentId: string) => string | undefined;
  private readonly onDelivered?: (result: InstructionDeliverySuccess) => void;
  private readonly onFailure?: (failure: InstructionDeliveryFailure) => void;
  private readonly attemptsPerRound: number;
  private readonly maxTotalAttempts: number;
  private readonly retryDelayMs: number;
  private readonly maxBufferedPerAgent: number;
  private readonly sleep: (ms: number) => Promise<void>;

  /** agentId → 아직 PTY 에 못 넣은 지시들(FIFO). */
  private buffered: Map<string, BufferedInstruction[]> = new Map();
  /** flush 재진입 방지(같은 에이전트에 대해 동시에 두 번 흘리지 않는다). */
  private flushing: Set<string> = new Set();

  constructor(opts: InstructionDeliveryQueueOptions) {
    this.writer = opts.writer;
    this.resolvePty = opts.resolvePty;
    this.onDelivered = opts.onDelivered;
    this.onFailure = opts.onFailure;
    this.attemptsPerRound = opts.attemptsPerRound ?? DEFAULTS.attemptsPerRound;
    this.maxTotalAttempts = opts.maxTotalAttempts ?? DEFAULTS.maxTotalAttempts;
    this.retryDelayMs = opts.retryDelayMs ?? DEFAULTS.retryDelayMs;
    this.maxBufferedPerAgent =
      opts.maxBufferedPerAgent ?? DEFAULTS.maxBufferedPerAgent;
    this.sleep =
      opts.sleep ??
      ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * 지시 1건을 주입한다. 실패하면 버퍼에 남기고 `false` 를 반환한다 —
   * 호출부는 이 반환값으로 "전달됨" 로그를 낼지 말지 정해야 한다.
   */
  async deliver(
    agentId: string,
    docId: string,
    message: string,
  ): Promise<boolean> {
    const entry: BufferedInstruction = {
      agentId,
      docId,
      message,
      attempts: 0,
      lastReason: "",
    };
    const ok = await this.runRound(entry, false);
    if (!ok) this.bufferEntry(entry);
    return ok;
  }

  /**
   * 이 에이전트의 미전달 지시를 다시 주입한다. PTY 가 (재)연결될 때 호출한다 —
   * 에이전트 재시작 창에서 도착한 답변이 살아 돌아오는 경로다.
   */
  async flush(agentId: string): Promise<number> {
    if (this.flushing.has(agentId)) return 0;
    const queue = this.buffered.get(agentId);
    if (!queue || queue.length === 0) return 0;

    this.flushing.add(agentId);
    let delivered = 0;
    try {
      // 앞에서부터 순서대로. 하나가 실패하면 뒤엣것도 어차피 같은 PTY 라
      // 실패할 가능성이 높으므로 라운드를 끊는다(순서 보존 + 무의미한 소모 방지).
      while (queue.length > 0) {
        const entry = queue[0];
        const ok = await this.runRound(entry, true);
        if (!ok) {
          if (entry.attempts >= this.maxTotalAttempts) {
            queue.shift();
            this.reportFailure(entry, true);
            continue;
          }
          break;
        }
        queue.shift();
        delivered++;
      }
    } finally {
      if (queue.length === 0) this.buffered.delete(agentId);
      this.flushing.delete(agentId);
    }
    return delivered;
  }

  /** 미전달로 남아 있는 지시 수(전체 또는 특정 에이전트). 관측·테스트용. */
  pendingCount(agentId?: string): number {
    if (agentId !== undefined) return this.buffered.get(agentId)?.length ?? 0;
    let total = 0;
    for (const queue of this.buffered.values()) total += queue.length;
    return total;
  }

  /** 미전달 지시 요약(진단용). 원문 전체를 담는다 — 수동 복구에 필요하다. */
  pendingSummary(): InstructionDeliveryFailure[] {
    const out: InstructionDeliveryFailure[] = [];
    for (const queue of this.buffered.values()) {
      for (const e of queue) {
        out.push({
          docId: e.docId,
          agentId: e.agentId,
          message: e.message,
          attempts: e.attempts,
          reason: e.lastReason,
          permanent: false,
        });
      }
    }
    return out;
  }

  /**
   * 한 라운드 = 최대 `attemptsPerRound` 회 주입 시도. 시도마다 PTY 를 다시
   * 해석해 전달 대기 중 바뀐 세션을 따라간다.
   */
  private async runRound(
    entry: BufferedInstruction,
    recovered: boolean,
  ): Promise<boolean> {
    for (let i = 0; i < this.attemptsPerRound; i++) {
      if (entry.attempts >= this.maxTotalAttempts) break;
      entry.attempts++;

      // ★매 시도마다 재해석: 캡처해 둔 sid 로 쓰면 재시작한 에이전트의 새 PTY 를
      // 놓치고 죽은 세션에 계속 쓴다(=영구 유실).
      const ptySessionId = this.resolvePty(entry.agentId);
      if (!ptySessionId) {
        entry.lastReason = "no PTY attached for agent";
      } else {
        try {
          const ok = await this.writer.writeAndSubmit(
            ptySessionId,
            entry.message,
          );
          if (ok) {
            this.onDelivered?.({
              docId: entry.docId,
              agentId: entry.agentId,
              attempts: entry.attempts,
              ptySessionId,
              recovered,
            });
            return true;
          }
          // writeAndSubmit 이 throw 대신 false 로 실패를 알리는 경로 —
          // 이걸 무시한 것이 바로 유실 진범이었다.
          entry.lastReason = `writeAndSubmit rejected (pty=${ptySessionId})`;
        } catch (err) {
          entry.lastReason = `writeAndSubmit threw: ${
            err instanceof Error ? err.message : String(err)
          }`;
        }
      }

      const hasBudget =
        i < this.attemptsPerRound - 1 && entry.attempts < this.maxTotalAttempts;
      if (hasBudget && this.retryDelayMs > 0) {
        await this.sleep(this.retryDelayMs);
      }
    }
    return false;
  }

  /** 라운드 실패분을 버퍼에 넣는다. 예산/용량을 넘기면 permanent 로 보고. */
  private bufferEntry(entry: BufferedInstruction): void {
    if (entry.attempts >= this.maxTotalAttempts) {
      this.reportFailure(entry, true);
      return;
    }
    const queue = this.buffered.get(entry.agentId) ?? [];
    queue.push(entry);
    // 용량 초과분은 가장 오래된 것부터 버리되, 반드시 permanent 로 보고한다.
    while (queue.length > this.maxBufferedPerAgent) {
      const dropped = queue.shift();
      if (dropped) {
        dropped.lastReason = `buffer overflow (>${this.maxBufferedPerAgent} undelivered)`;
        this.reportFailure(dropped, true);
      }
    }
    this.buffered.set(entry.agentId, queue);
    this.reportFailure(entry, false);
  }

  private reportFailure(entry: BufferedInstruction, permanent: boolean): void {
    const failure: InstructionDeliveryFailure = {
      docId: entry.docId,
      agentId: entry.agentId,
      message: entry.message,
      attempts: entry.attempts,
      reason: entry.lastReason || "unknown",
      permanent,
    };
    console.error(
      `[InstructionDeliveryQueue] PTY inject ${
        permanent ? "FAILED (giving up)" : "failed (will retry on re-attach)"
      } doc=${entry.docId} agent=${entry.agentId} attempts=${
        entry.attempts
      } reason=${failure.reason}`,
    );
    try {
      this.onFailure?.(failure);
    } catch (err) {
      console.error(
        `[InstructionDeliveryQueue] onFailure hook threw: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
