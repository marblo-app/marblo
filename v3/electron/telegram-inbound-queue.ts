/**
 * 텔레그램 인바운드 **내구 큐** — 사장님이 하신 말을 오케에 넣을 때까지 우리가
 * 들고 있는 자리 (티켓 nMpBzIMJmkSFqrrZfSKz).
 *
 * ── 왜 만들었나 ──────────────────────────────────────────────────────────
 * 종전에는 큐가 따로 없었다. 배달에 실패하면 텔레그램의 **오프셋을 안 올리는**
 * 것이 곧 큐였다. 그 설계에는 두 대가가 붙어 있었다.
 *
 *   head-of-line 차단  한 건이 막히면 오프셋이 안 움직이므로 뒤따르는 건이
 *                      전부 같이 선다. 실측(2026-09-05): 96862774 가 막힌 27분
 *                      동안 775·776 이 뒤에 줄 섰고 배달 기록은 계속 비어 있었다.
 *   24시간 시한        텔레그램은 미확인 update 를 무한정 보관하지 않는다.
 *                      "받아 두고 나중에 넣는다" 를 남의 서버 보관 정책에
 *                      맡기고 있었던 셈이다.
 *
 * ── ★핵심 순서 (이 파일의 존재 이유) ────────────────────────────────────
 * 큐를 두면 "받은 것을 어디에 두느냐" 가 바뀐다. 그래서 **쓰기 순서가 곧
 * 유실 여부**다. 규칙은 하나다:
 *
 *     디스크에 **원자적으로 넣은 뒤에만** 오프셋을 전진시킨다.
 *
 * 이 순서를 지키면 어느 시점에 죽어도 사본이 최소 한 곳에 있다 —
 * enqueue 전이면 텔레그램에, enqueue 후면 우리 파일에. 두 곳 다 없는 창이
 * 존재하지 않는다. 순서를 뒤집으면(오프셋 먼저) 그 창이 생기고, 거기서 죽으면
 * 사장님 메시지가 **진짜로** 사라진다.
 *
 * ── ★이 큐의 규율: 사람의 말이다 ────────────────────────────────────────
 * 형제 티켓의 전진 신호 큐(폐루프 깨우기)와 **정책이 정반대**라, 절대 한
 * 구현으로 합치지 않는다.
 *
 *   전진 신호       시스템 이벤트. 중복 억제해도 되고 여러 건을 하나로 합쳐도
 *                   된다 — 같은 이유로 열 번 깨울 필요가 없기 때문이다.
 *   ★인바운드      사람의 말. **유실 불가 · 순서 유지 · 합치기 금지.**
 *                   두 문장을 보내셨으면 두 문장 다, 보내신 순서로 들어가야
 *                   한다. 여기에 dedupe/coalesce 를 들이면 사장님 말이 조용히
 *                   합쳐지거나 버려진다.
 *
 * 그래서 이 클래스에는 "합치기" API 가 없다. 있는 것은 넣기 · 맨 앞 보기 ·
 * 맨 앞 확인(ack) · 재시도 예약뿐이고, 순서는 `updateId` 오름차순으로 고정이다.
 * 같은 `updateId` 재삽입만 무시한다 — 그건 합치기가 아니라 **재배달 방지**다
 * (텔레그램이 같은 update 를 두 번 줄 수 있고, 그때 사장님 말이 두 번 들어가면
 * 그것도 사고다).
 *
 * I/O 는 `fs` 하나뿐이고 Electron 의존이 없다 —
 * `tests/unit/telegram-inbound-queue.test.ts` 가 임시 디렉터리로 그대로 돌린다.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** 큐에 든 인바운드 한 건. 텔레그램 update 하나에 1:1. */
export interface QueuedInbound {
  /** 텔레그램 update_id. 순서이자 신원이다. */
  updateId: number;
  /** 어느 대화에서 왔나(답장 기본 대상). */
  chatId: string;
  /** 사람이 읽을 발신자 표기. */
  from: string;
  /** ★사장님이 하신 말 원문. 자르지도 합치지도 않는다. */
  text: string;
  /** 텔레그램에서 받아 큐에 넣은 시각. */
  queuedAt: number;
  /** 주입을 시도한 횟수. */
  attempts: number;
  /** 마지막 시도 시각. 없으면 null. */
  lastAttemptAt: number | null;
  /** 이 시각 전에는 다시 시도하지 않는다(백오프). */
  nextAttemptAt: number;
  /** 마지막 실패 사유 한 줄(진단용). */
  lastError: string | null;
}

