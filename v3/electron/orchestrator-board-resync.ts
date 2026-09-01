/**
 * 보드 → 오케스트레이터 주기 재동기화 (티켓 tHQzXPvFaR29fy0I82rM).
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * 폐루프의 완료 통보는 지금까지 전부 **밀어넣기(push) 1회**에 걸려 있었다:
 * mcp-server `notifyOrchestrator` → bridge `/notify-orchestrator` →
 * `PtyManager.writeAndSubmit`. 이 사슬의 어느 고리가 끊겨도(오케 세션 재시작 창,
 * 컴포저 오염, busy 스트림에 CR 미등록) 알림은 사라지고, 사라졌다는 사실조차
 * 남지 않았다. 2026-09-01 하루에만 REVIEW 제출 3건이 그렇게 증발했다.
 *
 * 이 모듈은 그 사슬을 신뢰하지 않는다. ★보드(Firestore tasks)가 진실원이다:
 * "오케의 행동이 필요한 상태(REVIEW·FAILED·BLOCKED·고아 티켓·체인 READY)에
 * 머물러 있는 항목" 을 주기적으로 다시 읽어, 이 오케 세션이 아직 통보받지 못한
 * 것만 골라 PTY 로 밀어준다. 개별 알림이 전부 유실돼도 이 스위프만 살아 있으면
 * 루프는 닫힌다.
 *
 * ── 폭주 방지: "본 것" 의 기준 ──────────────────────────────────────────────
 * 재동기화가 이미 처리된 것까지 다시 밀면 오케가 같은 것을 두 번 검증한다.
 * 기준은 **오케 PTY 세션 단위**다: (ptySessionId → 통보한 key 집합)을 들고,
 *   - 주입이 성공(injectMessage=true)한 항목만 seen 으로 기록한다. 실패하면
 *     기록하지 않으므로 다음 틱에 자동 재시도된다 — 조용한 실패 경로가 없다.
 *   - 오케가 재시작되면 ptySessionId 가 바뀌고 seen 집합은 빈 상태로 시작한다.
 *     새 세션은 아무것도 본 적이 없으므로 미처리분 전체를 다시 통보받는다 —
 *     2026-09-01 "앱 재시작 후 아무도 몰랐다" 블랙아웃의 직접 수리다.
 *   - 같은 세션에는 같은 (task,status) 를 다시 밀지 않는다. REVIEW 가 반려 후
 *     재제출되는 경우는 직접 알림([Review Submitted])이 1차 경로로 남아 있고,
 *     그 알림까지 유실되면 오케 세션이 갈릴 때 재통보된다(알려진 트레이드오프).
 *
 * minAgeMs: 상태 전이 직후는 직접 알림이 도착했을 가능성이 높은 구간이다.
 * 그 구간을 건너뛰어 정상 경로와의 이중 통보를 줄인다. 고아 판정은 더 보수적으로
 * (orphanMinAgeMs) — 다른 머신의 에이전트는 로컬 플릿에 안 보이므로, 보드 활동이
 * 한동안 없는 티켓만 고아로 부른다(agent-watchdog 의 15분 규율과 같은 이유).
 *
 * ── 설계 규율 ────────────────────────────────────────────────────────────────
 * PR #1354(BrowserPaneOpenUrlDelivery)를 따라 타이머·시계를 의존성 주입받아
 * electron 없이 유닛 테스트한다. 스위프는 절대 throw 하지 않고, 프로젝트 하나의
 * 실패가 다른 프로젝트의 재동기화를 막지 않는다.
 *
 * v1 범위: 보드 오케만. 미션 티켓은 컨덕터의 report-watchdog 이 소유하므로
 * 여기서 제외한다(포함하면 두 감시자가 같은 티켓을 다르게 흔든다).
 */

import { isLaneContextId } from "./mcp-server/context";

