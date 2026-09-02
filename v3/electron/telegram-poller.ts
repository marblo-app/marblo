/**
 * telegram-poller — the electron-main-owned Telegram getUpdates poller.
 *
 * ★WHY THIS EXISTS (ticket vw38IB2VcmOIOlFV51Wa — "폴러를 오케에서 완전 분리")
 *
 * Telegram's getUpdates is SINGLE-CONSUMER per bot: only one long-poll may be
 * outstanding, and a second one evicts the first with HTTP 409. Previously the
 * poller ran INSIDE the orchestrator's claude session (`--channels
 * plugin:telegram` → `bun server.ts`), so every orchestrator churn (restart,
 * resume, handover, board+mission double-launch) spawned/killed a poller and
 * produced 409 flapping even in steady state. A per-project single-owner lock
 * (#298) narrowed but never closed the race, because the poller's lifecycle was
 * owned by claude's MCP host, not by Marblo.
 *
 * This module moves ownership to electron main: exactly ONE getUpdates loop per
 * project, whose lifecycle is Marblo's alone. No orchestrator carries
 * `--channels`. The loop:
 *   - self-heals a stray webhook on start (getWebhookInfo → deleteWebhook,
 *     drop_pending_updates=false) — webhook + getUpdates are mutually exclusive
 *     (a webhook 409-wedges getUpdates permanently);
 *   - long-polls getUpdates and routes each inbound message to the project's
 *     CURRENT live orchestrator (board wins over mission) via injectMessage;
 *   - is AT-LEAST-ONCE: when no orchestrator is live it does NOT advance the
 *     offset, so the message is redelivered once one boots;
 *   - persists the offset to disk so a restart resumes without reprocessing.
 *
 * Outbound (send_telegram_message MCP tool) routes back here via the bridge.
 *
 * Invariants: exactly one loop per project (duplicate-start guard); the bot
 * token NEVER appears in a log, error, or return value (scrubToken).
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  telegramApi,
  scrubToken,
  probeAndHealTelegramWebhook,
  TelegramHttpError,
  type TelegramApiOptions,
} from "./telegram-health";
import {
  listTelegramChannelConfigs,
  getTelegramChannelConfig,
  isTelegramChannelActive,
  getTelegramChannelAccess,
  neutralizeTelegramPluginConfig,
  getTelegramPluginStateDir,
  listTelegramChatIdSharers,
} from "./telegram-channels";
import { getTelegramProjectLabel } from "./telegram-channel-sync";
import { recordOwnerInbound } from "./mcp-server/owner-inbound";

// ─── Telegram update shapes (only the fields we read) ─────────────────────

interface TgChat {
  id: number | string;
}
interface TgFrom {
  id?: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}
interface TgMessage {
  chat?: TgChat;
  from?: TgFrom;
  text?: string;
}
interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

// ─── Deps (all injectable for tests; defaults hit the live channel store) ──

/** Minimal shape of a live orchestrator the poller injects inbound text into. */
export interface InboundTarget {
  injectMessage(text: string): Promise<boolean>;
  /**
   * Whether the orchestrator is still live. Diagnostics only; offset
   * advancement is based on injectMessage's actual write result.
   */
  isRunning?(): boolean;
  /** Token-free target metadata for handoff diagnostics and health. */
  describe?(): InboundTargetDescriptor;
  /**
   * Why the LAST injectMessage returned false, when the target can say.
   * Diagnostics only — never consulted for delivery decisions (the boolean is
   * still the whole truth about whether the write happened).
   *
   * ★This is the difference between "the orchestrator is gone" and "the
   * orchestrator is alive but its composer is blocked", which look identical
   * to the user (nothing arrives) and have opposite fixes.
   */
  describeInjectFailure?(): InjectFailureDescriptor | null;
}

export interface InboundTargetDescriptor {
  kind: string;
  ptySessionId: string | null;
  status: string;
}

/** Token-free, body-free reason a target refused the last injection. */
export interface InjectFailureDescriptor {
  /** Machine-readable refusal name (orchestrator-manager's InjectRefusal). */
  refusal: string;
  /** Composer verdict when the refusal came from the PTY write; else null. */
  composer: string | null;
  /** One human-readable line. */
  detail: string;
}

export interface TelegramPollerDeps {
  /**
   * Resolve the CURRENT live orchestrator for a project, or null when none is
   * running. Main wires this to "board if running, else mission if running".
   * When null the poller does NOT advance the offset — at-least-once delivery
   * so the message arrives after the next orchestrator boot.
   */
  resolveOrchestrator: (projectId: string) => InboundTarget | null;
  /** Active projects with a live Telegram channel. Default: channel store. */
  listActiveProjectIds?: () => string[];
  /** Bot token for a project (null ⇒ inactive, skip). Default: channel store. */
  getToken?: (projectId: string) => string | null;
  /** Default reply chatId (config chatId). Default: channel store. */
  getDefaultChatId?: (projectId: string) => string | null;
  /**
   * Inbound allowlist. Empty/undefined ⇒ allow all. Default: access store.
   * A message from a chatId not on a non-empty allowlist is dropped (offset
   * advanced) — inbound can trigger but must be from an authorized chat.
   */
  getAllowedChatIds?: (projectId: string) => string[];
  fetchImpl?: typeof fetch;
  /** Offset persistence file. Default ~/.marblo/telegram-poller-offsets.json */
  offsetFilePath?: string;
  /** getUpdates long-poll seconds (query `timeout`). Default 25. */
  longPollSeconds?: number;
  /** Sleep when no live orchestrator (offset held for redelivery), ms. Default 3000. */
  idleBackoffMs?: number;
  /** Sleep after a transient network/API error, ms. Default 5000. */
  errorBackoffMs?: number;
  /**
   * Un-replied nudge: after an inbound is injected, the poller waits for the
   * orchestrator to go idle (busy→quiet transition fed via
   * markOrchestratorActivity). This is the quiet window (ms) after the last
   * busy signal that counts as "turn ended". Default 6000.
   */
  nudgeIdleDebounceMs?: number;
  /**
   * Fallback for the nudge when NO activity signal ever arrives (orchestrator
   * already idle/stuck, or main didn't wire activity): the max time (ms) after
   * injection before the nudge check runs anyway. Default 120000.
   */
  nudgeMaxGraceMs?: number;
  /** Outbound sendMessage retries on network/5xx/429 (total = 1 + this). Default 2. */
  sendMaxRetries?: number;
  /** Base backoff (ms) for outbound retries; doubles each attempt. Default 500. */
  sendBackoffMs?: number;
  /**
   * ★How long an offset-hold may last before the OWNER is told, in ms.
   * Default 60000; <= 0 disables the notice.
   *
   * A held offset is correct (the message is not lost, it is waiting), but from
   * the phone it is indistinguishable from a dead app — which is the whole P1.
   * Outbound sendMessage does NOT go through the orchestrator PTY, so it still
   * works while inbound is blocked; that is the one channel left to say why it
   * is quiet. Exactly ONE notice per hold episode.
   */
  holdNotifyAfterMs?: number;
  /** Injectable sleep (tests capture wait durations / skip real delays). */
  sleepImpl?: (ms: number) => Promise<void>;
  /** Injectable logger (tests). Defaults to console. */
  logger?: Pick<Console, "log" | "warn" | "error">;
  /** Called when the registered poll-loop set changes. */
  onLoopActivityChange?: () => void;
  /**
   * Directory the official claude telegram plugin reads its state from
   * (`.env` with the bot token, `bot.pid` of a booted plugin poller). Used by
   * the 409 diagnosis to name the external holder. Default: channel store's
   * plugin dir (~/.claude/channels/telegram).
   */
  pluginStateDir?: string;
  /**
   * Startup cleanup of a bot token a past build materialized into the plugin
   * state dir (see telegram-channels neutralizePluginConfig). Default: the
   * channel store's neutralizer; injectable for tests.
   */
  neutralizePluginConfig?: () => { tokenRemoved: boolean };
  /** Min interval (ms) between full 409 diagnosis logs per project. Default 300000. */
  diag409ThrottleMs?: number;
  /**
   * Other ENABLED projects configured to send into the same chatId (channel
   * store's listChatIdSharers by default). Non-empty ⇒ replies from several
   * projects land in ONE chat, so outbound gets a `[project] ` prefix to tell
   * the orchestrators apart. Injectable for tests.
   */
  listChatIdSharers?: (projectId: string, chatId: string) => string[];
  /**
   * Human label for the outbound prefix (project name). Default: the
   * channel-sync label cache; null falls back to a short projectId.
   */
  getProjectLabel?: (projectId: string) => string | null;
}

