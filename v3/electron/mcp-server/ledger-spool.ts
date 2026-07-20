/**
 * 감사 원장(ledger) L1 — 로컬 스풀 + 재시도 + 순서 보존 재적재.
 *
 * 설계 권위: docs/superpowers/specs/2026-07-19-team-governance-audit-ledger-design.md
 * (§7 조용한 유실 · §11 실패 모드 · §9 구현 순서)
 *
 * ## 이 파일이 존재하는 이유
 *
 * L0 이전의 `auditLog()` 는 이랬다:
 *
 *     addDoc(collection(db, "audit_logs"), {...})
 *       .catch(err => console.error("[Audit] Failed to write audit log:", err));
 *
 * 감사 기록 실패가 콘솔 한 줄로 삼켜진다. 활동 피드용으로는 괜찮지만 규제 원장으로는
 * 치명적이다 — 네트워크가 끊긴 30분 동안의 에이전트 행위가 흔적 없이 사라지고 그
 * 공백을 설명할 방법이 없다.
 *
 * ★목표를 한 문장으로: **"기록이 없다"와 "일어나지 않았다"를 구분할 수 있게 만드는
 * 것.** 이 파일의 모든 설계 판단이 이 한 문장에서 나온다. 유실 자체보다 유실을
 * 몰랐다는 게 감사에서 더 나쁘다.
 *
 * ## 순서 보존의 단위 — L3(체인)와의 정합
 *
 * 스풀은 **프로세스당 하나**이고 프로세스 내 **전역 순서(total order)** 를 보장한다.
 * L3 의 해시 체인 단위는 `(projectId, agentId)`(§6)인데, 한 프로세스가 여러
 * projectId 의 이벤트를 낼 수 있으므로(cross-project-create 계열 툴) 둘은 동치가
 * 아니라 **포함** 관계다: 프로세스 전역 순서가 보존되면 그 부분열인 각
 * `(projectId, agentId)` 체인의 순서도 자동으로 보존된다.
 *
 * → 스풀 순서는 체인 seq 의 **상위 보장**이다. L3 는 `seq` 를 **enqueue 시점**에
 * 매기기만 하면 된다. write 시점에 매기면 안 된다 — 스풀은 30분 뒤에 재적재될 수
 * 있어서 write 순서 ≠ 발생 순서다. `enqueue()` 가 이 프로세스의 단일 직렬화
 * 지점이고, 에이전트당 MCP 서버가 하나라 경합이 없다(§6). 스풀과 체인이 같은
 * 성질에서 나온 것이지 우연이 아니다.
 *
 * ## 비차단 성질 (요구사항)
 *
 * `enqueue()` 는 **동기**이고 아무것도 await 하지 않는다. 호출부(auditLog)는 여전히
 * fire-and-forget 이고 MCP 툴 호출을 막지 않는다. 정상 경로에서는 디스크를 아예
 * 건드리지 않는다 — 스풀 파일은 **쓰기가 실패했을 때만** 생긴다(§11 이 규정한 대로
 * 스풀은 실패 경로이지 write-ahead 로그가 아니다).
 *
 * ## ★라이브 실측으로 드러난 것 — 유실 기전이 스펙의 서술과 다르다
 *
 * 스펙 §7 은 "쓰기 실패가 `.catch` 의 console.error 한 줄로 삼켜진다"고 썼다. 실제
 * dist-mcp 번들을 띄워 Firestore 를 권한 거부(오프라인) 상태로 만들고 감사 대상 툴을
 * 호출해 보니 **catch 가 애초에 호출되지 않는다.**
 *
 * Firebase JS SDK 의 쓰기 프로미스는 백엔드 ack 까지 기다린다. 백엔드에 닿지
 * 못하면 SDK 는 오프라인 모드로 내려가 쓰기를 자기 큐에 쌓고 **프로미스는 영원히
 * settle 하지 않는다** — resolve 도 reject 도 안 한다. 실측:
 *
 *     PERMISSION_DENIED: Permission denied on resource project ...
 *     The client will operate in offline mode until it is able to connect.
 *     → setDoc 프로미스 미settle, [Audit] catch 0회, 에러 로그 0줄
 *
 * 그래서 기존 코드의 실패 모드는 "에러가 로그 한 줄로 삼켜진다"가 아니라 **"에러가
 * 아예 발생하지 않는다"** 였다. 콘솔이 조용한 게 정상이라서가 아니라 실패를 관측할
 * 지점이 없어서다. 게다가 이 MCP 서버는 Node 프로세스라 Firestore 캐시가
 * **메모리**다 — 프로세스가 죽으면 그 큐는 통째로 사라진다. §7 의 "네트워크 30분
 * 단절" 시나리오에서 기존 코드는 흔적을 하나도 남기지 못했다.
 *
 * → 그래서 sink 성공 판정에 **시간 상한**이 필수다(`requireServerAck`). 상한 안에
 * 백엔드가 확인하지 않으면 실패로 취급해 스풀에 남긴다. 상한이 없으면 배수 루프가
 * 첫 레코드에서 영원히 멈추고, 그게 정확히 기존 코드의 조용한 유실이다.
 *
 * 이때 SDK 큐에도 같은 쓰기가 남아 나중에 flush 될 수 있는데, 문서 id 가 로컬에서
 * 1회 생성돼 재시도마다 재사용되므로(SpoolRecord.id + setDoc) **SDK 의 뒤늦은
 * flush 와 우리의 재적재가 같은 문서를 가리켜 중복이 생기지 않는다.** 멱등 id
 * 결정이 여기서 값을 한다.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { LedgerEventWrite } from "./ledger.js";

// ── 파일 포맷 ────────────────────────────────────────────────────

export const SPOOL_FILE_VERSION = 1;

/**
 * 스풀에 담기는 한 건.
 *
 * `id` 는 **로컬에서 1회 생성**해 재시도마다 재사용한다. Firestore 쓰기는
 * `addDoc`(자동 id) 이 아니라 이 id 로 `setDoc` 하므로, ack 만 유실되고 실제로는
 * 성공했던 쓰기를 재시도해도 **중복 문서가 생기지 않는다**. 원장에서 같은 사건이 두
 * 건으로 보이면 그 자체가 감사 증거의 오염이다.
 *
 * `occurredAtMs` 는 **발생 시각**이지 적재 시각이 아니다. 30분 뒤에 재적재되는
 * 레코드에 재적재 시각을 찍으면 원장이 "그때 일어난 일"을 "지금 일어난 일"로
 * 기록하게 된다.
 */