/** 사람이 보는 큐 상태. */
export interface InboundQueueSnapshot {
  /** 대기 중인 건수. */
  depth: number;
  /** 맨 앞 건의 update_id. 비었으면 null. */
  headUpdateId: number | null;
  /** 맨 앞 건이 기다린 시간(ms). 비었으면 null. */
  headWaitingMs: number | null;
  /** 맨 앞 건의 시도 횟수. */
  headAttempts: number;
  /** 가장 오래 기다린 건의 대기 시간(ms) = 맨 앞 건과 같다(순서 큐). */
  oldestWaitingMs: number | null;
  /** 맨 앞 건의 마지막 실패 사유. */
  headLastError: string | null;
}

export interface InboundQueueOptions {
  /** 저장 파일 경로. 기본 ~/.marblo/telegram-inbound-queue.json */
  filePath?: string;
  now?: () => number;
  logger?: Pick<Console, "log" | "warn" | "error">;
  /**
   * ★프로젝트당 보관 상한. 넘으면 **버리지 않고** 경고만 한다 — 사람의 말을
   * 조용히 버리는 것은 이 큐가 존재하는 이유와 정면으로 반대다. 상한은
   * "이만큼 쌓였으면 무언가 크게 잘못됐다" 는 경보선이지 절단선이 아니다.
   */
  warnDepth?: number;
}

const DEFAULT_FILE = path.join(
  os.homedir(),
  ".marblo",
  "telegram-inbound-queue.json",
);
const DEFAULT_WARN_DEPTH = 200;

type Persisted = Record<string, QueuedInbound[]>;

/**
 * 프로젝트별 FIFO. 디스크가 원본이고 메모리는 그 거울이다 — 모든 변경은
 * 즉시 원자적으로 파일에 반영된다(tmp + rename).
 */
export class TelegramInboundQueue {
  private readonly filePath: string;
  private readonly now: () => number;
  private readonly log: Pick<Console, "log" | "warn" | "error">;
  private readonly warnDepth: number;
  private queues: Persisted = {};

  constructor(opts: InboundQueueOptions = {}) {
    this.filePath = opts.filePath ?? DEFAULT_FILE;
    this.now = opts.now ?? (() => Date.now());
    this.log = opts.logger ?? console;
    this.warnDepth = opts.warnDepth ?? DEFAULT_WARN_DEPTH;
    this.load();
  }

  /**
   * 한 건을 큐 끝에 넣고 **디스크에 확정**한다.
   *
   * ★반환값이 계약이다: `true` 는 "디스크에 있다 — 이제 오프셋을 올려도
   * 안전하다", `false` 는 "확정하지 못했다 — 오프셋을 올리면 안 된다".
   * 호출부(`telegram-poller`)는 이 값으로 오프셋 전진을 가른다.
   *
   * 같은 `updateId` 가 이미 있으면 넣지 않고 `true` 를 준다 — 이미 우리 손에
   * 있으니 오프셋을 올려도 되고, 두 번 넣으면 사장님 말이 두 번 들어간다.
   */
  enqueue(
    projectId: string,
    entry: Omit<
      QueuedInbound,
      "attempts" | "lastAttemptAt" | "nextAttemptAt" | "lastError"
    >,
  ): boolean {
    const list = this.queues[projectId] ?? [];
    if (list.some((e) => e.updateId === entry.updateId)) return true;
    const next: QueuedInbound[] = [
      ...list,
      {
        ...entry,
        attempts: 0,
        lastAttemptAt: null,
        nextAttemptAt: 0,
        lastError: null,
      },
    ];
    // 순서는 update_id 오름차순으로 고정한다. 텔레그램이 순서대로 주지만,
    // 큐가 순서의 **원본**이 된 이상 그 보장을 남에게 맡기지 않는다.
    next.sort((a, b) => a.updateId - b.updateId);
    const before = this.queues[projectId];
    this.queues[projectId] = next;
    if (!this.persist()) {
      // 디스크에 못 넣었으면 메모리도 되돌린다 — "넣었다고 믿는데 파일에는
      // 없는" 상태가 가장 위험하다(재시작하면 사라지는데 오프셋은 올라간다).
      if (before) this.queues[projectId] = before;
      else delete this.queues[projectId];
      return false;
    }
    if (next.length >= this.warnDepth) {
      this.log.warn(
        `[TelegramInboundQueue] project=${projectId} depth=${next.length} ` +
          `(>= ${this.warnDepth}) — 주입이 오래 막혀 있다. 버리지 않고 계속 들고 있는다.`,
      );
    }
    return true;
  }

  /** 지금 배달을 시도해도 되는 맨 앞 건. 없거나 백오프 중이면 null. */
  nextReady(projectId: string): QueuedInbound | null {
    const head = this.head(projectId);
    if (!head) return null;
    return head.nextAttemptAt <= this.now() ? head : null;
  }