/** 스위프가 보드에서 읽어 오는 티켓 1행. I/O 포트가 채운다. */
export interface ResyncTaskRow {
  taskId: string;
  projectId: string;
  status: string;
  title?: string;
  role?: string;
  prUrl?: string | null;
  contextId?: string;
  /** 미션 소속이면 true — 컨덕터 소관이라 스위프가 건드리지 않는다. */
  isMission?: boolean;
  claimedBy?: string | null;
  /**
   * 마지막 보드 활동(projection.lastActivityAt → claimedAt → updatedAt →
   * createdAt 폴백)으로부터의 경과 ms. 아무 타임스탬프도 없으면 null —
   * 그 경우 나이 게이트를 통과시킨다(모른다고 조용히 숨기지 않는다).
   */
  ageMs: number | null;
}

/** 워크체인에서 READY 로 파생된 항목 1행. */
export interface ResyncChainReadyRow {
  itemId: string;
  what: string;
}

export type ResyncAttentionKind = "review" | "failed" | "blocked" | "orphan";

export interface ResyncAttentionEntry {
  kind: ResyncAttentionKind;
  row: ResyncTaskRow;
}

export interface OrchSessionRef {
  ptySessionId: string;
  status: string;
}

export interface BoardResyncDeps {
  /** 보드 오케가 배선된 프로젝트 id 목록(세션 유무와 무관 — 세션은 아래로 판정). */
  listBoardOrchestratorProjects(): string[];
  /** 지금 이 프로젝트의 보드 오케 세션. 없으면 null. */
  getOrchestratorSession(projectId: string): OrchSessionRef | null;
  /**
   * 오케 행동이 필요할 수 있는 티켓 전체(모든 프로젝트, status in
   * REVIEW/FAILED/BLOCKED/CLAIMED/IN_PROGRESS). 실패 시 throw 해도 된다 —
   * 틱이 삼키고 다음 주기에 재시도한다.
   */
  listAttentionTasks(): Promise<ResyncTaskRow[]>;
  /** 이 에이전트가 로컬 플릿에 살아 있는가(stopped/error/부재 → false). */
  isAgentAliveInFleet(agentId: string): boolean;
  /** 이 프로젝트 워크체인의 READY 항목. 실패 시 throw 가능(틱이 삼킨다). */
  listReadyChainItems(projectId: string): Promise<ResyncChainReadyRow[]>;
  /**
   * 오케 PTY 주입. `OrchestratorManager.injectMessage` — 정직한 boolean 을
   * 돌려주는 경로만 쓴다(브리지 fire-and-forget 경로를 다시 타지 않는다).
   */
  inject(projectId: string, message: string): Promise<boolean>;
  log?(message: string): void;
  logError?(message: string): void;
  /** 테스트 주입점 — PR #1354 규율. */
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  intervalMs?: number;
  minAgeMs?: number;
  orphanMinAgeMs?: number;
  maxDigestItems?: number;
}

export const BOARD_RESYNC_DEFAULT_INTERVAL_MS = 120_000;
/** 직접 알림(정상 경로)이 먼저 도착할 시간을 준다 — 이중 통보 축소. */
export const BOARD_RESYNC_DEFAULT_MIN_AGE_MS = 180_000;
/** 다른 머신의 에이전트를 고아로 오판하지 않도록 보드 침묵을 길게 요구한다. */
export const BOARD_RESYNC_DEFAULT_ORPHAN_MIN_AGE_MS = 600_000;
export const BOARD_RESYNC_DEFAULT_MAX_DIGEST_ITEMS = 15;

/**
 * 티켓 1행의 재동기화 축 판정. null 이면 이 스위프의 관심사가 아니다.
 * 순수 — 테스트가 조합을 직접 고정한다.
 */