export interface SpoolRecord {
  id: string;
  occurredAtMs: number;
  event: LedgerEventWrite;
}

interface SpoolFileShape {
  version: number;
  /** 이 스풀을 쓴 프로세스의 정체(에이전트 id). 진단용. */
  agentId: string;
  records: SpoolRecord[];
}

// ── 상한 (§11) ───────────────────────────────────────────────────

/** 스풀 파일 크기 상한. 넘으면 오래된 것부터 버리되 tombstone 을 남긴다. */
export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
/** 건수 상한. 바이트 상한과 OR 로 걸린다(작은 레코드가 무한히 쌓이는 것도 막는다). */
export const DEFAULT_MAX_RECORDS = 5000;

/** 오버플로 tombstone 을 식별하는 toolName. 감사 뷰(L4)가 이걸로 공백을 표시한다. */
export const SPOOL_OVERFLOW_TOOL = "ledger:spool_overflow";

/**
 * 재시도 백오프. 마지막 값이 이후 모든 시도의 상한이 된다.
 *
 * 네트워크 단절은 분 단위로 이어지므로 초 단위 폭주 재시도는 배터리만 태운다.
 * 반대로 너무 길면 복구 감지가 늦다 — 1s 부터 시작해 1분에서 멈춘다.
 */
export const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 15_000, 30_000, 60_000];

// ── 상태 조회 (L2 라이브 검증이 직접 쓴다) ───────────────────────

export interface SpoolStatus {
  /** 아직 원장에 못 들어간 건수. 0 이면 지금 이 순간 밀린 것이 없다. */
  pending: number;
  /** 대기 중 가장 오래된 이벤트의 발생 시각. 큐가 비었으면 null. */
  oldestPendingAtMs: number | null;
  /** 지금 이 순간 밀린 것이 있는가(= degraded). */
  degraded: boolean;
  /**
   * ★프로세스 기동 이후 **한 번이라도** 쓰기가 실패했는가.
   *
   * `degraded` 와 따로 두는 이유: 순간 실패 후 회복하면 큐는 즉시 비지만, 그
   * 흔적까지 지우면 "실패가 있었나"를 물었을 때 조용한 유실과 구분할 수 없게 된다.
   * 이 필드와 아래 카운터들은 프로세스 생애 내내 초기화되지 않는다.
   */
  everDegraded: boolean;
  /** 마지막 실패 사유. 없으면 null — "모른다"를 "괜찮다"로 답하지 않는다. */
  lastError: string | null;
  lastErrorAtMs: number | null;
  /** 기동 이후 누적 쓰기 실패 횟수(재시도 각각을 1 로 센다). */
  failureCount: number;
  /** 마지막으로 원장 적재에 성공한 시각. */
  lastSuccessAtMs: number | null;
  /** 기동 이후 원장에 적재된 건수. */
  writtenCount: number;
  /** ★상한 초과로 버려진 누적 건수. 0 이 아니면 원장에 공백이 있다는 뜻. */
  droppedCount: number;
  /** 버려진 구간. droppedCount 가 0 이면 null. */
  droppedFromMs: number | null;
  droppedToMs: number | null;
  /** 다음 재시도 예정 시각. 재시도 대기 중이 아니면 null. */
  nextRetryAtMs: number | null;
  spoolPath: string;
  maxBytes: number;
  maxRecords: number;
  /** 현재 큐의 직렬화 바이트 합(상한 대비 얼마나 찼는가). */
  queuedBytes: number;
}