/** Result of an outbound sendMessage — never carries the bot token. */
export interface SendResult {
  ok: boolean;
  /** chatId the message was sent to (echoed for confirmation). */
  chatId?: string;
  /** Token-scrubbed failure reason when ok=false. */
  error?: string;
}

/**
 * Per-project outbound/inbound reliability counters (spec C). Surfaced in the
 * 4-min health sweep so silent loss is visible in logs + the health channel.
 */
export interface ReliabilityStats {
  /** Inbound messages the orchestrator never replied to (after a nudge). */
  unanswered: number;
  /** Outbound sends that failed after all retries. */
  sendFailures: number;
}

/**
 * Why the poller is currently holding the offset instead of advancing it.
 *
 *   no-orchestrator — resolveOrchestrator returned null. Nothing is live to
 *                     receive the message. (Was the ONE completely silent
 *                     branch in this file before ticket c1R9C8v5MrBycZYSdTeB.)
 *   inject-refused  — an orchestrator IS live and injectMessage returned false.
 *                     The reason lives in `detail` (composer occupied, dialog
 *                     awaiting a choice, boot gate, mission change).
 *   inject-threw    — injectMessage threw.
 */
export type TelegramHoldReason =
  | "no-orchestrator"
  | "inject-refused"
  | "inject-threw";

/** A live offset-hold episode (one per project; cleared on first delivery). */
export interface TelegramHoldSnapshot {
  reason: TelegramHoldReason;
  /** The update the offset is pinned to. */
  updateId: number;
  since: number;
  /** How long the hold has lasted (ms), as of the snapshot. */
  heldMs: number;
  /** Redelivery attempts made during this episode. */
  attempts: number;
  /** Target-supplied refusal detail (inject-refused only); else null. */
  detail: InjectFailureDescriptor | null;
}

export interface TelegramRouteHealth {
  projectId: string;
  loopRunning: boolean;
  lastChatIdKnown: boolean;
  pendingReply: boolean;
  lastInboundAt: number | null;
  lastDeliveredUpdateId: number | null;
  lastDeliveredTarget: InboundTargetDescriptor | null;
  reliability: ReliabilityStats;
  /**
   * ★Loop liveness (ticket c1R9C8v5MrBycZYSdTeB). `loopRunning` only says the
   * handle is registered — it stays true for a loop wedged inside a stalled
   * fetch. These say whether the loop is actually TURNING: a getUpdates that
   * started and never completed, or a completion timestamp older than the
   * long-poll budget, is a stopped loop no matter what `loopRunning` claims.
   */
  lastPollStartedAt: number | null;
  lastPollCompletedAt: number | null;
  /** Consecutive getUpdates failures (network/API). Reset on any success. */
  consecutivePollErrors: number;
  lastPollErrorAt: number | null;
  /**
   * ★The other half of the same question: the loop turns fine but every
   * delivery is refused. Non-null ⇒ the offset is pinned right now.
   */
  hold: TelegramHoldSnapshot | null;
}

const DEFAULT_OFFSET_FILE = path.join(
  os.homedir(),
  ".marblo",
  "telegram-poller-offsets.json",
);
const DEFAULT_LONG_POLL_SECONDS = 25;
const DEFAULT_IDLE_BACKOFF_MS = 3000;
const DEFAULT_ERROR_BACKOFF_MS = 5000;
const DEFAULT_NUDGE_IDLE_DEBOUNCE_MS = 6000;
const DEFAULT_NUDGE_MAX_GRACE_MS = 120000;
const DEFAULT_SEND_MAX_RETRIES = 2;
const DEFAULT_SEND_BACKOFF_MS = 500;
const DEFAULT_DIAG_409_THROTTLE_MS = 300_000;
const DEFAULT_HOLD_NOTIFY_AFTER_MS = 60_000;
/** Repeat the "still holding" WARN at most this often per episode. */
const HOLD_LOG_THROTTLE_MS = 60_000;

/** Mutable half of {@link TelegramHoldSnapshot}. */
interface HoldState {
  reason: TelegramHoldReason;
  updateId: number;
  since: number;
  attempts: number;
  detail: InjectFailureDescriptor | null;
  /** Owner already told about THIS episode (max one notice per episode). */
  notified: boolean;
  /** Last time the "still holding" warning was logged. */
  lastLoggedAt: number;
}

/** Mutable half of the loop-liveness fields on {@link TelegramRouteHealth}. */
interface LoopStats {
  startedAt: number | null;
  completedAt: number | null;
  consecutiveErrors: number;
  lastErrorAt: number | null;
}

interface LoopHandle {
  /** Set true to ask the loop to exit at its next checkpoint. */
  stop: boolean;
  /** Resolves when the loop has fully exited. */
  done: Promise<void>;
}

/**
 * An inbound message injected into the orchestrator that is still awaiting a
 * send_telegram_message reply. Drives the one-shot un-replied nudge (spec A).
 */