  /** 맨 앞 건(백오프 무시). 큐 상태를 읽는 용도. */
  head(projectId: string): QueuedInbound | null {
    const list = this.queues[projectId];
    return list && list.length > 0 ? { ...list[0] } : null;
  }

  /** 배달에 성공했다 — 큐에서 지운다. */
  ack(projectId: string, updateId: number): void {
    const list = this.queues[projectId];
    if (!list) return;
    const next = list.filter((e) => e.updateId !== updateId);
    if (next.length === list.length) return;
    if (next.length === 0) delete this.queues[projectId];
    else this.queues[projectId] = next;
    this.persist();
  }

  /**
   * 배달에 실패했다 — 시도 횟수를 올리고 다음 시도 시각을 미룬다.
   * ★큐에서 빼지 않는다. 이 큐에 "포기" 는 없다.
   */
  deferHead(
    projectId: string,
    delayMs: number,
    error: string | null,
  ): QueuedInbound | null {
    const list = this.queues[projectId];
    if (!list || list.length === 0) return null;
    const now = this.now();
    const head: QueuedInbound = {
      ...list[0],
      attempts: list[0].attempts + 1,
      lastAttemptAt: now,
      nextAttemptAt: now + Math.max(0, delayMs),
      lastError: error,
    };
    this.queues[projectId] = [head, ...list.slice(1)];
    this.persist();
    return { ...head };
  }

  /** 대기 건수. */
  depth(projectId: string): number {
    return this.queues[projectId]?.length ?? 0;
  }

  /** 큐가 비어 있지 않은 프로젝트들(재시작 후 드레인 재개용). */
  projectsWithWork(): string[] {
    return Object.keys(this.queues).filter((p) => this.depth(p) > 0);
  }

  /** 사람이 보는 상태. */
  snapshot(projectId: string): InboundQueueSnapshot {
    const head = this.head(projectId);
    const waited = head ? Math.max(0, this.now() - head.queuedAt) : null;
    return {
      depth: this.depth(projectId),
      headUpdateId: head?.updateId ?? null,
      headWaitingMs: waited,
      headAttempts: head?.attempts ?? 0,
      oldestWaitingMs: waited,
      headLastError: head?.lastError ?? null,
    };
  }

  /** 프로젝트가 비활성화됐다 — 큐도 지운다(채널을 끈 것은 사람의 결정이다). */
  forget(projectId: string): void {
    if (!(projectId in this.queues)) return;
    delete this.queues[projectId];
    this.persist();
  }

  // ── 지속화 ────────────────────────────────────────────────────────────

  private load(): void {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(this.filePath, "utf-8"),
      ) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return;
      const out: Persisted = {};
      for (const [projectId, v] of Object.entries(
        parsed as Record<string, unknown>,
      )) {
        if (!Array.isArray(v)) continue;
        const list = v.filter(isQueuedInbound);
        // 재시작 직후에는 백오프를 끌고 오지 않는다 — 앱이 꺼져 있던 시간이
        // 이미 충분한 대기다. 사장님이 자리를 비우신 사이 온 메시지가 재시작
        // 뒤에 몇 분을 더 기다릴 이유가 없다.
        for (const e of list) e.nextAttemptAt = 0;
        list.sort((a, b) => a.updateId - b.updateId);
        if (list.length > 0) out[projectId] = list;
      }
      this.queues = out;
      const total = Object.values(out).reduce((n, l) => n + l.length, 0);
      if (total > 0) {
        this.log.log(
          `[TelegramInboundQueue] restored ${total} queued inbound message(s) ` +
            `across ${Object.keys(out).length} project(s) from ${this.filePath}`,
        );
      }
    } catch {
      // 파일이 없거나 깨졌다 → 빈 큐로 시작한다. 텔레그램 오프셋이 아직 안
      // 올라간 건은 여전히 재배달되므로, 이 경로가 곧 전부 유실은 아니다.
      this.queues = {};
    }
  }

  /** 원자적 쓰기. 성공 여부를 돌려준다 — 호출부의 오프셋 전진이 여기 달렸다. */
  private persist(): boolean {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.queues, null, 2), "utf-8");
      fs.renameSync(tmp, this.filePath);
      return true;
    } catch (err) {
      this.log.warn(
        `[TelegramInboundQueue] persist failed (${this.filePath}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }
}

function isQueuedInbound(v: unknown): v is QueuedInbound {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.updateId === "number" &&
    typeof e.chatId === "string" &&
    typeof e.from === "string" &&
    typeof e.text === "string" &&
    typeof e.queuedAt === "number" &&
    typeof e.attempts === "number"
  );
}