export interface LedgerSpoolOptions {
  /** 스풀 파일이 놓일 디렉터리. */
  dir: string;
  /** 이 프로세스의 에이전트 id. 스풀 파일명이 된다. */
  agentId: string;
  /** 원장 적재기. 성공하면 resolve, 실패하면 reject. */
  sink: (record: SpoolRecord) => Promise<void>;
  maxBytes?: number;
  maxRecords?: number;
  now?: () => number;
  newId?: () => string;
  /**
   * 재시도 예약기. 기본은 `setTimeout` + `unref()` — 스풀 재시도가 프로세스 종료를
   * 붙잡지 않게 한다. 테스트는 여기에 수동 트리거를 꽂는다.
   */
  schedule?: (fn: () => void, ms: number) => void;
  /** 사람이 봐야 하는 사건(오버플로 등)을 알린다. */
  onNotice?: (notice: SpoolNotice) => void;
}

export interface SpoolNotice {
  kind: "overflow" | "write-failed" | "recovered";
  message: string;
  atMs: number;
}

/**
 * 파일명에 쓸 수 있게 에이전트 id 를 정리한다. 경로 조각(`/`, `..`)이 섞여 들어와
 * 스풀이 엉뚱한 곳에 쓰이는 것을 막는다.
 */
export function spoolFileName(agentId: string): string {
  const cleaned = (agentId || "").replace(/[^A-Za-z0-9_.-]/g, "_");
  // 빈 값·점만 있는 값은 파일명으로 위험하므로 명시적 표식으로 바꾼다. 추측해서
  // 그럴듯한 id 를 지어내지 않는다 — 귀속 불명은 불명으로 남긴다.
  const safe = /^[A-Za-z0-9_-]/.test(cleaned)
    ? cleaned.slice(0, 120)
    : "unknown";
  return `${safe}.spool.json`;
}

/**
 * 서버 ack 대기 상한. 이 시간 안에 백엔드가 쓰기를 확인하지 않으면 **실패로
 * 취급**한다(스풀에 남긴다).
 *
 * 배수는 백그라운드라 이 대기가 툴 호출을 막지 않는다. 너무 짧으면 느린 회선에서
 * 멀쩡한 쓰기를 실패로 오판하고(스풀이 계속 부풀고), 너무 길면 단절 감지가 늦다.
 * 15초는 Firestore gRPC 재연결 시도 주기보다 넉넉하되 사람이 상태를 물었을 때
 * 답이 바뀌어 있을 만한 크기다.
 */
export const ACK_TIMEOUT_MS = 15_000;

/**
 * 쓰기 전체에 **시간 상한**을 씌운다. 상한 안에 끝나지 않으면 실패로 판정한다.
 *
 * ★이게 없으면 배수 루프가 첫 레코드에서 영원히 멈춘다 — 라이브에서 실제로 그랬다.
 * Firestore 쓰기 프로미스는 오프라인일 때 resolve 도 reject 도 하지 않으므로
 * (파일 상단 "라이브 실측" 참조), `await` 만으로는 실패를 **영원히 관측할 수 없다.**
 * 상한을 쓰기 프로미스 바깥에 두는 것이 요점이다: ack 확인만 감싸면 그 앞의
 * `setDoc` 에서 이미 매달려 여기까지 오지도 못한다.
 *
 * 판정은 의도적으로 **보수적**이다. 상한 초과를 실패로 보면 실제로는 나중에 성공한
 * 쓰기를 스풀에 중복 보관할 수 있지만, 문서 id 가 멱등이라 재적재해도 같은 문서다.
 * 반대 방향(실패를 성공으로 오인)은 원장에 공백을 남기고 아무도 모르게 만든다 —
 * 감사 원장에서 틀려도 되는 방향은 이쪽뿐이다.
 */
