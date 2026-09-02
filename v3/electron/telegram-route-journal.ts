/**
 * telegram-route-journal — 텔레그램 인바운드 경로의 **시계열** 기록.
 *
 * ★왜 이게 있어야 하나 (티켓 c1R9C8v5MrBycZYSdTeB)
 *
 * "자리를 비우면 텔레그램이 안 들어오다가, 돌아오면 몰려 들어온다" 는 증상은
 * 원인이 정반대인 두 상태가 사용자에게 **똑같이 보이기 때문에** 생긴 미스터리다.
 *
 *   (A) 루프가 안 돈다 — 네트워크가 끊겼거나, getUpdates 가 물렸거나,
 *       앱 단위 스로틀링으로 타이머가 늘어졌다. 폴러가 메시지를 아직 못 봤다.
 *   (B) 루프는 잘 돈다. 메시지도 봤다. 그런데 **주입이 거부**돼 offset 을 보류
 *       중이다 — 오케 터미널에 초안이 물려 있거나, 확인 다이얼로그 앞이거나,
 *       오케가 아예 안 떠 있다.
 *
 * 둘 다 "조용하다" 로 보이고, 사람이 돌아와 터미널을 건드리면 (B)는 그 순간
 * 풀려서 밀린 게 한꺼번에 들어온다. 지금까지 우리는 **어느 쪽이었는지 사후에
 * 말할 수 없었다** — `logTelegramRouteHealth` 는 전환/기동 같은 이벤트에서만
 * 찍히고, 정작 조용한 구간에는 아무 기록도 남지 않았기 때문이다. 그래서 이
 * 모듈은 이벤트가 아니라 **시간**을 기준으로 찍는다.
 *
 * ── 무엇을 남기나 ────────────────────────────────────────────────────────
 * 표본 한 줄에 (A)와 (B)를 가르는 데 필요한 최소량이 다 들어간다:
 *   - `pollCompletedAgoMs` — 루프가 **실제로 돌았는지**. `loopRunning` 은 핸들이
 *     등록돼 있다는 뜻일 뿐, 멈춘 fetch 안에 물린 루프에도 true 다.
 *   - `hold` — 보류가 걸려 있는지, 무엇 때문인지(오케 없음 / 주입 거부 +
 *     컴포저 판정), 몇 초째인지, 몇 번 재시도했는지.
 *   - `idleSec` — 사장님이 자리를 비운 구간(마지막 사용자 입력 이후 경과).
 *     "사람이 앞에 있을 때만 돈다" 는 진술을 상관관계로 확인/반증한다.
 *   - `driftMs` — 이 샘플러 자신의 지각. 기대 간격보다 얼마나 늦게 깨어났는지.
 *     ★가설 2(앱 단위 스로틀링 / App Nap 으로 메인 타이머가 늘어난다)는
 *     이 값으로만 관측된다. 늘어졌다면 여기서 먼저 보인다.
 *
 * ── 경계 ─────────────────────────────────────────────────────────────────
 * ★읽기 전용이다. 폴러의 동작을 절대 바꾸지 않는다 — 보류(false=재배달) 의미도,
 * offset 전진 규칙도 이 모듈은 건드리지 않는다. 관측이 진단을 바꾸는 일은 있어도
 * 배달을 바꾸는 일은 없어야 한다.
 *
 * 메시지 본문·chatId·봇 토큰은 표본에 **담지 않는다**. 담는 것은 시각·상태·사유뿐.
 *
 * Electron 의존 없음(주입식 시계/시스템 idle/파일 경로) — 그래서
 * `tests/unit/telegram-route-journal.test.ts` 가 그대로 검증할 수 있다.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { TelegramRouteHealth } from "./telegram-poller";
import type { SubmitTally } from "./pty-manager";

/** 한 표본이 말하는 한 단어 결론. 사후 판독을 사람이 안 해도 되게 한다. */
export type RouteVerdict =
  /** 루프 자체가 없다(채널 비활성/정지). */
  | "loop-stopped"
  /**
   * 루프는 등록돼 있는데 마지막 getUpdates 왕복이 롱폴 예산을 한참 넘겼다 —
   * ★"루프가 멈춘 것" 쪽. 네트워크·스로틀링·물린 소켓을 의심할 구간.
   */
  | "loop-stalled"
  /** 루프는 도는데 오케가 없어서 보류 중. */
  | "held-no-orchestrator"
  /** ★루프는 도는데 주입이 거부돼 보류 중 — 컴포저/다이얼로그 쪽. */
  | "held-inject-refused"
  /** 루프는 도는데 주입이 예외로 실패해 보류 중. */
  | "held-inject-threw"
  /** 보류 없음. 조용한 건 보낸 사람이 없어서다. */
  | "idle-ok";