interface PendingReply {
  updateId: number;
  /** Whether the one-shot reminder has already been injected (max 1/updateId). */
  nudged: boolean;
  /** Debounce timer: fires the idle check after the orchestrator goes quiet. */
  idleTimer: ReturnType<typeof setTimeout> | null;
  /** Fallback timer: fires the idle check even if no activity is ever seen. */
  maxTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Per-project getUpdates poller. One instance for the whole app (main owns it);
 * `syncActiveChannels()` reconciles running loops against the active channel
 * set, and `sendMessage()` is the outbound path the bridge routes into.
 */
export class TelegramPoller {
  private readonly deps: TelegramPollerDeps;
  private readonly loops = new Map<string, LoopHandle>();
  /** Last inbound chatId per project — default reply target for outbound. */
  private readonly lastChatId = new Map<string, string>();
  /** In-memory mirror of the persisted offset map (projectId → next offset). */
  private offsets: Record<string, number> = {};
  /** Inbound awaiting a reply, per project (un-replied nudge, spec A). */
  private readonly pendingReplies = new Map<string, PendingReply>();
  /** Per-project reliability counters (spec C). */
  private readonly stats = new Map<string, ReliabilityStats>();
  /** Last successful inbound delivery route, token-free for logs/health. */
  private readonly lastDelivered = new Map<
    string,
    {
      at: number;
      updateId: number;
      target: InboundTargetDescriptor;
    }
  >();
  /** Live offset-hold episode per project (see TelegramHoldSnapshot). */
  private readonly holds = new Map<string, HoldState>();
  /** Loop liveness per project (see TelegramRouteHealth's loop fields). */
  private readonly loopStats = new Map<string, LoopStats>();
  private readonly log: Pick<Console, "log" | "warn" | "error">;
  /** Last full-409-diagnosis time per project (throttles the loud log). */
  private readonly lastDiag409At = new Map<string, number>();
  /** Token-conflict groups already warned about (log once per set change). */
  private readonly warnedTokenConflicts = new Set<string>();

  constructor(deps: TelegramPollerDeps) {
    this.deps = deps;
    this.log = deps.logger ?? console;
  }

  // ── lifecycle ────────────────────────────────────────────────────────

  /** Load persisted offsets and start loops for all active channels. */
  start(): void {
    // A past build materialized the bot token into the claude plugin state dir
    // (~/.claude/channels/telegram/.env), which let ANY claude plugin host on
    // this machine (Cursor MCP, non-strict interactive sessions) boot its own
    // getUpdates poller with our token and 409-evict this one. Clean it up
    // before we start polling.
    try {
      const neutralize =
        this.deps.neutralizePluginConfig ?? neutralizeTelegramPluginConfig;
      if (neutralize().tokenRemoved) {
        this.log.warn(
          `[TelegramPoller] removed a stale bot token materialized in the claude ` +
            `telegram plugin state dir — external plugin pollers (Cursor/claude ` +
            `sessions) can no longer boot with our token and steal getUpdates. ` +
            `An already-running external poller keeps its token until it restarts.`,
        );
      }
    } catch {
      /* cleanup is best-effort; polling must start regardless */
    }
    this.loadOffsets();
    this.syncActiveChannels();
  }

  /**
   * Reconcile running loops against the current active-channel set: start a
   * loop for every newly-active project, stop loops whose channel went
   * inactive. Idempotent — safe to call on channel config changes, on
   * powerMonitor resume, and after each health sweep.
   *
   * ★Loops are deduped BY TOKEN, not just by project: Telegram getUpdates is
   * single-consumer per bot, so two projects (mis)configured with the same bot
   * token would 409-evict each other forever. The settings path blocks that at
   * save time (telegram-channels findTokenConflicts); this is the runtime
   * defense for legacy/hand-edited data — one deterministic winner polls, the
   * rest are held off with a loud diagnostic.
   */
  syncActiveChannels(): void {
    const byToken = new Map<string, string[]>();
    for (const projectId of this.listActiveProjectIds()) {
      const token = this.getToken(projectId);
      if (!token) continue; // no token → loop would exit immediately anyway
      const group = byToken.get(token);
      if (group) group.push(projectId);
      else byToken.set(token, [projectId]);
    }

    const active = new Set<string>();
    for (const [token, group] of byToken) {
      if (group.length === 1) {
        active.add(group[0]);
        continue;
      }
      // Same bot token on 2+ projects: exactly one may poll. Prefer a project
      // whose loop is already running (no churn), else the lexicographic first
      // (deterministic across restarts).
      const sorted = [...group].sort();
      const winner = sorted.find((p) => this.loops.has(p)) ?? sorted[0];
      active.add(winner);
      const signature = `${tokenHash(token)}:${sorted.join(",")}`;
      if (!this.warnedTokenConflicts.has(signature)) {
        this.warnedTokenConflicts.add(signature);
        this.log.warn(
          `[TelegramPoller] projects [${sorted.join(", ")}] share ONE bot token ` +
            `(hash=${tokenHash(token)}). Telegram getUpdates is single-consumer per ` +
            `bot, so only project=${winner} polls; the others get no inbound until ` +
            `each project is given its own bot in the Telegram channel settings.`,
        );
      }
    }

    for (const projectId of active) {
      if (!this.loops.has(projectId)) this.startLoop(projectId);
    }
    for (const projectId of [...this.loops.keys()]) {
      if (!active.has(projectId)) void this.stopLoop(projectId);
    }
  }

  /** Stop every loop (app quit / channel teardown). */
  async stopAll(): Promise<void> {
    await Promise.all([...this.loops.keys()].map((p) => this.stopLoop(p)));
  }

  private startLoop(projectId: string): void {
    // Duplicate-start guard: exactly one getUpdates loop per project (a second
    // long-poll would evict the first with 409 — the whole bug we're fixing).
    if (this.loops.has(projectId)) return;
    const handle: LoopHandle = { stop: false, done: Promise.resolve() };
    this.loops.set(projectId, handle);
    this.deps.onLoopActivityChange?.();
    handle.done = this.runLoop(projectId, handle).finally(() => {
      // Only delete if this exact handle is still the registered one (a
      // stop→restart could have replaced it).
      if (this.loops.get(projectId) === handle) {
        this.loops.delete(projectId);
        this.deps.onLoopActivityChange?.();
      }
    });
    this.log.log(`[TelegramPoller] started poll loop for project ${projectId}`);
  }

  private async stopLoop(projectId: string): Promise<void> {
    const handle = this.loops.get(projectId);
    if (!handle) return;
    handle.stop = true;
    this.loops.delete(projectId);
    this.deps.onLoopActivityChange?.();
    // Drop any pending-reply nudge timers for this project so they don't fire
    // (or keep the process alive) after the loop is gone.
    this.clearPendingReply(projectId);
    // The hold belongs to a running loop; a stopped loop is not "holding".
    this.holds.delete(projectId);
    try {
      await handle.done;
    } catch {
      /* loop already logged its own errors */
    }
    this.log.log(`[TelegramPoller] stopped poll loop for project ${projectId}`);
  }

  // ── the long-poll loop ───────────────────────────────────────────────