export function classifyResyncAttention(
  row: ResyncTaskRow,
  isAgentAliveInFleet: (agentId: string) => boolean,
  minAgeMs: number,
  orphanMinAgeMs: number,
): ResyncAttentionKind | null {
  // 미션 티켓은 컨덕터 소관 — 이중 감시 금지.
  if (row.isMission) return null;
  const lane = isLaneContextId(row.contextId);
  // 나이를 모르면(null) 게이트를 통과시킨다 — 모른다는 이유로 숨기면 그게 곧
  // 새로운 조용한 유실이다.
  const aged = row.ageMs === null || row.ageMs >= minAgeMs;
  switch (row.status) {
    case "REVIEW":
      // 레인도 REVIEW 만은 보드 오케의 검증 게이트다(P4 — submit_for_review 는
      // 레인이 오케를 깨우는 유일한 이벤트).
      return aged ? "review" : null;
    case "FAILED":
    case "BLOCKED":
      // 레인의 FAILED/BLOCKED 는 보드 카드 이벤트다(P4) — PTY 로 밀지 않는다.
      if (lane) return null;
      return aged ? (row.status === "FAILED" ? "failed" : "blocked") : null;
    case "CLAIMED":
    case "IN_PROGRESS": {
      if (lane) return null;
      const orphanAged = row.ageMs === null || row.ageMs >= orphanMinAgeMs;
      if (!orphanAged) return null;
      // claim 이 풀렸거나(ghost reclaim 이 claimedBy 를 지운 채 status 는 남긴
      // 경우) claim 한 에이전트가 플릿에 없으면 그 티켓은 고아다.
      const claimant = (row.claimedBy ?? "").trim();
      if (!claimant) return "orphan";
      return isAgentAliveInFleet(claimant) ? null : "orphan";
    }
    default:
      return null;
  }
}

/** seen 집합의 키. 같은 세션에 같은 사실을 두 번 밀지 않기 위한 단위. */
export function resyncSeenKey(entry: ResyncAttentionEntry): string {
  if (entry.kind === "orphan") {
    // 같은 티켓이라도 다른 에이전트가 claim 했다가 또 죽으면 새 사건이다.
    return `orphan:${entry.row.taskId}:${entry.row.status}:${entry.row.claimedBy ?? ""}`;
  }
  return `${entry.kind}:${entry.row.taskId}:${entry.row.status}`;
}

export function chainSeenKey(item: ResyncChainReadyRow): string {
  return `chain:${item.itemId}`;
}

/**
 * 직접 알림(/notify-orchestrator)이 **주입 성공**했을 때 그 알림이 커버하는
 * seen 키들. 스위프가 같은 사실을 다이제스트로 또 밀지 않게 한다(이중 검증
 * 방지 — 티켓의 "알림 폭주 주의" 항).
 *
 * taskId 는 파싱이 아니라 브리지 프로토콜 필드로 온다(견고성). 메시지 접두사와
 * 전이 화살표만 본다 — 이 포맷은 notify-routing 테스트가 이미 계약으로 고정한
 * 것과 같은 어휘다. 모르는 포맷이면 빈 배열: 잘못 mark 해서 정당한 재통보를
 * 삼키는 것보다, 중복 한 번이 안전하다(fail-open).
 */
export function directDeliverySeenKeys(
  taskId: string | undefined,
  message: string,
): string[] {
  if (!taskId) return [];
  const trimmed = message.trim();
  if (trimmed.startsWith("[Review Submitted]")) {
    return [`review:${taskId}:REVIEW`];
  }
  if (trimmed.startsWith("[Task Update]")) {
    const match = trimmed.match(/\s→\s([A-Z_]+)\b/);
    if (match?.[1] === "FAILED") return [`failed:${taskId}:FAILED`];
    if (match?.[1] === "BLOCKED") return [`blocked:${taskId}:BLOCKED`];
  }
  return [];
}

const KIND_LINE: Record<ResyncAttentionKind, (row: ResyncTaskRow) => string> = {
  review: (r) =>
    `· REVIEW 대기: "${r.title ?? r.taskId}" (id=${r.taskId}${r.role ? `, ${r.role}` : ""}${r.prUrl ? `, PR: ${r.prUrl}` : ""}) — 검증/머지 또는 반려가 필요합니다`,
  failed: (r) =>
    `· FAILED: "${r.title ?? r.taskId}" (id=${r.taskId}) — 원인 확인 후 재시도/재배정 판단이 필요합니다`,
  blocked: (r) =>
    `· BLOCKED: "${r.title ?? r.taskId}" (id=${r.taskId}) — 무엇을 기다리는지 확인해 풀어주세요`,
  orphan: (r) =>
    `· 고아 티켓: "${r.title ?? r.taskId}" (id=${r.taskId}, status=${r.status}, claimedBy=${r.claimedBy || "없음"}) — claim 한 에이전트가 플릿에 없습니다. 워치독 회복 대상일 수 있으니 get_task 로 확인 후 재배정하세요`,
};