/**
 * 마지막 getUpdates 왕복이 이만큼 지나도록 끝나지 않았으면 "루프가 멈춘 것"으로
 * 본다. 롱폴 25s + abort 여유 10s = 35s 가 정상 상한이므로 그 곱절 남짓을 잡았다.
 */
const DEFAULT_STALL_MS = 90_000;
const DEFAULT_SAMPLE_INTERVAL_MS = 60_000;
/** 파일이 이 줄 수를 넘으면 최근 절반만 남기고 잘라 낸다(무한 성장 금지). */
const DEFAULT_MAX_LINES = 5_000;
/** 메모리에 들고 있는 최근 표본 수(진단 IPC/즉시 조회용). */
const RECENT_SAMPLES = 240;

const DEFAULT_FILE = path.join(
  os.homedir(),
  ".marblo",
  "telegram-route-health.jsonl",
);

/** 시계열 한 줄. 본문·chatId·토큰은 절대 담기지 않는다. */
export interface RouteSample {
  at: number;
  projectId: string;
  verdict: RouteVerdict;
  loopRunning: boolean;
  /** 마지막 getUpdates 가 **시작**된 지 얼마나 됐나. 없으면 null. */
  pollStartedAgoMs: number | null;
  /** 마지막 getUpdates 가 **끝난** 지 얼마나 됐나. 없으면 null. */
  pollCompletedAgoMs: number | null;
  consecutivePollErrors: number;
  pendingReply: boolean;
  lastDeliveredUpdateId: number | null;
  lastInboundAgoMs: number | null;
  /** 보류 중이면 사유·경과·재시도, 아니면 null. */
  hold: {
    reason: string;
    updateId: number;
    heldMs: number;
    attempts: number;
    refusal: string | null;
    composer: string | null;
  } | null;
  /**
   * 오케 PTY 의 제출 결말 누적. 대상을 못 찾으면 null.
   *
   * ★`lastUnconfirmedAgoMs` 가 가설 1의 자폭 경로를 잇는 고리다 — CR 이 끝내
   * 안 먹힌 제출 직후부터 컴포저가 `occupied` 로 굳는지 한 줄 안에서 보인다.
   */
  submit: {
    unconfirmed: number;
    refused: number;
    lastUnconfirmedAgoMs: number | null;
    lastRefusal: string | null;
  } | null;
  /** 마지막 사용자 입력 이후 경과(초). 못 읽으면 null. */
  idleSec: number | null;
  /** 이 샘플러가 기대 간격보다 늦게 깬 정도(ms). 음수는 0으로 죈다. */
  driftMs: number;
  /** 무엇이 이 표본을 찍게 했나(주기/기동/전환 등). */
  reason: string;
}

/**
 * 표본 한 줄에서 결론을 뽑는다. 순수 함수 — 판정 규칙을 테스트가 그대로 먹인다.
 *
 * ★순서가 규칙이다. 보류가 걸려 있으면 그게 답이다(루프는 돌고 있다는 뜻이니까).
 * 보류가 없을 때에 한해 루프 자체를 의심한다.
 */