  private async runLoop(projectId: string, ctrl: LoopHandle): Promise<void> {
    const longPoll = this.deps.longPollSeconds ?? DEFAULT_LONG_POLL_SECONDS;
    const idleBackoff = this.deps.idleBackoffMs ?? DEFAULT_IDLE_BACKOFF_MS;
    const errorBackoff = this.deps.errorBackoffMs ?? DEFAULT_ERROR_BACKOFF_MS;
    // Abort must outlive the server-side long poll, or it fires mid-poll.
    const apiOpts: TelegramApiOptions = {
      fetchImpl: this.deps.fetchImpl,
      timeoutMs: (longPoll + 10) * 1000,
    };

    // Self-heal a stray webhook before polling: a registered webhook makes
    // getUpdates 409 permanently. drop_pending_updates=false keeps the backlog.
    const startToken = this.getToken(projectId);
    if (startToken) {
      try {
        const h = await probeAndHealTelegramWebhook(startToken, {
          fetchImpl: this.deps.fetchImpl,
        });
        if (h.webhookCleared) {
          this.log.warn(
            `[TelegramPoller] project=${projectId} cleared a stray webhook that was 409-wedging getUpdates.`,
          );
        }
      } catch {
        /* probe never throws; belt-and-suspenders */
      }
    }

    while (!ctrl.stop) {
      const token = this.getToken(projectId);
      if (!token) break; // channel deactivated → exit loop

      const offset = this.offsets[projectId];
      const params: Record<string, unknown> = {
        timeout: longPoll,
        allowed_updates: ["message"],
      };
      if (typeof offset === "number") params.offset = offset;

      let updates: TgUpdate[];
      this.notePollStarted(projectId);
      try {
        const resp = await telegramApi<TgUpdate[]>(
          token,
          "getUpdates",
          params,
          apiOpts,
        );
        this.notePollCompleted(projectId, resp.ok);
        if (!resp.ok) {
          this.log.warn(
            `[TelegramPoller] project=${projectId} getUpdates not ok: ${scrubToken(
              resp.description ?? "unknown",
              token,
            )}`,
          );
          await this.sleep(errorBackoff, ctrl);
          continue;
        }
        updates = Array.isArray(resp.result) ? resp.result : [];
      } catch (err) {
        this.notePollCompleted(projectId, false);
        const raw = err instanceof Error ? err.message : String(err);
        this.log.warn(
          `[TelegramPoller] project=${projectId} getUpdates error: ${scrubToken(
            raw,
            token,
          )}`,
        );
        // 409 means ANOTHER consumer holds this bot's getUpdates. Don't just
        // flap silently — say who is plausibly holding it (throttled).
        if (err instanceof TelegramHttpError && err.status === 409) {
          this.maybeDiagnose409(projectId, token);
        }
        await this.sleep(errorBackoff, ctrl);
        continue;
      }

      if (updates.length === 0) continue; // long poll timed out empty

      for (const update of updates) {
        if (ctrl.stop) break;
        const delivered = await this.handleUpdate(projectId, update);
        if (!delivered) {
          // No live orchestrator (or inject failed): DO NOT advance past this
          // update. Sleep, then the outer loop re-fetches the same batch —
          // at-least-once delivery once an orchestrator comes online.
          // ★handleUpdate has already named the hold (noteHold) — that naming
          // is what makes "loop stopped" and "loop turning, injection refused"
          // tellable apart after the fact. The hold ITSELF is unchanged.
          await this.sleep(idleBackoff, ctrl);
          break;
        }
        // The update is consumed (delivered, or dropped as non-actionable /
        // unauthorized) — any hold pinned to it is over.
        this.clearHold(projectId, update.update_id);
        this.setOffset(projectId, update.update_id + 1);
      }
    }
  }

  // ── 409 diagnosis ────────────────────────────────────────────────────

  /**
   * A getUpdates 409 means some OTHER consumer is long-polling this bot. Log
   * one actionable, token-free diagnosis naming the plausible holders instead
   * of an endless bare "HTTP 409" flap. Throttled per project because the 409
   * recurs every errorBackoff while the conflict persists. Holders checked:
   *   1. another Marblo project configured with the same bot token (runtime
   *      dedup in syncActiveChannels should prevent this; named if seen);
   *   2. an external claude/Cursor telegram plugin poller booted from the
   *      plugin state dir's .env (token match + bot.pid liveness);
   *   3. a registered webhook (self-healed by the start probe; mentioned so
   *      the reader knows it's already covered).
   */
  private maybeDiagnose409(projectId: string, token: string): void {
    const throttle = this.deps.diag409ThrottleMs ?? DEFAULT_DIAG_409_THROTTLE_MS;
    const last = this.lastDiag409At.get(projectId) ?? 0;
    const nowMs = Date.now();
    if (nowMs - last < throttle) return;
    this.lastDiag409At.set(projectId, nowMs);

    const parts: string[] = [];

    // (1) another Marblo project sharing this token.
    let sameTokenProjects: string[] = [];
    try {
      sameTokenProjects = this.listActiveProjectIds().filter(
        (p) => p !== projectId && this.getToken(p) === token,
      );
    } catch {
      /* diagnosis is best-effort */
    }
    parts.push(
      sameTokenProjects.length > 0
        ? `another Marblo project shares this bot token: [${sameTokenProjects
            .sort()
            .join(", ")}] — give each project its own bot in the Telegram channel settings`
        : `no other Marblo project uses this token`,
    );

    // (2) external plugin poller booted from the plugin state dir.
    const pluginDir = this.pluginStateDir();
    const holder = probePluginHolder(pluginDir, token);
    if (holder.tokenMatch) {
      const pid =
        holder.pid !== null
          ? `pid=${holder.pid} (${holder.pidAlive ? "ALIVE" : "dead"})`
          : "pid unknown";
      parts.push(
        `the claude telegram plugin state dir (${pluginDir}) holds THIS bot's token, ` +
          `${pid} — an external plugin poller (Cursor MCP / a non-strict claude session) ` +
          `is likely polling with our token; remove the telegram plugin/MCP entry from ` +
          `that host or stop that process. Marblo no longer writes this token and cleans ` +
          `it on startup, but a poller that already booted keeps it until restarted`,
      );
    } else {
      parts.push(
        `plugin state dir (${pluginDir}) does not hold this token` +
          (holder.pid !== null && holder.pidAlive
            ? ` (but a plugin poller pid=${holder.pid} is alive — with a different/older token)`
            : ``),
      );
    }

    this.log.warn(
      `[TelegramPoller] project=${projectId} getUpdates 409 diagnosis — Telegram ` +
        `allows exactly ONE getUpdates consumer per bot (token hash=${tokenHash(token)}), ` +
        `and someone else holds it. ${parts.join(". ")}. ` +
        `(A registered webhook also 409s getUpdates; the start-time probe auto-heals that case.)`,
    );
  }

  private pluginStateDir(): string {
    if (this.deps.pluginStateDir) return this.deps.pluginStateDir;
    try {
      return getTelegramPluginStateDir();
    } catch {
      return path.join(os.homedir(), ".claude", "channels", "telegram");
    }
  }