/**
 * 한 틱에 오케 1명에게 보내는 다이제스트 1통. 항목별 N통이 아니라 1통이다 —
 * 알림 폭주 방지의 두 번째 축.
 */
export function buildBoardResyncDigest(
  entries: readonly ResyncAttentionEntry[],
  chainItems: readonly ResyncChainReadyRow[],
  maxItems: number,
): string {
  const lines: string[] = [];
  for (const e of entries) lines.push(KIND_LINE[e.kind](e.row));
  for (const c of chainItems) {
    lines.push(
      `· 체인 READY: '${c.what}' (item=${c.itemId}) — 선행이 끝났습니다. 다음 태스크로 이어주세요(get_work_chain 참조)`,
    );
  }
  const total = lines.length;
  const shown = lines.slice(0, maxItems);
  const omitted = total - shown.length;
  return (
    `[보드 재동기화] 오케가 아직 통보받지 못한 보드 항목 ${total}건 — ` +
    `개별 알림이 유실됐을 수 있어 보드 상태 기준으로 다시 알립니다.\n` +
    shown.join("\n") +
    (omitted > 0
      ? `\n· …외 ${omitted}건 — get_all_tasks 로 나머지를 확인하세요`
      : "") +
    `\n(이미 처리 중인 항목이면 무시해도 됩니다. 같은 오케 세션에는 같은 항목을 다시 알리지 않습니다.)`
  );
}

export class OrchestratorBoardResync {
  private readonly deps: BoardResyncDeps;
  private readonly intervalMs: number;
  private readonly minAgeMs: number;
  private readonly orphanMinAgeMs: number;
  private readonly maxDigestItems: number;
  /** ptySessionId → 이 세션에 주입 성공한 key 집합. 세션이 갈리면 자연 리셋. */
  private seenBySession = new Map<string, Set<string>>();
  private timer: unknown = null;
  private ticking = false;

  constructor(deps: BoardResyncDeps) {
    this.deps = deps;
    this.intervalMs = deps.intervalMs ?? BOARD_RESYNC_DEFAULT_INTERVAL_MS;
    this.minAgeMs = deps.minAgeMs ?? BOARD_RESYNC_DEFAULT_MIN_AGE_MS;
    this.orphanMinAgeMs =
      deps.orphanMinAgeMs ?? BOARD_RESYNC_DEFAULT_ORPHAN_MIN_AGE_MS;
    this.maxDigestItems =
      deps.maxDigestItems ?? BOARD_RESYNC_DEFAULT_MAX_DIGEST_ITEMS;
  }

  start(): void {
    if (this.timer !== null) return;
    const schedule = this.deps.setInterval ?? setInterval;
    this.timer = schedule(() => {
      void this.tickOnce();
    }, this.intervalMs);
    // 프로덕션 타이머는 앱 종료를 막지 않는다(주입 안 한 기본 경로만).
    (this.timer as { unref?: () => void } | null)?.unref?.();
  }

  stop(): void {
    if (this.timer === null) return;
    const cancel =
      this.deps.clearInterval ??
      ((handle: unknown) => clearInterval(handle as NodeJS.Timeout));
    cancel(this.timer);
    this.timer = null;
  }

  /** 테스트/진단용 — 이 세션에 기록된 seen 키 수. */
  seenCount(ptySessionId: string): number {
    return this.seenBySession.get(ptySessionId)?.size ?? 0;
  }

  /**
   * 직접 알림이 오케 PTY 에 주입 성공했다는 브리지의 관찰
   * (BridgeServer.setNotifyDeliveredObserver). ★지금 running 인 세션에만
   * 기록한다 — 세션을 모르면 어느 오케가 봤는지 모르는 것이므로 기록하지
   * 않는다(잘못 mark 해 정당한 재통보를 삼키는 쪽이 더 나쁘다).
   */
  noteDirectDelivery(
    projectId: string,
    taskId: string | undefined,
    message: string,
  ): void {
    const keys = directDeliverySeenKeys(taskId, message);
    if (keys.length === 0) return;
    const session = this.deps.getOrchestratorSession(projectId);
    if (!session || session.status !== "running") return;
    let seen = this.seenBySession.get(session.ptySessionId);
    if (!seen) {
      seen = new Set<string>();
      this.seenBySession.set(session.ptySessionId, seen);
    }
    for (const key of keys) seen.add(key);
  }