export function classifyRoute(
  health: TelegramRouteHealth,
  now: number,
  stallMs: number = DEFAULT_STALL_MS,
): RouteVerdict {
  if (health.hold) {
    if (health.hold.reason === "no-orchestrator") return "held-no-orchestrator";
    if (health.hold.reason === "inject-threw") return "held-inject-threw";
    return "held-inject-refused";
  }
  if (!health.loopRunning) return "loop-stopped";
  // 아직 한 바퀴도 안 돈 갓 시작한 루프는 멈춘 게 아니다 — 시작 시각을 기준으로
  // 본다. 시작조차 없으면 판단 근거가 없으므로 멈췄다고 부르지 않는다.
  const anchor = health.lastPollCompletedAt ?? health.lastPollStartedAt;
  if (anchor !== null && now - anchor > stallMs) return "loop-stalled";
  return "idle-ok";
}

export interface RouteJournalDeps {
  /** 표본을 뜰 프로젝트 목록(폴러의 등록 루프 집합). */
  listProjects: () => string[];
  getRouteHealth: (projectId: string) => TelegramRouteHealth;
  /** 마지막 사용자 입력 이후 경과(초). Electron powerMonitor 를 여기에 꽂는다. */
  getSystemIdleSeconds?: () => number | null;
  /** 이 프로젝트의 오케 PTY 제출 집계. 없으면 null. */
  getSubmitTally?: (projectId: string) => SubmitTally | null;
  sampleIntervalMs?: number;
  stallMs?: number;
  filePath?: string;
  maxLines?: number;
  now?: () => number;
  logger?: Pick<Console, "log" | "warn" | "error">;
}

/**
 * 주기 샘플러. `start()` 로 돌고 `stop()` 으로 멈춘다. 파일 쓰기는 실패해도
 * 삼킨다 — 관측이 앱을 죽이면 관측이 아니다.
 */
export class TelegramRouteJournal {
  private readonly deps: RouteJournalDeps;
  private readonly log: Pick<Console, "log" | "warn" | "error">;
  private readonly now: () => number;
  private readonly filePath: string;
  private readonly maxLines: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTickAt: number | null = null;
  private lineCount = 0;
  private lineCountKnown = false;
  private recent: RouteSample[] = [];

  constructor(deps: RouteJournalDeps) {
    this.deps = deps;
    this.log = deps.logger ?? console;
    this.now = deps.now ?? (() => Date.now());
    this.filePath = deps.filePath ?? DEFAULT_FILE;
    this.maxLines = deps.maxLines ?? DEFAULT_MAX_LINES;
  }

  get intervalMs(): number {
    return this.deps.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS;
  }

  start(): void {
    if (this.timer) return;
    this.lastTickAt = this.now();
    this.sample("journal-start");
    const t = setInterval(() => this.sample("tick"), this.intervalMs);
    // 진단 타이머가 앱 종료를 붙들지 않게 한다.
    t.unref?.();
    this.timer = t;
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.lastTickAt = null;
  }

  /** 메모리에 남은 최근 표본(오래된 것부터). */
  recentSamples(): RouteSample[] {
    return [...this.recent];
  }