  /**
   * Route a single update to the live orchestrator. Returns true when the
   * update is CONSUMED (advance the offset) — including drops (no text /
   * unauthorized chat / non-message), which are intentionally skipped, not
   * redelivered. Returns false ONLY when there is no live orchestrator to
   * receive an actionable message (hold the offset for redelivery).
   */
  private async handleUpdate(
    projectId: string,
    update: TgUpdate,
  ): Promise<boolean> {
    const msg = update.message;
    const chatId = msg?.chat?.id != null ? String(msg.chat.id) : null;
    const text = typeof msg?.text === "string" ? msg.text : null;
    // Nothing actionable (service message, non-text, or malformed) → consume.
    if (!chatId || !text) return true;

    // Authorization: a non-empty allowlist gates which chats may drive the
    // orchestrator. Unauthorized inbound is dropped (consumed), never injected.
    const allowed = this.getAllowedChatIds(projectId);
    if (allowed.length > 0 && !allowed.includes(chatId)) {
      this.log.warn(
        `[TelegramPoller] project=${projectId} dropping inbound from unauthorized chat ${chatId}.`,
      );
      return true;
    }

    const orch = this.deps.resolveOrchestrator(projectId);
    if (!orch) {
      // ★This branch used to return false with NO log at all — the single
      // most invisible way for the boss's remote channel to go quiet.
      this.noteHold(projectId, update.update_id, "no-orchestrator", null);
      return false; // hold offset — redeliver after next boot
    }

    const from = this.formatFrom(msg?.from);
    const injected =
      `[Telegram inbound from ${from}]: ${text}\n\n` +
      `이 프로젝트의 텔레그램 채널로 사용자가 보낸 메시지입니다. 텔레그램으로 답장하려면 ` +
      `marblo MCP 의 send_telegram_message 도구를 호출하세요(projectId="${projectId}"). ` +
      `도구를 호출하지 않고 일반 텍스트로만 답하면 사용자에게 전달되지 않습니다.`;

    try {
      const wrote = await orch.injectMessage(injected);
      if (!wrote) {
        this.noteHold(
          projectId,
          update.update_id,
          "inject-refused",
          describeInjectFailure(orch),
        );
        return false;
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      this.noteHold(projectId, update.update_id, "inject-threw", {
        refusal: "threw",
        composer: null,
        detail: raw,
      });
      return false; // hold offset — retry delivery
    }
    // ★Owner-inbound journal (ticket wx9c4NeVtZ1SGcbEISpg). The MCP server has
    // NO other way to see what the owner said — the four work-chain capture
    // surfaces are all orchestrator-authored text, which is exactly why owner
    // missions never landed in the chain. Recorded ONLY after a confirmed
    // delivery, and never in a way that can affect delivery: the write is
    // awaited but its failure is logged and dropped, and the offset advance
    // below does not depend on it.
    try {
      await recordOwnerInbound({
        key: `telegram:${projectId}:${update.update_id}`,
        projectId,
        channel: "telegram",
        from,
        text,
        at: Date.now(),
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      this.log.warn(
        // fs 오류라 토큰이 낄 자리가 없다(같은 함수의 injectMessage catch 와 동일).
        `[TelegramPoller] project=${projectId} owner-inbound journal write failed: ${raw}`,
      );
    }
    // Only remember the chat once we actually delivered — this becomes the
    // default outbound reply target.
    this.lastChatId.set(projectId, chatId);
    const target = describeTarget(orch);
    this.lastDelivered.set(projectId, {
      at: Date.now(),
      updateId: update.update_id,
      target,
    });
    this.log.log(
      `[TelegramPoller] project=${projectId} delivered inbound update ${update.update_id} to ${target.kind} pty=${target.ptySessionId ?? "unknown"} status=${target.status}; lastChatIdKnown=true.`,
    );
    // Track this inbound as awaiting a send_telegram_message reply so we can
    // nudge the orchestrator once if it finishes its turn without answering.
    this.armReplyTracking(projectId, update.update_id);
    return true;
  }

  // ── un-replied nudge (spec A) ─────────────────────────────────────────
  //
  // After an inbound is delivered we wait for the orchestrator to finish its
  // turn (busy→idle transition, fed by markOrchestratorActivity). If it went
  // idle without calling send_telegram_message (which clears the pending entry),
  // we inject ONE reminder. If the next idle still shows no reply, we count it
  // as unanswered (spec C) and stop — max one nudge per updateId, no loop.

  /** Begin tracking an injected inbound as awaiting a reply. */
  private armReplyTracking(projectId: string, updateId: number): void {
    // A newer inbound supersedes an older un-answered one — the latest message
    // is what needs a reply. Clear any prior pending (and its timers) first.
    this.clearPendingReply(projectId);
    const pending: PendingReply = {
      updateId,
      nudged: false,
      idleTimer: null,
      maxTimer: this.armTimer(this.nudgeMaxGraceMs(), () =>
        this.onOrchestratorIdle(projectId),
      ),
    };
    this.pendingReplies.set(projectId, pending);
  }

  /**
   * Feed an orchestrator "busy" signal for a project (main calls this from the
   * orchestrator PTY output filtered by isBusySignal). While an inbound is
   * awaiting a reply, each busy signal (re)arms a quiet-window debounce; when
   * the window elapses with no further activity, the turn is treated as ended.
   */
  markOrchestratorActivity(projectId: string): void {
    const pending = this.pendingReplies.get(projectId);
    if (!pending) return; // nothing awaiting a reply → cheap no-op
    if (pending.idleTimer) clearTimeout(pending.idleTimer);
    pending.idleTimer = this.armTimer(this.nudgeIdleDebounceMs(), () =>
      this.onOrchestratorIdle(projectId),
    );
  }

  /** The orchestrator's turn ended — nudge once, or count as unanswered. */
  private onOrchestratorIdle(projectId: string): void {
    const pending = this.pendingReplies.get(projectId);
    if (!pending) return; // already resolved (a reply cleared it) or stopped
    // Stop both timers; we either nudge (re-arm below) or finish here.
    if (pending.idleTimer) clearTimeout(pending.idleTimer);
    if (pending.maxTimer) clearTimeout(pending.maxTimer);
    pending.idleTimer = null;
    pending.maxTimer = null;

    if (!pending.nudged) {
      const orch = this.deps.resolveOrchestrator(projectId);
      if (!orch) {
        // No live orchestrator to remind — count as unanswered and stop.
        this.bumpUnanswered(projectId);
        this.pendingReplies.delete(projectId);
        return;
      }
      pending.nudged = true;
      const reminder =
        `위 텔레그램 메시지에 아직 답하지 않았습니다. 답할 내용이 있으면 ` +
        `marblo MCP 의 send_telegram_message 도구를 호출해 답장하세요(projectId="${projectId}"). ` +
        `답이 필요 없으면 무시해도 됩니다.`;
      void Promise.resolve(orch.injectMessage(reminder))
        .then((wrote) => {
          if (!wrote) {
            this.log.warn(
              `[TelegramPoller] project=${projectId} nudge injectMessage did not write to a live PTY`,
            );
          }
        })
        .catch((err) => {
          const raw = err instanceof Error ? err.message : String(err);
          this.log.warn(
            `[TelegramPoller] project=${projectId} nudge injectMessage failed: ${raw}`,
          );
        });
      this.log.log(
        `[TelegramPoller] project=${projectId} nudged orchestrator to reply to inbound update ${pending.updateId}.`,
      );
      // Re-arm the fallback so a second idle-with-no-reply is counted.
      pending.maxTimer = this.armTimer(this.nudgeMaxGraceMs(), () =>
        this.onOrchestratorIdle(projectId),
      );
      return;
    }

    // Already nudged and still no reply → unanswered. No silent loss (spec C).
    this.bumpUnanswered(projectId);
    this.log.warn(
      `[TelegramPoller] project=${projectId} inbound update ${pending.updateId} went unanswered after a nudge.`,
    );
    this.pendingReplies.delete(projectId);
  }

  /** Clear any pending-reply tracking + timers for a project. */
  private clearPendingReply(projectId: string): void {
    const pending = this.pendingReplies.get(projectId);
    if (!pending) return;
    if (pending.idleTimer) clearTimeout(pending.idleTimer);
    if (pending.maxTimer) clearTimeout(pending.maxTimer);
    this.pendingReplies.delete(projectId);
  }

  private armTimer(ms: number, fn: () => void): ReturnType<typeof setTimeout> {
    const t = setTimeout(fn, ms);
    // Never let a nudge timer keep the process alive on quit.
    t.unref?.();
    return t;
  }

  // ── outbound (send_telegram_message MCP tool → bridge → here) ─────────

  /**
   * Send an outbound Telegram message. chatId defaults to the last inbound
   * chat for the project, then the configured chatId. NEVER returns or logs
   * the bot token (errors are scrubbed).
   */
  async sendMessage(
    projectId: string,
    text: string,
    chatId?: string,
  ): Promise<SendResult> {
    // The orchestrator is replying → cancel the un-replied nudge for this
    // project. Do this even if the send below fails: the orch DID answer; a
    // delivery failure is a separate concern (counted as a send failure).
    this.clearPendingReply(projectId);
    return this.deliverMessage(projectId, text, chatId, true);
  }

  /**
   * The wire half of {@link sendMessage}, without the "an orchestrator just
   * replied" side effects.
   *
   * ★Split out for the hold notice (maybeNotifyHold): that message is OUR
   * diagnostic, not the orchestrator answering, so it must not cancel a
   * pending-reply nudge and its failures must not land in the reliability
   * counters the owner reads as "the orchestrator's replies got lost".
   */
  private async deliverMessage(
    projectId: string,
    text: string,
    chatId: string | undefined,
    countFailures: boolean,
  ): Promise<SendResult> {
    const token = this.getToken(projectId);
    if (!token) {
      return {
        ok: false,
        error: `no active Telegram channel for project "${projectId}"`,
      };
    }
    const target =
      (chatId && chatId.trim()) ||
      this.lastChatId.get(projectId) ||
      this.getDefaultChatId(projectId);
    if (!target) {
      return {
        ok: false,
        error:
          "no chatId available — pass chatId explicitly or wait for an inbound message first",
      };
    }
    if (!text || !text.trim()) {
      return { ok: false, error: "message text is empty" };
    }

    // chatId 공유 구분 접두: 같은 대화방으로 발신하는 다른 활성 프로젝트가
    // 있으면 어느 프로젝트(오케)의 응답인지 구분할 수 없다 — `[프로젝트명] `
    // 접두를 자동 부착한다. 공유가 없으면 원문 그대로(단일 프로젝트 무회귀).
    const outboundText = this.chatIdSharers(projectId, target).length
      ? `[${this.projectLabel(projectId)}] ${text}`
      : text;

    const maxRetries = this.deps.sendMaxRetries ?? DEFAULT_SEND_MAX_RETRIES;
    const baseBackoff = this.deps.sendBackoffMs ?? DEFAULT_SEND_BACKOFF_MS;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const resp = await telegramApi(
          token,
          "sendMessage",
          { chat_id: target, text: outboundText },
          { fetchImpl: this.deps.fetchImpl },
        );
        if (!resp.ok) {
          // ok:false on a 2xx is a non-retryable application error.
          if (countFailures) this.bumpSendFailure(projectId);
          return {
            ok: false,
            error: scrubToken(resp.description ?? "sendMessage failed", token),
          };
        }
        return { ok: true, chatId: target };
      } catch (err) {
        const retriable = isRetriableSendError(err);
        if (attempt < maxRetries && retriable) {
          const waitMs = retryWaitMs(err, baseBackoff, attempt);
          this.log.warn(
            `[TelegramPoller] project=${projectId} sendMessage attempt ${
              attempt + 1
            }/${maxRetries + 1} failed (${scrubToken(
              err instanceof Error ? err.message : String(err),
              token,
            )}); retrying in ${waitMs}ms`,
          );
          await this.delay(waitMs);
          continue;
        }
        // Final failure — surface an explicit, token-scrubbed error and count it.
        if (countFailures) this.bumpSendFailure(projectId);
        const raw = err instanceof Error ? err.message : String(err);
        return { ok: false, error: scrubToken(raw, token) };
      }
    }
    // Unreachable (loop always returns), but satisfies the type checker.
    if (countFailures) this.bumpSendFailure(projectId);
    return { ok: false, error: "sendMessage exhausted retries" };
  }

  /** Per-project reliability counters (spec C). Defaults to zeros. */
  getReliabilityStats(projectId: string): ReliabilityStats {
    return { ...(this.stats.get(projectId) ?? emptyStats()) };
  }

  /**
   * Token-free health snapshot for switch/takeover diagnostics. This lets the
   * switch path prove which PTY will receive Telegram inbound without exposing
   * bot credentials or chat contents.
   */
  getRouteHealth(projectId: string): TelegramRouteHealth {
    const delivered = this.lastDelivered.get(projectId);
    const loop = this.loopStats.get(projectId);
    return {
      projectId,
      loopRunning: this.loops.has(projectId),
      lastChatIdKnown: this.lastChatId.has(projectId),
      pendingReply: this.pendingReplies.has(projectId),
      lastInboundAt: delivered?.at ?? null,
      lastDeliveredUpdateId: delivered?.updateId ?? null,
      lastDeliveredTarget: delivered?.target ?? null,
      reliability: this.getReliabilityStats(projectId),
      lastPollStartedAt: loop?.startedAt ?? null,
      lastPollCompletedAt: loop?.completedAt ?? null,
      consecutivePollErrors: loop?.consecutiveErrors ?? 0,
      lastPollErrorAt: loop?.lastErrorAt ?? null,
      hold: this.holdSnapshot(projectId),
    };
  }

  /**
   * The sampler's iteration set: every project that SHOULD have a loop, plus
   * every project that currently has one.
   *
   * ★It is deliberately not just `this.loops.keys()`. A project whose loop died
   * or never started is exactly the case we most need a sample for — iterating
   * only over live loops would make "loop-stopped" invisible in the time series,
   * which is the same blind spot this ticket exists to close.
   */
  activeProjectIds(): string[] {
    const ids = new Set<string>(this.loops.keys());
    for (const projectId of this.listActiveProjectIds()) ids.add(projectId);
    return [...ids];
  }

  // ── loop liveness + offset-hold bookkeeping ──────────────────────────
  //
  // ★Why both, and why they are separate (ticket c1R9C8v5MrBycZYSdTeB).
  // "텔레그램이 안 들어온다" has two opposite causes that look identical from
  // the phone: the loop is not turning (network/throttle/wedge), or the loop
  // turns fine and every delivery is refused (composer blocked, no orch).
  // `loopRunning` alone cannot tell them apart — it is true for a wedged loop.
  // So the loop records that it turned, and the hold records that it could not
  // hand off. A sample carrying both settles the question after the fact.

  private loopStatsFor(projectId: string): LoopStats {
    let st = this.loopStats.get(projectId);
    if (!st) {
      st = {
        startedAt: null,
        completedAt: null,
        consecutiveErrors: 0,
        lastErrorAt: null,
      };
      this.loopStats.set(projectId, st);
    }
    return st;
  }

  private notePollStarted(projectId: string): void {
    this.loopStatsFor(projectId).startedAt = Date.now();
  }

  private notePollCompleted(projectId: string, ok: boolean): void {
    const st = this.loopStatsFor(projectId);
    st.completedAt = Date.now();
    if (ok) {
      st.consecutiveErrors = 0;
    } else {
      st.consecutiveErrors += 1;
      st.lastErrorAt = st.completedAt;
    }
  }

  /**
   * Record that the offset is being held on `updateId`, and why.
   *
   * ★The hold semantics are NOT touched here — the caller still returns false
   * and the offset still does not advance, so nothing is ever lost. This only
   * gives the hold a name, a start time, and an attempt count.
   */
  private noteHold(
    projectId: string,
    updateId: number,
    reason: TelegramHoldReason,
    detail: InjectFailureDescriptor | null,
  ): void {
    const now = Date.now();
    const existing = this.holds.get(projectId);
    if (existing && existing.updateId === updateId) {
      existing.attempts += 1;
      existing.reason = reason;
      existing.detail = detail;
      // The redelivery attempt repeats every idleBackoff (3s by default), so
      // logging each one buries the log. Say it on entry, then once a minute
      // WITH the elapsed time — a hold's duration is the diagnostic.
      if (now - existing.lastLoggedAt >= HOLD_LOG_THROTTLE_MS) {
        existing.lastLoggedAt = now;
        this.log.warn(
          `[TelegramPoller] project=${projectId} STILL holding offset at update ` +
            `${updateId} after ${Math.round((now - existing.since) / 1000)}s ` +
            `(${existing.attempts} attempts) — ${holdLine(reason, detail)}`,
        );
      }
    } else {
      this.holds.set(projectId, {
        reason,
        updateId,
        since: now,
        attempts: 1,
        detail,
        notified: false,
        lastLoggedAt: now,
      });
      this.log.warn(
        `[TelegramPoller] project=${projectId} holding offset at update ${updateId} ` +
          `for redelivery — ${holdLine(reason, detail)}`,
      );
    }
    this.maybeNotifyHold(projectId);
  }

  /** The hold on `updateId` is over (it was consumed). */
  private clearHold(projectId: string, updateId: number): void {
    const hold = this.holds.get(projectId);
    if (!hold || hold.updateId !== updateId) return;
    this.holds.delete(projectId);
    this.log.log(
      `[TelegramPoller] project=${projectId} hold released at update ${updateId} ` +
        `after ${Math.round((Date.now() - hold.since) / 1000)}s ` +
        `(${hold.attempts} attempts, reason=${hold.reason}).`,
    );
  }

  private holdSnapshot(projectId: string): TelegramHoldSnapshot | null {
    const hold = this.holds.get(projectId);
    if (!hold) return null;
    return {
      reason: hold.reason,
      updateId: hold.updateId,
      since: hold.since,
      heldMs: Date.now() - hold.since,
      attempts: hold.attempts,
      detail: hold.detail ? { ...hold.detail } : null,
    };
  }

  /**
   * Tell the owner, ONCE per hold episode, that the message arrived but is
   * parked — and why. Outbound does not go through the orchestrator PTY, so it
   * still works while inbound is blocked; without this, a blocked composer is
   * indistinguishable from a dead app to someone holding a phone.
   */
  private maybeNotifyHold(projectId: string): void {
    const after = this.deps.holdNotifyAfterMs ?? DEFAULT_HOLD_NOTIFY_AFTER_MS;
    if (after <= 0) return;
    const hold = this.holds.get(projectId);
    if (!hold || hold.notified) return;
    if (Date.now() - hold.since < after) return;
    hold.notified = true;
    const text =
      `⚠️ 방금 보내신 메시지는 도착했지만 아직 오케스트레이터에 전달하지 못했습니다 ` +
      `(${Math.round((Date.now() - hold.since) / 1000)}초째 보류 중).\n` +
      `사유: ${holdOwnerReason(hold.reason, hold.detail)}\n` +
      `메시지는 유실되지 않았습니다 — 막힘이 풀리면 자동으로 전달됩니다.`;
    // Diagnostic notice: never counted as a reply-carrying send, and its own
    // failure must not touch the reliability counters the owner reads.
    void this.deliverMessage(projectId, text, undefined, false).then((res) => {
      if (!res.ok) {
        this.log.warn(
          `[TelegramPoller] project=${projectId} hold notice could not be sent: ${res.error}`,
        );
      }
    });
  }

  private bumpUnanswered(projectId: string): void {
    const s = this.stats.get(projectId) ?? emptyStats();
    s.unanswered += 1;
    this.stats.set(projectId, s);
  }

  private bumpSendFailure(projectId: string): void {
    const s = this.stats.get(projectId) ?? emptyStats();
    s.sendFailures += 1;
    this.stats.set(projectId, s);
  }

  private delay(ms: number): Promise<void> {
    if (this.deps.sleepImpl) return this.deps.sleepImpl(ms);
    return new Promise((r) => setTimeout(r, ms));
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private formatFrom(from: TgFrom | undefined): string {
    if (!from) return "unknown";
    if (from.username) return `@${from.username}`;
    const name = [from.first_name, from.last_name].filter(Boolean).join(" ");
    return name || "unknown";
  }

  private listActiveProjectIds(): string[] {
    if (this.deps.listActiveProjectIds) return this.deps.listActiveProjectIds();
    try {
      return listTelegramChannelConfigs()
        .filter((c) => c.botToken && isTelegramChannelActive(c.projectId))
        .map((c) => c.projectId);
    } catch {
      return [];
    }
  }

  private getToken(projectId: string): string | null {
    if (this.deps.getToken) return this.deps.getToken(projectId);
    if (!isTelegramChannelActive(projectId)) return null;
    return getTelegramChannelConfig(projectId)?.botToken ?? null;
  }

  private getDefaultChatId(projectId: string): string | null {
    if (this.deps.getDefaultChatId)
      return this.deps.getDefaultChatId(projectId);
    return getTelegramChannelConfig(projectId)?.chatId ?? null;
  }

  private getAllowedChatIds(projectId: string): string[] {
    if (this.deps.getAllowedChatIds)
      return this.deps.getAllowedChatIds(projectId);
    try {
      return getTelegramChannelAccess(projectId)?.allowedChatIds ?? [];
    } catch {
      return [];
    }
  }

  /** Other enabled projects sending into the same chat (prefix trigger). */
  private chatIdSharers(projectId: string, chatId: string): string[] {
    if (this.deps.listChatIdSharers)
      return this.deps.listChatIdSharers(projectId, chatId);
    try {
      return listTelegramChatIdSharers(projectId, chatId);
    } catch {
      return [];
    }
  }

  /** Outbound prefix label — project name, else a short projectId stub. */
  private projectLabel(projectId: string): string {
    try {
      const label =
        this.deps.getProjectLabel?.(projectId) ??
        getTelegramProjectLabel(projectId);
      if (label && label.trim()) return label.trim();
    } catch {
      /* label lookup is cosmetic — fall through to the stub */
    }
    return projectId.slice(0, 8);
  }

  private nudgeIdleDebounceMs(): number {
    return this.deps.nudgeIdleDebounceMs ?? DEFAULT_NUDGE_IDLE_DEBOUNCE_MS;
  }

  private nudgeMaxGraceMs(): number {
    return this.deps.nudgeMaxGraceMs ?? DEFAULT_NUDGE_MAX_GRACE_MS;
  }

  private async sleep(ms: number, ctrl: LoopHandle): Promise<void> {
    if (ctrl.stop) return;
    await this.delay(ms);
  }

  // ── offset persistence ───────────────────────────────────────────────

  private offsetFile(): string {
    return this.deps.offsetFilePath ?? DEFAULT_OFFSET_FILE;
  }

  private loadOffsets(): void {
    try {
      const raw = fs.readFileSync(this.offsetFile(), "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const out: Record<string, number> = {};
        for (const [k, v] of Object.entries(
          parsed as Record<string, unknown>,
        )) {
          if (typeof v === "number") out[k] = v;
        }
        this.offsets = out;
      }
    } catch {
      // Missing/corrupt → start fresh (Telegram redelivers unacked updates).
      this.offsets = {};
    }
  }

  private setOffset(projectId: string, offset: number): void {
    this.offsets[projectId] = offset;
    try {
      const file = this.offsetFile();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.offsets, null, 2), "utf-8");
      fs.renameSync(tmp, file);
    } catch (err) {
      // Non-fatal: a failed persist only risks reprocessing on restart.
      this.log.warn(
        `[TelegramPoller] failed to persist offset for ${projectId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // ── test/introspection hooks ─────────────────────────────────────────

  /** True if a poll loop is currently registered for the project (tests). */
  hasLoop(projectId: string): boolean {
    return this.loops.has(projectId);
  }

  /** True if any project currently has a registered poll loop. */
  hasActiveLoops(): boolean {
    return this.loops.size > 0;
  }

  /** Last inbound chatId recorded for the project, or undefined (tests). */
  getLastChatId(projectId: string): string | undefined {
    return this.lastChatId.get(projectId);
  }

  /** True if an inbound is awaiting a reply for the project (tests). */
  hasPendingReply(projectId: string): boolean {
    return this.pendingReplies.has(projectId);
  }
}

// ─── module helpers (pure — unit-testable, no state) ──────────────────────

function emptyStats(): ReliabilityStats {
  return { unanswered: 0, sendFailures: 0 };
}

/** Short, log-safe fingerprint of a bot token (never the token itself). */
function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 8);
}

/** What the claude telegram plugin state dir says about who holds the bot. */
interface PluginHolderInfo {
  /** The plugin .env holds exactly this bot's token. */
  tokenMatch: boolean;
  /** bot.pid contents (a booted plugin poller records its pid there). */
  pid: number | null;
  /** Whether that pid is a live process right now. */
  pidAlive: boolean;
}

/**
 * Best-effort, read-only probe of the claude telegram plugin state dir for the
 * 409 diagnosis: does its .env hold THIS bot's token, and is the plugin poller
 * whose pid is recorded in bot.pid still alive? Never throws; never returns
 * secret material.
 */
function probePluginHolder(dir: string, token: string): PluginHolderInfo {
  const info: PluginHolderInfo = { tokenMatch: false, pid: null, pidAlive: false };
  try {
    const raw = fs.readFileSync(path.join(dir, ".env"), "utf-8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^TELEGRAM_BOT_TOKEN=(.*)$/);
      if (m && m[1].trim() === token) info.tokenMatch = true;
    }
  } catch {
    /* no .env → no plugin holder */
  }
  try {
    const pid = parseInt(
      fs.readFileSync(path.join(dir, "bot.pid"), "utf-8").trim(),
      10,
    );
    if (Number.isFinite(pid) && pid > 0) {
      info.pid = pid;
      try {
        process.kill(pid, 0);
        info.pidAlive = true;
      } catch (err) {
        // EPERM = alive but not ours; ESRCH = dead.
        info.pidAlive =
          (err as NodeJS.ErrnoException | null)?.code === "EPERM";
      }
    }
  } catch {
    /* no bot.pid */
  }
  return info;
}

/**
 * Ask the target why its last injection was refused. Optional and best-effort:
 * a target that cannot say returns null, and a throwing one must never break
 * delivery bookkeeping — this is diagnostics, not control flow.
 */
function describeInjectFailure(
  target: InboundTarget,
): InjectFailureDescriptor | null {
  try {
    return target.describeInjectFailure?.() ?? null;
  } catch {
    return null;
  }
}

/** One log line naming a hold. Carries no message body and no credentials. */
function holdLine(
  reason: TelegramHoldReason,
  detail: InjectFailureDescriptor | null,
): string {
  if (reason === "no-orchestrator") {
    return "no live orchestrator for this project (loop is turning; nothing to hand off to)";
  }
  const suffix = detail
    ? `refusal=${detail.refusal}${
        detail.composer ? ` composer=${detail.composer}` : ""
      } — ${detail.detail}`
    : "the target could not say why";
  return reason === "inject-threw"
    ? `injectMessage threw: ${suffix}`
    : `orchestrator IS live but injectMessage refused: ${suffix}`;
}

/** The same reason, phrased for the owner's phone (Korean, no internals). */
function holdOwnerReason(
  reason: TelegramHoldReason,
  detail: InjectFailureDescriptor | null,
): string {
  if (reason === "no-orchestrator") {
    return "이 프로젝트의 오케스트레이터가 실행 중이 아닙니다 — 마블로에서 오케를 켜 주세요.";
  }
  if (detail?.composer === "occupied") {
    return (
      "오케스트레이터 터미널 입력창에 제출되지 않은 글이 남아 있습니다. " +
      "남의 초안을 지우거나 대신 제출하지 않으므로, 그 줄을 제출하거나 지우면 풀립니다."
    );
  }
  if (detail?.composer === "awaiting-choice") {
    return (
      "오케스트레이터 터미널이 확인 다이얼로그([y/n]) 앞에서 대기 중입니다. " +
      "지금 쓰면 첫 글자가 선택으로 소비되므로 쓰지 않습니다. 다이얼로그에 답하면 풀립니다."
    );
  }
  return `오케스트레이터가 지금 입력을 받을 수 없는 상태입니다 (${
    detail?.refusal ?? "사유 미상"
  }).`;
}

function describeTarget(target: InboundTarget): InboundTargetDescriptor {
  try {
    return (
      target.describe?.() ?? {
        kind: "orchestrator",
        ptySessionId: null,
        status: target.isRunning?.() === false ? "stopped" : "running",
      }
    );
  } catch {
    return {
      kind: "orchestrator",
      ptySessionId: null,
      status: "unknown",
    };
  }
}

/**
 * Whether an outbound sendMessage error is worth retrying: 429 (rate limit) or
 * any 5xx from Telegram, plus non-HTTP errors (network reset / timeout / abort).
 * A 4xx other than 429 (bad chat id, blocked bot, etc.) is permanent → no retry.
 */
function isRetriableSendError(err: unknown): boolean {
  if (err instanceof TelegramHttpError) {
    return err.status === 429 || err.status >= 500;
  }
  // Network-level failure (fetch threw) — transient, retry.
  return true;
}

/**
 * How long to wait before the next outbound retry. Honors Telegram's
 * `retry_after` (seconds) on a 429; otherwise exponential backoff from base.
 */
function retryWaitMs(
  err: unknown,
  baseBackoffMs: number,
  attempt: number,
): number {
  if (err instanceof TelegramHttpError && typeof err.retryAfter === "number") {
    return Math.max(0, err.retryAfter * 1000);
  }
  return baseBackoffMs * 2 ** attempt;
}