export async function requireServerAck(
  write: () => Promise<void>,
  timeoutMs: number = ACK_TIMEOUT_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      write(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `서버 ack 없음 — ${timeoutMs}ms 안에 Firestore 백엔드가 쓰기를 ` +
                  `확인하지 않았습니다(오프라인 또는 권한 거부 가능). ` +
                  `오프라인일 때 SDK 의 쓰기 프로미스는 resolve 도 reject 도 하지 ` +
                  `않으므로, 이 상한이 없으면 실패를 영원히 관측할 수 없습니다.`,
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 스풀 디렉터리. 테스트·격리 실행을 위해 env 로 덮어쓸 수 있다. */
export function defaultSpoolDir(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
): string {
  const override = env.MARBLO_LEDGER_SPOOL_DIR;
  if (override && override.trim()) return override.trim();
  return path.join(homeDir, ".marblo", "ledger-spool");
}

const byteLen = (rec: SpoolRecord): number =>
  Buffer.byteLength(JSON.stringify(rec), "utf8");

interface Entry {
  rec: SpoolRecord;
  size: number;
  /** tombstone 은 드롭 대상에서 제외된다 — 유실 기록이 유실되면 전체가 무의미하다. */
  tombstone: boolean;
}

/**
 * 로컬 스풀.
 *
 * 큐 하나 + 소비자 하나. `enqueue()` 는 동기이고, 배수(drain)는 백그라운드에서
 * **한 건씩 순서대로** 진행한다. 한 건이 실패하면 그 자리에서 멈추고 백오프
 * 재시도하므로, 뒤 이벤트가 앞 이벤트를 추월하는 일이 구조적으로 불가능하다.
 *
 * ★"한 번 degraded 면 전부 큐로" 가 자동으로 성립한다: 모든 이벤트가 예외 없이 같은
 * 큐를 지나기 때문이다. 정상일 때 직행하고 실패할 때만 큐에 넣는 설계였다면 A 가
 * 실패해 스풀에 들어간 사이 B 가 직행해 순서가 깨졌을 것이다.
 */
export class LedgerSpool {
  private readonly opts: Required<Omit<LedgerSpoolOptions, "onNotice">> & {
    onNotice?: (n: SpoolNotice) => void;
  };
  private readonly queue: Entry[] = [];
  private queuedBytes = 0;
  private draining = false;
  private retryTimerArmed = false;
  private attempt = 0;
  private settledWaiters: Array<() => void> = [];

  // 프로세스 생애 내내 유지되는 관측값 — degraded 를 벗어나도 지우지 않는다.
  private everDegraded = false;
  private lastError: string | null = null;
  private lastErrorAtMs: number | null = null;
  private failureCount = 0;
  private lastSuccessAtMs: number | null = null;
  private writtenCount = 0;
  private droppedCount = 0;
  private droppedFromMs: number | null = null;
  private droppedToMs: number | null = null;
  private nextRetryAtMs: number | null = null;

  constructor(options: LedgerSpoolOptions) {
    this.opts = {
      dir: options.dir,
      agentId: options.agentId,
      sink: options.sink,
      maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
      maxRecords: options.maxRecords ?? DEFAULT_MAX_RECORDS,
      now: options.now ?? (() => Date.now()),
      newId: options.newId ?? (() => randomUUID()),
      schedule:
        options.schedule ??
        ((fn, ms) => {
          const t = setTimeout(fn, ms);
          // 스풀 재시도 타이머가 MCP 서버 종료를 붙잡으면 안 된다.
          (t as unknown as { unref?: () => void }).unref?.();
        }),
      onNotice: options.onNotice,
    };
  }

  get spoolPath(): string {
    return path.join(this.opts.dir, spoolFileName(this.opts.agentId));
  }

  /**
   * 이벤트 한 건을 원장 적재 대기열에 넣는다. **동기이고 아무것도 기다리지 않는다.**
   *
   * 반환하는 id 는 Firestore 문서 id 이기도 하다(재시도 멱등).
   */
  enqueue(event: LedgerEventWrite, occurredAtMs?: number): string {
    const rec: SpoolRecord = {
      id: this.opts.newId(),
      occurredAtMs: occurredAtMs ?? this.opts.now(),
      event,
    };
    this.push({ rec, size: byteLen(rec), tombstone: false });
    void this.drain();
    return rec.id;
  }

  private push(entry: Entry): void {
    this.queue.push(entry);
    this.queuedBytes += entry.size;
    this.enforceCap();
  }

  /**
   * 상한 초과 처리 (§11 "상한 캡 + 초과 시 사용자 알림 — 조용히 버리지 않음").
   *
   * ★여기가 이 티켓의 함정 지점이다. 지속적 실패 → 전부 큐로 → 큐가 상한 도달,
   * 이 경로에서 조용히 버리면 없애려던 조용한 유실이 자리만 옮겨 되살아난다
   * (console.error → 큐 상한). 그래서 **상한에 닿는 순간이 가장 시끄러워야 한다.**
   *
   * 처리:
   *  1. 오래된 것부터 버린다(새 것을 거부하지 않는다 — 최근 행위가 더 조사 가치가
   *     높고, 새 것을 거부하면 "지금 일어나는 일"이 안 보이게 된다)
   *  2. 버린 즉시 큐 **머리에 tombstone 레코드**를 꽂는다. 별도 카운터가 아니라
   *     큐 안의 진짜 원장 레코드다 — 그래서 유실 구간의 올바른 자리에 놓이고,
   *     연결이 복구되는 순간 다른 레코드와 함께 원장에 적재된다. **L1 단계에서 이미
   *     원장에 흔적이 남는다**; L3 의 seq 구멍을 기다리지 않는다
   *  3. tombstone 자체는 절대 드롭 대상이 아니다
   *  4. 연속 오버플로는 새 tombstone 을 쌓지 않고 기존 것의 구간을 넓힌다
   */
  private enforceCap(): void {
    let dropped = 0;
    let fromMs: number | null = null;
    let toMs: number | null = null;

    while (
      this.queuedBytes > this.opts.maxBytes ||
      this.queue.length > this.opts.maxRecords
    ) {
      const idx = this.queue.findIndex((e) => !e.tombstone);
      // tombstone 만 남았다면 더 버릴 것이 없다. 상한을 넘겨서라도 유실 기록은 지킨다.
      if (idx === -1) break;
      const [victim] = this.queue.splice(idx, 1);
      this.queuedBytes -= victim.size;
      dropped += 1;
      if (fromMs === null) fromMs = victim.rec.occurredAtMs;
      toMs = victim.rec.occurredAtMs;
    }

    if (dropped === 0) return;

    this.droppedCount += dropped;
    if (this.droppedFromMs === null) this.droppedFromMs = fromMs;
    this.droppedToMs = toMs;
    this.mergeTombstone(dropped, fromMs, toMs);

    const message =
      `[Audit] ★스풀 상한 초과 — 감사 이벤트 ${dropped}건을 버렸습니다 ` +
      `(누적 ${this.droppedCount}건). 원장에 공백이 생겼고, 그 사실은 ` +
      `${SPOOL_OVERFLOW_TOOL} tombstone 으로 원장에 기록됩니다. ` +
      `spool=${this.spoolPath} lastError=${this.lastError ?? "(없음)"}`;
    // 조용히 버리지 않는다: 콘솔 + 알림 콜백(툴 결과 경고) + 상태 툴 + 원장 tombstone.
    console.error(message);
    this.opts.onNotice?.({
      kind: "overflow",
      message,
      atMs: this.opts.now(),
    });
  }

  /** 머리의 tombstone 을 갱신하거나 새로 꽂는다. */
  private mergeTombstone(
    dropped: number,
    fromMs: number | null,
    toMs: number | null,
  ): void {
    const head = this.queue[0];
    if (head?.tombstone) {
      const p = head.rec.event.params as Record<string, unknown>;
      const prevCount = typeof p.droppedCount === "number" ? p.droppedCount : 0;
      const prevFrom =
        typeof p.firstDroppedAtMs === "number" ? p.firstDroppedAtMs : fromMs;
      this.queuedBytes -= head.size;
      head.rec.event = this.tombstoneEvent(
        prevCount + dropped,
        prevFrom,
        toMs,
        head.rec.event,
      );
      head.size = byteLen(head.rec);
      this.queuedBytes += head.size;
      return;
    }

    const rec: SpoolRecord = {
      id: this.opts.newId(),
      occurredAtMs: fromMs ?? this.opts.now(),
      event: this.tombstoneEvent(dropped, fromMs, toMs, null),
    };
    const entry: Entry = { rec, size: byteLen(rec), tombstone: true };
    this.queue.unshift(entry);
    this.queuedBytes += entry.size;
  }

  /**
   * 유실 구간을 서술하는 원장 이벤트.
   *
   * `kind: "lifecycle"` — 툴 호출이 아니라 "이 시점에 이 프로세스에 무슨 일이
   * 있었나"를 설명하는 사건이므로 §15 의 lifecycle 에 속한다.
   * `success: false` — 이건 정상 기록이 아니라 실패의 기록이다.
   */
  private tombstoneEvent(
    droppedCount: number,
    firstDroppedAtMs: number | null,
    lastDroppedAtMs: number | null,
    prior: LedgerEventWrite | null,
  ): LedgerEventWrite {
    return {
      projectId: prior?.projectId ?? "",
      agentId: this.opts.agentId,
      toolName: SPOOL_OVERFLOW_TOOL,
      params: {
        droppedCount,
        firstDroppedAtMs,
        lastDroppedAtMs,
        maxBytes: this.opts.maxBytes,
        maxRecords: this.opts.maxRecords,
      },
      result:
        `감사 이벤트 ${droppedCount}건이 로컬 스풀 상한 초과로 유실되었습니다. ` +
        `이 구간의 에이전트 행위는 원장에 없습니다 — "일어나지 않았다"가 아니라 ` +
        `"기록되지 못했다"입니다.`,
      duration: 0,
      success: false,
      kind: "lifecycle",
      actorUid: prior?.actorUid ?? null,
      model: prior?.model ?? null,
      tier: prior?.tier ?? null,
      instructionHash: null,
      taskId: null,
      worktreeId: prior?.worktreeId ?? null,
    };
  }

  // ── 배수 ───────────────────────────────────────────────────────

  /**
   * 큐를 한 건씩 순서대로 원장에 밀어넣는다. 동시에 하나만 돈다(단일 소비자).
   * 실패하면 그 자리에서 멈추고 디스크에 남긴 뒤 백오프 재시도를 건다.
   */
  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const entry = this.queue[0];
        try {
          await this.opts.sink(entry.rec);
        } catch (err) {
          this.recordFailure(err);
          await this.persist();
          this.scheduleRetry();
          return;
        }
        // ack 를 받은 뒤에만 큐에서 뺀다. 이 순서가 "큐가 비었다 = 전부 적재됐다"를
        // 참으로 만들고, 그래서 degraded 탈출에 별도 확인 사이클이 필요 없다.
        this.queue.shift();
        this.queuedBytes -= entry.size;
        this.writtenCount += 1;
        this.lastSuccessAtMs = this.opts.now();
        this.attempt = 0;
        this.nextRetryAtMs = null;
      }
      // 큐가 비었다 → 디스크 스풀은 존재 이유가 없다.
      await this.clearPersisted();
      if (this.everDegraded && this.lastError !== null) {
        this.opts.onNotice?.({
          kind: "recovered",
          message: `[Audit] 스풀 복구 — 밀렸던 감사 이벤트를 모두 적재했습니다.`,
          atMs: this.opts.now(),
        });
      }
    } finally {
      this.draining = false;
      this.notifySettled();
    }
  }

  private recordFailure(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.everDegraded = true;
    this.lastError = message;
    this.lastErrorAtMs = this.opts.now();
    this.failureCount += 1;
    // 첫 실패만 콘솔에 남긴다. 재시도마다 찍으면 로그가 실패로 도배돼 정작 다른
    // 신호가 묻힌다 — 지속 상태는 상태 툴과 툴 결과 경고가 보고한다.
    if (this.failureCount === 1) {
      console.error(
        `[Audit] 원장 쓰기 실패 — 로컬 스풀로 전환합니다. ` +
          `pending=${this.queue.length} spool=${this.spoolPath} 사유: ${message}`,
      );
      this.opts.onNotice?.({
        kind: "write-failed",
        message: `[Audit] 원장 쓰기 실패 — 로컬 스풀에 보관 중입니다: ${message}`,
        atMs: this.lastErrorAtMs,
      });
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimerArmed) return;
    const delay =
      RETRY_DELAYS_MS[Math.min(this.attempt, RETRY_DELAYS_MS.length - 1)];
    this.attempt += 1;
    this.retryTimerArmed = true;
    this.nextRetryAtMs = this.opts.now() + delay;
    this.opts.schedule(() => {
      this.retryTimerArmed = false;
      void this.drain();
    }, delay);
  }

  // ── 디스크 ─────────────────────────────────────────────────────

  /**
   * 큐 전체를 스풀 파일에 기록한다. 임시 파일 + rename 이라 중간에 죽어도 파일은
   * 항상 온전한 이전 상태이거나 온전한 새 상태다(반쯤 쓰인 스풀은 없다).
   *
   * 파일이 큐 전체의 거울이므로 순서 보존이 자명하다 — append 후 부분 삭제를
   * 관리하는 것보다 추론할 것이 적다.
   */
  private async persist(): Promise<void> {
    const payload: SpoolFileShape = {
      version: SPOOL_FILE_VERSION,
      agentId: this.opts.agentId,
      records: this.queue.map((e) => e.rec),
    };
    const tmp = `${this.spoolPath}.${process.pid}.tmp`;
    try {
      await fs.mkdir(this.opts.dir, { recursive: true });
      await fs.writeFile(tmp, JSON.stringify(payload), "utf8");
      await fs.rename(tmp, this.spoolPath);
    } catch (err) {
      // 디스크에도 못 쓰면 남는 건 메모리 큐뿐이다. 이 사실을 숨기지 않는다.
      console.error(
        `[Audit] ★스풀 디스크 기록 실패 — 프로세스가 죽으면 대기 중인 ` +
          `${this.queue.length}건이 유실됩니다: ${
            err instanceof Error ? err.message : String(err)
          }`,
      );
      await fs.rm(tmp, { force: true }).catch(() => {});
    }
  }

  private async clearPersisted(): Promise<void> {
    await fs.rm(this.spoolPath, { force: true }).catch(() => {});
  }

  /**
   * 프로세스 기동 시 디스크에 남아 있던 스풀을 큐 **앞쪽**에 복원한다.
   *
   * 앞쪽인 이유: 디스크에 있던 건 이번 기동보다 먼저 일어난 일이다. 뒤에 붙이면
   * 재적재 순서가 발생 순서와 어긋나고, 그러면 L3 가 enqueue 순서로 매길 seq 가
   * 실제 시간 순서와 뒤집힌다.
   *
   * 손상된 파일은 삭제하지 않고 `.corrupt` 로 옮긴다 — 읽지 못한다고 증거를 버리면
   * 그게 조용한 유실이다.
   */
  async restore(): Promise<number> {
    let raw: string;
    try {
      raw = await fs.readFile(this.spoolPath, "utf8");
    } catch {
      return 0; // 스풀 없음 = 정상
    }

    let records: SpoolRecord[];
    try {
      const parsed = JSON.parse(raw) as SpoolFileShape;
      if (!parsed || !Array.isArray(parsed.records)) throw new Error("shape");
      records = parsed.records.filter(
        (r): r is SpoolRecord =>
          !!r &&
          typeof r.id === "string" &&
          !!r.event &&
          typeof r.event === "object",
      );
    } catch (err) {
      const quarantine = `${this.spoolPath}.corrupt`;
      console.error(
        `[Audit] ★스풀 파일을 읽지 못했습니다 — ${quarantine} 로 격리합니다. ` +
          `이 구간의 감사 이벤트는 원장에 없습니다: ${
            err instanceof Error ? err.message : String(err)
          }`,
      );
      await fs.rename(this.spoolPath, quarantine).catch(() => {});
      this.everDegraded = true;
      this.lastError = `스풀 파일 손상 — ${quarantine} 로 격리됨`;
      this.lastErrorAtMs = this.opts.now();
      return 0;
    }

    if (records.length === 0) {
      await this.clearPersisted();
      return 0;
    }

    const entries: Entry[] = records.map((rec) => ({
      rec,
      size: byteLen(rec),
      tombstone: rec.event?.toolName === SPOOL_OVERFLOW_TOOL,
    }));
    this.queue.unshift(...entries);
    this.queuedBytes += entries.reduce((sum, e) => sum + e.size, 0);
    this.everDegraded = true;
    this.enforceCap();
    console.error(
      `[Audit] 이전 기동에서 밀린 감사 이벤트 ${records.length}건을 스풀에서 ` +
        `복원했습니다. 순서를 보존해 재적재합니다.`,
    );
    void this.drain();
    return records.length;
  }

  // ── 관측 ───────────────────────────────────────────────────────

  status(): SpoolStatus {
    const oldest = this.queue[0]?.rec.occurredAtMs ?? null;
    return {
      pending: this.queue.length,
      oldestPendingAtMs: oldest,
      degraded: this.queue.length > 0,
      everDegraded: this.everDegraded,
      lastError: this.lastError,
      lastErrorAtMs: this.lastErrorAtMs,
      failureCount: this.failureCount,
      lastSuccessAtMs: this.lastSuccessAtMs,
      writtenCount: this.writtenCount,
      droppedCount: this.droppedCount,
      droppedFromMs: this.droppedFromMs,
      droppedToMs: this.droppedToMs,
      nextRetryAtMs: this.queue.length > 0 ? this.nextRetryAtMs : null,
      spoolPath: this.spoolPath,
      maxBytes: this.opts.maxBytes,
      maxRecords: this.opts.maxRecords,
      queuedBytes: this.queuedBytes,
    };
  }

  /** 진행 중인 배수 사이클이 끝날 때까지 기다린다(테스트용). */
  async settled(): Promise<void> {
    if (!this.draining) return;
    await new Promise<void>((resolve) => this.settledWaiters.push(resolve));
  }

  private notifySettled(): void {
    const waiters = this.settledWaiters;
    this.settledWaiters = [];
    for (const w of waiters) w();
  }

  /** 재시도 타이머를 기다리지 않고 즉시 한 번 더 시도한다(수동 복구·테스트). */
  async retryNow(): Promise<void> {
    await this.drain();
  }
}

