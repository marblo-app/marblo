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
 * ── 보류(deferral) — 티켓 RtyOMpOArfI7a5JNSzsg ─────────────────────────────
 * 위 4단계는 전부 "썼는데 실패했다" 를 다룬다. 그런데 **일부러 쓰지 않는** 경우가
 * 생겼다: 대상 컴포저에 남의 초안이 물려 있거나([y/n]) 확인 다이얼로그 앞이면,
 * 지금 쓰는 것은 전달이 아니라 오염이다(#1160 S2·S5). 그때는 **보류**한다.
 *
 * 보류는 실패한 시도가 **아니다.** 그래서 시도 예산(`maxTotalAttempts`)을 태우지
 * 않는다 — 태우면 남의 초안이 조금 오래 남아 있다는 이유만으로 답이 영구 폐기된다.
 * 대신 별도 예산(`maxDeferrals`)을 쓰고, 다음 두 가지가 보장된다.
 *
 *   · **사유가 즉시 발신자에게 돌아간다** — 첫 보류에서 `onFailure` 를 부른다
 *     (`deferred` 필드로 구분). 조용히 큐에만 넣고 끝내지 않는다.
 *   · **컴포저가 비면 자동으로 되살아난다** — `PendingInstructionListener` 가
 *     `PtyManager.onComposerFree` 에 걸어 그 순간 `flush` 한다. 폴링 없음, 사람의
 *     개입 없음. 초안의 주인이 자기 손으로 엔터를 치는 그때가 재시도 시각이다.
 *
 * Firestore/Electron 의존이 없어 유닛 테스트로 실패 경로를 직접 재현할 수 있다.
 */

import type { ComposerRefusal, ComposerVerdict } from "./composer-gate";

/** PTY 로 한 턴을 제출하는 최소 계약 — `PtyManager.writeAndSubmit` 의 부분집합. */
export interface InstructionPtyWriter {
  writeAndSubmit(sessionId: string, text: string): Promise<boolean> | boolean;
  /**
   * 지금 이 세션에 써도 되는가(`PtyManager.composerVerdict`). 선택 항목이다 —
   * 안 주면 종전과 똑같이 그냥 쓴다(`writeAndSubmit` 안에도 같은 게이트가 있으므로
   * 오염이 새지는 않는다. 다만 사유가 `writeAndSubmit rejected` 로 뭉개지고 시도
   * 예산을 태운다). 주면 **쓰기 전에** 판정해 보류로 갈라낸다.
   */
  composerVerdict?(sessionId: string): ComposerVerdict;
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
  /**
   * ★쓰지 못한 게 아니라 **일부러 쓰지 않았다**(티켓 RtyOMpOArfI7a5JNSzsg).
   * 컴포저에 남의 초안이 있거나 확인 다이얼로그 앞이라 보류했다는 뜻이고,
   * 컴포저가 비는 순간 자동으로 재시도된다. 발신자에게 "실패했다" 가 아니라
   * "아직 안 보냈다, 왜냐하면 …" 으로 전해야 하는 경우다.
   */
  deferred?: ComposerRefusal;
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
  /**
   * 보류 예산(티켓 RtyOMpOArfI7a5JNSzsg). 컴포저가 계속 오염돼 있어 이 횟수만큼
   * 쓰지 못하면 permanent 로 보고하고 버린다 — 무한히 조용히 들고 있지 않는다.
   * 시도 예산과 **따로** 두는 이유는 위 헤더 "보류" 절 참조. 기본 30.
   */
  maxDeferrals?: number;
  /** 테스트에서 시간을 건너뛰기 위한 주입점. */
  sleep?: (ms: number) => Promise<void>;
}

interface BufferedInstruction {
  docId: string;
  agentId: string;
  message: string;
  attempts: number;
  lastReason: string;
  /** 컴포저 오염으로 **쓰지 않은** 횟수. 시도 횟수와 섞지 않는다. */
  deferrals: number;
  /** 마지막 보류 사유. 보고에 실어 발신자가 왜 안 갔는지 알게 한다. */
  lastDeferral?: ComposerRefusal;
  /** 이 엔트리의 보류를 이미 한 번 알렸는가(같은 사유로 도배하지 않는다). */
  deferralReported: boolean;
}

const DEFAULTS = {
  attemptsPerRound: 3,
  maxTotalAttempts: 9,
  retryDelayMs: 500,
  maxBufferedPerAgent: 50,
  maxDeferrals: 30,
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
  private readonly maxDeferrals: number;
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
    this.maxDeferrals = opts.maxDeferrals ?? DEFAULTS.maxDeferrals;
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
      deferrals: 0,
      deferralReported: false,
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
          // 보류 예산도 여기서 본다 — flush 는 컴포저가 풀릴 때마다 도는데,
          // 매번 또 막히면(다른 초안이 바로 들어왔다) 무한히 들고 있게 된다.
          if (entry.deferrals >= this.maxDeferrals) {
            queue.shift();
            entry.lastReason = `${entry.lastReason} (보류 ${entry.deferrals}회 — 컴포저가 끝내 비지 않았다)`;
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
          ...(e.lastDeferral ? { deferred: e.lastDeferral } : {}),
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
      } else if (!this.writable(ptySessionId, entry)) {
        // ★일부러 쓰지 않았다. 시도로 세지 않으므로 되돌린다 — 남의 초안이
        // 오래 남았다는 이유로 답이 폐기되면 안 된다(헤더 "보류" 절).
        entry.attempts--;
        return false;
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

  /**
   * 지금 이 PTY 에 써도 되는가. 안 되면 보류로 기록하고 false.
   *
   * 판정기가 없으면(선택 계약) 항상 true — 종전 동작 그대로다.
   * `indeterminate`(모르는 하네스)도 true 다: 모른다고 멈추면 이 게이트가
   * 유실의 새 원인이 된다(#1157·#1160 의 3분기 규율).
   */
  private writable(
    ptySessionId: string,
    entry: BufferedInstruction,
  ): boolean {
    const verdict = this.writer.composerVerdict?.(ptySessionId);
    if (!verdict || verdict.writable) return true;
    entry.deferrals++;
    entry.lastDeferral = verdict.refusal ?? undefined;
    entry.lastReason = `${verdict.refusal ?? "composer-blocked"}: ${verdict.reason}`;
    return false;
  }

  /** 라운드 실패분을 버퍼에 넣는다. 예산/용량을 넘기면 permanent 로 보고. */
  private bufferEntry(entry: BufferedInstruction): void {
    if (entry.attempts >= this.maxTotalAttempts) {
      this.reportFailure(entry, true);
      return;
    }
    // 보류 예산까지 소진했으면 더는 조용히 들고 있지 않는다.
    if (entry.deferrals >= this.maxDeferrals) {
      entry.lastReason =
        `${entry.lastReason} (보류 ${entry.deferrals}회 — 컴포저가 끝내 비지 않았다)`;
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
    // 보류는 **일부러 안 쓴 것**이라 실패와 구분해 싣는다. 다만 같은 사유를
    // 라운드마다 도배하지 않는다 — 영구 실패가 아닌 보류는 엔트리당 1회만.
    const deferred = entry.lastDeferral;
    if (deferred && !permanent) {
      if (entry.deferralReported) return;
      entry.deferralReported = true;
    }
    const failure: InstructionDeliveryFailure = {
      docId: entry.docId,
      agentId: entry.agentId,
      message: entry.message,
      attempts: entry.attempts,
      reason: entry.lastReason || "unknown",
      permanent,
      ...(deferred ? { deferred } : {}),
    };
    console.error(
      `[InstructionDeliveryQueue] PTY inject ${
        permanent
          ? "FAILED (giving up)"
          : deferred
            ? "DEFERRED (컴포저가 비면 자동 재시도)"
            : "failed (will retry on re-attach)"
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
