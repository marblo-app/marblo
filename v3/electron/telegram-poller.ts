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
} from "./telegram-channels";

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
  injectMessage(text: string): Promise<void>;
  /**
   * Whether the orchestrator is still live. Optional; when present the poller
   * re-checks it AFTER injectMessage — injectMessage resolves without error
   * even when it silently skips the write (session stopped/changed mid-boot),
   * so this recheck keeps at-least-once honest across a boot-fail race.
   */
  isRunning?(): boolean;
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
  /** Injectable sleep (tests capture wait durations / skip real delays). */
  sleepImpl?: (ms: number) => Promise<void>;
  /** Injectable logger (tests). Defaults to console. */
  logger?: Pick<Console, "log" | "warn" | "error">;
  /** Called when the registered poll-loop set changes. */
  onLoopActivityChange?: () => void;
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
  private readonly log: Pick<Console, "log" | "warn" | "error">;

  constructor(deps: TelegramPollerDeps) {
    this.deps = deps;
    this.log = deps.logger ?? console;
  }

  // ── lifecycle ────────────────────────────────────────────────────────

  /** Load persisted offsets and start loops for all active channels. */
  start(): void {
    this.loadOffsets();
    this.syncActiveChannels();
  }

  /**
   * Reconcile running loops against the current active-channel set: start a
   * loop for every newly-active project, stop loops whose channel went
   * inactive. Idempotent — safe to call on channel config changes, on
   * powerMonitor resume, and after each health sweep.
   */
  syncActiveChannels(): void {
    const active = new Set(this.listActiveProjectIds());
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
      try {
        const resp = await telegramApi<TgUpdate[]>(
          token,
          "getUpdates",
          params,
          apiOpts,
        );
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
        const raw = err instanceof Error ? err.message : String(err);
        this.log.warn(
          `[TelegramPoller] project=${projectId} getUpdates error: ${scrubToken(
            raw,
            token,
          )}`,
        );
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
          await this.sleep(idleBackoff, ctrl);
          break;
        }
        this.setOffset(projectId, update.update_id + 1);
      }
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
    if (!orch) return false; // hold offset — redeliver after next boot

    const from = this.formatFrom(msg?.from);
    const injected =
      `[Telegram inbound from ${from}]: ${text}\n\n` +
      `이 프로젝트의 텔레그램 채널로 사용자가 보낸 메시지입니다. 텔레그램으로 답장하려면 ` +
      `marblo MCP 의 send_telegram_message 도구를 호출하세요(projectId="${projectId}"). ` +
      `도구를 호출하지 않고 일반 텍스트로만 답하면 사용자에게 전달되지 않습니다.`;

    try {
      await orch.injectMessage(injected);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      this.log.warn(
        `[TelegramPoller] project=${projectId} injectMessage failed: ${raw}`,
      );
      return false; // hold offset — retry delivery
    }
    // injectMessage resolves even when it silently skipped the write because the
    // session stopped/changed while queued behind the boot gate. If the
    // orchestrator is no longer running, treat it as undelivered and hold the
    // offset so the message is redelivered once one is live again.
    if (orch.isRunning && !orch.isRunning()) return false;
    // Only remember the chat once we actually delivered — this becomes the
    // default outbound reply target.
    this.lastChatId.set(projectId, chatId);
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
      void Promise.resolve(orch.injectMessage(reminder)).catch((err) => {
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

    const maxRetries = this.deps.sendMaxRetries ?? DEFAULT_SEND_MAX_RETRIES;
    const baseBackoff = this.deps.sendBackoffMs ?? DEFAULT_SEND_BACKOFF_MS;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const resp = await telegramApi(
          token,
          "sendMessage",
          { chat_id: target, text },
          { fetchImpl: this.deps.fetchImpl },
        );
        if (!resp.ok) {
          // ok:false on a 2xx is a non-retryable application error.
          this.bumpSendFailure(projectId);
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
        this.bumpSendFailure(projectId);
        const raw = err instanceof Error ? err.message : String(err);
        return { ok: false, error: scrubToken(raw, token) };
      }
    }
    // Unreachable (loop always returns), but satisfies the type checker.
    this.bumpSendFailure(projectId);
    return { ok: false, error: "sendMessage exhausted retries" };
  }

  /** Per-project reliability counters (spec C). Defaults to zeros. */
  getReliabilityStats(projectId: string): ReliabilityStats {
    return { ...(this.stats.get(projectId) ?? emptyStats()) };
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