// ── 사람이 읽는 상태 요약 ────────────────────────────────────────

const ago = (ms: number | null, now: number): string =>
  ms === null ? "없음" : `${Math.max(0, Math.round((now - ms) / 1000))}초 전`;

/**
 * 상태를 사람이 읽는 텍스트로. **"모른다"를 "괜찮다"로 답하지 않는다**(§15) —
 * 관측하지 못한 값은 "없음/미상"으로 명시하고, 공백이 있으면 그 사실을 맨 앞에 쓴다.
 */
export function formatSpoolStatus(s: SpoolStatus, now: number): string {
  const lines: string[] = [];

  if (s.droppedCount > 0) {
    lines.push(
      `★원장에 공백 있음 — 상한 초과로 ${s.droppedCount}건이 유실되었습니다 ` +
        `(${ago(s.droppedFromMs, now)} ~ ${ago(s.droppedToMs, now)}).`,
    );
  }
  if (s.degraded) {
    lines.push(
      `상태: DEGRADED — ${s.pending}건이 원장에 못 들어가고 대기 중입니다 ` +
        `(가장 오래된 것 ${ago(s.oldestPendingAtMs, now)}).`,
    );
  } else if (s.everDegraded) {
    lines.push(
      `상태: 정상(회복됨) — 대기 0건. 단, 이 프로세스는 기동 이후 ` +
        `${s.failureCount}회 쓰기에 실패한 적이 있습니다.`,
    );
  } else {
    lines.push(`상태: 정상 — 대기 0건, 기동 이후 쓰기 실패 없음.`);
  }

  lines.push(
    `적재 성공: ${s.writtenCount}건 (마지막 ${ago(s.lastSuccessAtMs, now)})`,
  );
  lines.push(
    `마지막 실패: ${
      s.lastError === null
        ? "없음"
        : `${s.lastError} (${ago(s.lastErrorAtMs, now)})`
    }`,
  );
  if (s.nextRetryAtMs !== null) {
    lines.push(
      `다음 재시도: ${Math.max(
        0,
        Math.round((s.nextRetryAtMs - now) / 1000),
      )}초 후`,
    );
  }
  lines.push(
    `스풀: ${s.spoolPath} (${s.queuedBytes}B / 상한 ${s.maxBytes}B · ` +
      `${s.pending}건 / 상한 ${s.maxRecords}건)`,
  );
  return lines.join("\n");
}

/**
 * 툴 결과에 붙일 경고. 정상이면 null 이라 건강한 프로세스는 출력이 늘지 않는다.
 *
 * ★오버플로는 스로틀하지 않는다 — 상한에 닿는 순간이 가장 시끄러워야 한다.
 */
export function spoolNotice(s: SpoolStatus): string | null {
  if (s.droppedCount > 0) {
    return (
      `⚠️ [감사 원장] 상한 초과로 ${s.droppedCount}건이 유실되었습니다. ` +
      `원장에 공백이 있습니다 — get_ledger_spool_status 로 구간을 확인하세요.`
    );
  }
  if (s.pending > 0) {
    return (
      `⚠️ [감사 원장] 쓰기 실패로 ${s.pending}건이 로컬 스풀에 대기 중입니다 ` +
      `(사유: ${
        s.lastError ?? "미상"
      }). 이 구간의 감사 기록은 아직 원장에 없습니다.`
    );
  }
  return null;
}