  /**
   * 스위프 1회. ★절대 throw 하지 않는다. 프로젝트별 실패는 그 프로젝트만
   * 건너뛰고, 실패 사실은 logError 로 남긴다(조용한 실패 금지).
   */
  async tickOnce(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const projects = this.deps.listBoardOrchestratorProjects();
      if (projects.length === 0) return;

      let rows: ResyncTaskRow[];
      try {
        rows = await this.deps.listAttentionTasks();
      } catch (err) {
        this.error(
          `attention 티켓 조회 실패 — 이번 틱을 건너뜁니다: ${describe(err)}`,
        );
        return;
      }

      const liveSessionIds = new Set<string>();
      for (const projectId of projects) {
        try {
          await this.resyncProject(projectId, rows, liveSessionIds);
        } catch (err) {
          this.error(`project=${projectId} 재동기화 실패: ${describe(err)}`);
        }
      }
      // 죽은 세션의 seen 집합은 버린다 — 무한 증식 방지. 살아 있는 세션의
      // 집합만 유지하면 재시작 세션은 자동으로 빈 집합에서 시작한다.
      for (const sid of [...this.seenBySession.keys()]) {
        if (!liveSessionIds.has(sid)) this.seenBySession.delete(sid);
      }
    } finally {
      this.ticking = false;
    }
  }

  private async resyncProject(
    projectId: string,
    rows: readonly ResyncTaskRow[],
    liveSessionIds: Set<string>,
  ): Promise<void> {
    const session = this.deps.getOrchestratorSession(projectId);
    if (!session || session.status !== "running") return;
    liveSessionIds.add(session.ptySessionId);

    let seen = this.seenBySession.get(session.ptySessionId);
    if (!seen) {
      seen = new Set<string>();
      this.seenBySession.set(session.ptySessionId, seen);
    }

    const entries: ResyncAttentionEntry[] = [];
    for (const row of rows) {
      if (row.projectId !== projectId) continue;
      const kind = classifyResyncAttention(
        row,
        this.deps.isAgentAliveInFleet,
        this.minAgeMs,
        this.orphanMinAgeMs,
      );
      if (!kind) continue;
      const entry = { kind, row };
      if (seen.has(resyncSeenKey(entry))) continue;
      entries.push(entry);
    }

    let chainItems: ResyncChainReadyRow[] = [];
    try {
      chainItems = (await this.deps.listReadyChainItems(projectId)).filter(
        (item) => !seen.has(chainSeenKey(item)),
      );
    } catch (err) {
      // 체인 읽기 실패가 티켓 재동기화를 막으면 안 된다 — 티켓 축만이라도 민다.
      this.error(
        `project=${projectId} 워크체인 READY 조회 실패(티켓 축은 계속): ${describe(err)}`,
      );
    }

    if (entries.length === 0 && chainItems.length === 0) return;

    const message = buildBoardResyncDigest(
      entries,
      chainItems,
      this.maxDigestItems,
    );
    const injected = await this.deps.inject(projectId, message);
    if (!injected) {
      // seen 에 기록하지 않는다 → 다음 틱에 재시도. 실패는 기록한다.
      this.error(
        `project=${projectId} 다이제스트 주입 실패(${entries.length + chainItems.length}건) — 다음 틱에 재시도합니다`,
      );
      return;
    }
    for (const e of entries) seen.add(resyncSeenKey(e));
    for (const c of chainItems) seen.add(chainSeenKey(c));
    this.log(
      `project=${projectId} 재동기화 다이제스트 주입 완료: 티켓 ${entries.length}건, 체인 ${chainItems.length}건 (session=${session.ptySessionId})`,
    );
  }

  private log(message: string): void {
    (this.deps.log ?? ((m: string) => console.log(`[BoardResync] ${m}`)))(
      message,
    );
  }

  private error(message: string): void {
    (
      this.deps.logError ??
      ((m: string) => console.error(`[BoardResync] ${m}`))
    )(message);
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