  /**
   * 지금 한 번 뜬다. 주기 tick 외에 기동/전환 같은 이벤트에서도 부를 수 있다.
   * 표본을 그대로 돌려주므로 호출부가 로그로 쓰거나 테스트가 검사할 수 있다.
   */
  sample(reason: string): RouteSample[] {
    const at = this.now();
    // ★지각 측정. tick 이 아닐 때(수동 호출)는 간격 기대가 없으므로 0.
    const drift =
      reason === "tick" && this.lastTickAt !== null
        ? Math.max(0, at - this.lastTickAt - this.intervalMs)
        : 0;
    if (reason === "tick") this.lastTickAt = at;

    const idleSec = this.readIdleSeconds();
    const stallMs = this.deps.stallMs ?? DEFAULT_STALL_MS;
    const samples: RouteSample[] = [];
    let projects: string[];
    try {
      projects = this.deps.listProjects();
    } catch (err) {
      this.log.warn(
        `[TelegramRouteJournal] listProjects failed: ${errText(err)}`,
      );
      return [];
    }
    for (const projectId of projects) {
      let health: TelegramRouteHealth;
      try {
        health = this.deps.getRouteHealth(projectId);
      } catch (err) {
        this.log.warn(
          `[TelegramRouteJournal] getRouteHealth failed for ${projectId}: ${errText(err)}`,
        );
        continue;
      }
      const hold = health.hold;
      samples.push({
        at,
        projectId,
        verdict: classifyRoute(health, at, stallMs),
        loopRunning: health.loopRunning,
        pollStartedAgoMs: ago(at, health.lastPollStartedAt),
        pollCompletedAgoMs: ago(at, health.lastPollCompletedAt),
        consecutivePollErrors: health.consecutivePollErrors,
        pendingReply: health.pendingReply,
        lastDeliveredUpdateId: health.lastDeliveredUpdateId,
        lastInboundAgoMs: ago(at, health.lastInboundAt),
        hold: hold
          ? {
              reason: hold.reason,
              updateId: hold.updateId,
              heldMs: hold.heldMs,
              attempts: hold.attempts,
              refusal: hold.detail?.refusal ?? null,
              composer: hold.detail?.composer ?? null,
            }
          : null,
        submit: this.readSubmitTally(projectId, at),
        idleSec,
        driftMs: drift,
        reason,
      });
    }
    if (samples.length > 0) this.append(samples);
    return samples;
  }

  private readSubmitTally(
    projectId: string,
    now: number,
  ): RouteSample["submit"] {
    if (!this.deps.getSubmitTally) return null;
    let tally: SubmitTally | null;
    try {
      tally = this.deps.getSubmitTally(projectId);
    } catch {
      return null;
    }
    if (!tally) return null;
    return {
      unconfirmed: tally.unconfirmed,
      refused: tally.refused,
      lastUnconfirmedAgoMs: ago(now, tally.lastUnconfirmedAt),
      lastRefusal: tally.lastRefusal,
    };
  }

  private readIdleSeconds(): number | null {
    if (!this.deps.getSystemIdleSeconds) return null;
    try {
      const v = this.deps.getSystemIdleSeconds();
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    } catch {
      return null;
    }
  }

  private append(samples: RouteSample[]): void {
    const body = samples.map((s) => JSON.stringify(s)).join("\n") + "\n";
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      if (!this.lineCountKnown) {
        this.lineCount = countLines(this.filePath);
        this.lineCountKnown = true;
      }
      fs.appendFileSync(this.filePath, body, "utf8");
      this.lineCount += samples.length;
      if (this.lineCount > this.maxLines) this.trim();
    } catch (err) {
      // 관측 실패가 앱을 흔들면 안 된다. 한 번 말하고 넘어간다.
      this.log.warn(
        `[TelegramRouteJournal] append failed (${this.filePath}): ${errText(err)}`,
      );
    }
    this.recent.push(...samples);
    if (this.recent.length > RECENT_SAMPLES) {
      this.recent = this.recent.slice(this.recent.length - RECENT_SAMPLES);
    }
  }

  /** 최근 maxLines/2 줄만 남긴다 — 오래된 구간을 버리되 최근 이력은 지킨다. */
  private trim(): void {
    try {
      const keep = Math.floor(this.maxLines / 2);
      const lines = fs
        .readFileSync(this.filePath, "utf8")
        .split("\n")
        .filter((l) => l.length > 0);
      const kept = lines.slice(Math.max(0, lines.length - keep));
      fs.writeFileSync(this.filePath, kept.join("\n") + "\n", "utf8");
      this.lineCount = kept.length;
    } catch (err) {
      this.log.warn(
        `[TelegramRouteJournal] trim failed (${this.filePath}): ${errText(err)}`,
      );
      // 자르지 못했으면 다음 append 에서 다시 세도록 카운터를 무효화한다.
      this.lineCountKnown = false;
    }
  }
}

function ago(now: number, at: number | null): number | null {
  return at === null ? null : Math.max(0, now - at);
}

function countLines(file: string): number {
  try {
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.length > 0).length;
  } catch {
    return 0;
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
