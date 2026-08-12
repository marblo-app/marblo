/**
 * slack-poller — the electron-main-owned Slack **Socket Mode** inbound client.
 *
 * ★WHY THIS SHAPE (ticket GjEj83bvxJs701irBKJl)
 *
 * This is telegram-poller.ts mirrored onto Slack. Ownership is the same and for
 * the same reason: exactly ONE inbound consumer per project, whose lifecycle is
 * electron main's alone — never inside an orchestrator session (that is what
 * made the Telegram poller 409-flap on every orchestrator churn, ticket
 * vw38IB2VcmOIOlFV51Wa). The loop:
 *   - opens a Socket Mode WebSocket (apps.connections.open → wss url) instead of
 *     long-polling getUpdates. ★Socket Mode, NOT the Events API webhook: Marblo
 *     is a desktop app with no public URL, so an outbound WebSocket is the only
 *     transport available — which is also exactly the shape Telegram polling
 *     already has (client dials out, server pushes work);
 *   - routes each inbound channel message/mention to the project's CURRENT live
 *     orchestrator (board wins over mission) via injectMessage;
 *   - is AT-LEAST-ONCE: an inbound that cannot be delivered right now is kept in
 *     a persisted pending queue and redelivered once an orchestrator boots.
 *
 * Outbound (send_slack_message MCP tool) routes back here via the bridge, and
 * replies land in the SAME THREAD as the inbound (thread_ts) so a shared team
 * channel does not turn into interleaved noise.
 *
 * ── The one place we deliberately DIVERGE from the Telegram mirror ──────────
 *
 * Telegram's at-least-once trick is "don't advance the offset": an undelivered
 * update is simply re-fetched. Socket Mode has no offset — it demands an
 * `envelope_id` ack **within 3 seconds**, and an un-acked envelope is retried a
 * few times and then dropped (repeated failures also get the connection torn
 * down). So "hold the offset" is not available to us.
 *
 * Instead: ACK IMMEDIATELY (always, before any delivery work), and move the
 * at-least-once guarantee into a persisted pending queue that drains when an
 * orchestrator becomes available. Same guarantee, different mechanism — chosen
 * because the alternative (stall the ack while waiting for an orchestrator to
 * boot) would make Slack drop the message outright. Slack's own retries are
 * de-duplicated by `channel:ts` (see SEEN_KEY), so an ack that raced a retry
 * cannot inject the same message twice.
 *
 * Invariants: exactly one connection per project (duplicate-start guard); the
 * bot/app tokens NEVER appear in a log, error, or return value (scrubSlackTokens);
 * inbound can trigger but can never mutate permissions (slack-channels exposes
 * only a read-only access getter).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import {
  slackApi,
  scrubSlackTokens,
  SlackHttpError,
  type SlackApiOptions,
} from "./slack-health";
import {
  listSlackChannelConfigs,
  getSlackChannelConfig,
  isSlackChannelActive,
  getSlackChannelAccess,
  listSlackChannelIdSharers,
} from "./slack-channels";
import { getTelegramProjectLabel } from "./telegram-channel-sync";

// ─── inbound target (structurally identical to telegram-poller's) ─────────
//
// Deliberately re-declared instead of imported: the Slack path must not depend
// on the Telegram module, and structural typing means main.ts can hand the SAME
// orchestrator adapter object to both pollers.

/** Minimal shape of a live orchestrator the client injects inbound text into. */
export interface InboundTarget {
  injectMessage(text: string): Promise<boolean>;
  /** Whether the orchestrator is still live. Diagnostics only. */
  isRunning?(): boolean;
  /** Token-free target metadata for handoff diagnostics and health. */
  describe?(): InboundTargetDescriptor;
}

export interface InboundTargetDescriptor {
  kind: string;
  ptySessionId: string | null;
  status: string;
}

// ─── Socket Mode wire shapes (only the fields we read) ────────────────────

/** A Socket Mode envelope as it arrives on the WebSocket. */
export interface SocketEnvelope {
  type?: string;
  /** Present on work envelopes — must be echoed back to ack. */
  envelope_id?: string;
  /** `disconnect` reason: "warning" (refresh) | "refresh_requested" | … */
  reason?: string;
  payload?: {
    event?: SlackEventPayload;
    [key: string]: unknown;
  };
}

/** The Events API event inside an `events_api` envelope. */
export interface SlackEventPayload {
  type?: string;
  subtype?: string;
  /** Sender's Slack user id. Absent on some service messages. */
  user?: string;
  /** Present when a bot (including ours) authored the message. */
  bot_id?: string;
  text?: string;
  channel?: string;
  /** "channel" | "group" | "im" | "mpim". */
  channel_type?: string;
  /** Message timestamp — doubles as the message id within a channel. */
  ts?: string;
  /** Set when the message is inside a thread. */
  thread_ts?: string;
}

/** A normalized, actionable inbound message extracted from an envelope. */
export interface SlackInboundMessage {
  /** Dedup key — stable across the `message`/`app_mention` duplicate pair. */
  key: string;
  channel: string;
  /** Thread to reply into: the message's thread, else the message itself. */
  threadTs: string;
  user: string | null;
  /** Message text with our own `<@BOT>` mention stripped for readability. */
  text: string;
  /** True for a DM (`im`) — those need no mention to be actionable. */
  isDirectMessage: boolean;
}

// ─── WebSocket abstraction (keeps `ws` out of the unit tests) ─────────────

/**
 * The slice of a WebSocket client this module uses. `ws` satisfies it as-is;
 * tests inject a fake. Declared rather than typed against `ws` so the unit
 * tests never need the dependency (and so a future transport swap is local).
 */
export interface SlackSocket {
  on(event: "open", listener: () => void): void;
  on(event: "message", listener: (data: unknown) => void): void;
  on(event: "close", listener: (code?: number, reason?: unknown) => void): void;
  on(event: "error", listener: (err: unknown) => void): void;
  send(data: string): void;
  close(): void;
}

/**
 * Default socket factory — lazily requires `ws`.
 *
 * ★Why `ws` and not `@slack/socket-mode`: the Telegram bridge talks to its API
 * with plain fetch and no SDK, and this module mirrors that (slackApi()). The
 * only thing raw fetch cannot do is hold a WebSocket, so we add exactly that
 * one primitive. It also keeps the MCP side untouched — `send_slack_message`
 * only POSTs to the bridge, so dist-mcp gains no dependency (the un-bundled
 * dist-mcp deps failure mode called out in the ticket cannot recur here).
 *
 * The require is lazy so this module stays importable from plain node (unit
 * tests, verify scripts) exactly like vendor-secrets' electron require.
 */
function defaultSocketFactory(url: string): SlackSocket {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const WebSocketImpl = require("ws") as new (url: string) => SlackSocket;
  return new WebSocketImpl(url);
}

// ─── deps (all injectable for tests; defaults hit the live channel store) ──

export interface SlackPollerDeps {
  /**
   * Resolve the CURRENT live orchestrator for a project, or null when none is
   * running. Main wires this to "board if running, else mission if running".
   * When null the inbound is queued (not dropped) — at-least-once delivery so
   * the message arrives after the next orchestrator boot.
   */
  resolveOrchestrator: (projectId: string) => InboundTarget | null;
  /** Active projects with a live Slack channel. Default: channel store. */
  listActiveProjectIds?: () => string[];
  /** Bot token (xoxb) for a project. Default: channel store. */
  getBotToken?: (projectId: string) => string | null;
  /** App token (xapp, Socket Mode) for a project. Default: channel store. */
  getAppToken?: (projectId: string) => string | null;
  /** Default reply channel (config channelId). Default: channel store. */
  getDefaultChannelId?: (projectId: string) => string | null;
  /**
   * Inbound allowlist. Empty/undefined ⇒ allow all. Default: access store.
   * A message from a channel not on a non-empty allowlist is dropped (still
   * acked) — inbound can trigger but must come from an authorized channel.
   */
  getAllowedChannelIds?: (projectId: string) => string[];
  /**
   * The bot's own Slack user id, used for mention detection and for ignoring
   * our own posts. Default: resolved once per project via auth.test and cached.
   */
  getBotUserId?: (projectId: string) => Promise<string | null>;
  fetchImpl?: typeof fetch;
  /** WebSocket factory. Default: lazy `ws`. Tests inject a fake. */
  webSocketFactory?: (url: string) => SlackSocket;
  /** State persistence file. Default ~/.marblo/slack-poller-state.json */
  statePath?: string;
  /** First reconnect delay (ms); doubles up to maxReconnectBackoffMs. Default 1000. */
  reconnectBackoffMs?: number;
  /** Reconnect backoff ceiling (ms). Default 30000. */
  maxReconnectBackoffMs?: number;
  /** How often to retry draining the pending-inbound queue (ms). Default 5000. */
  pendingRetryMs?: number;
  /** Max queued undelivered inbounds per project before the oldest is dropped. Default 50. */
  maxPendingPerProject?: number;
  /** Dedup ring size per project (Slack retries + message/app_mention pair). Default 200. */
  maxSeenPerProject?: number;
  /**
   * Un-replied nudge: quiet window (ms) after the last orchestrator busy signal
   * that counts as "turn ended". Default 6000. (Telegram parity.)
   */
  nudgeIdleDebounceMs?: number;
  /** Fallback (ms) for the nudge when NO activity signal ever arrives. Default 120000. */
  nudgeMaxGraceMs?: number;
  /** Outbound postMessage retries on network/5xx/429 (total = 1 + this). Default 2. */
  sendMaxRetries?: number;
  /** Base backoff (ms) for outbound retries; doubles each attempt. Default 500. */
  sendBackoffMs?: number;
  /** Injectable sleep (tests capture wait durations / skip real delays). */
  sleepImpl?: (ms: number) => Promise<void>;
  /** Injectable logger (tests). Defaults to console. */
  logger?: Pick<Console, "log" | "warn" | "error">;
  /** Called when the registered connection set changes. */
  onLoopActivityChange?: () => void;
  /** Other ENABLED projects posting into the same channel (outbound prefix). */
  listChannelIdSharers?: (projectId: string, channelId: string) => string[];
  /** Human label for the outbound prefix (project name). */
  getProjectLabel?: (projectId: string) => string | null;
}

/** Result of an outbound chat.postMessage — never carries a token. */
export interface SlackSendResult {
  ok: boolean;
  /** Channel the message went to (echoed for confirmation). */
  channel?: string;
  /** Thread the message landed in, when threaded. */
  threadTs?: string;
  /** Token-scrubbed failure reason when ok=false. */
  error?: string;
}

/** Per-project reliability counters. Telegram parity (spec C). */
export interface SlackReliabilityStats {
  /** Inbound messages the orchestrator never replied to (after a nudge). */
  unanswered: number;
  /** Outbound sends that failed after all retries. */
  sendFailures: number;
  /** Inbounds dropped because the pending queue overflowed (never silent). */
  droppedOverflow: number;
}

export interface SlackRouteHealth {
  projectId: string;
  connected: boolean;
  lastChannelKnown: boolean;
  pendingReply: boolean;
  /** Undelivered inbounds waiting for an orchestrator. */
  pendingInbound: number;
  lastInboundAt: number | null;
  lastDeliveredKey: string | null;
  lastDeliveredTarget: InboundTargetDescriptor | null;
  reliability: SlackReliabilityStats;
}

const DEFAULT_STATE_FILE = path.join(
  os.homedir(),
  ".marblo",
  "slack-poller-state.json",
);
const DEFAULT_RECONNECT_BACKOFF_MS = 1000;
const DEFAULT_MAX_RECONNECT_BACKOFF_MS = 30_000;
const DEFAULT_PENDING_RETRY_MS = 5000;
const DEFAULT_MAX_PENDING_PER_PROJECT = 50;
const DEFAULT_MAX_SEEN_PER_PROJECT = 200;
const DEFAULT_NUDGE_IDLE_DEBOUNCE_MS = 6000;
const DEFAULT_NUDGE_MAX_GRACE_MS = 120_000;
const DEFAULT_SEND_MAX_RETRIES = 2;
const DEFAULT_SEND_BACKOFF_MS = 500;
/** State-file permissions — it holds message text, so owner-only. */
const STATE_FILE_MODE = 0o600;

interface ConnectionHandle {
  /** Set true to ask the connection loop to exit at its next checkpoint. */
  stop: boolean;
  /** Resolves when the loop has fully exited. */
  done: Promise<void>;
  /** The live socket, so stop() can tear it down immediately. */
  socket: SlackSocket | null;
  /** True between `hello` and close — drives health/`connected`. */
  connected: boolean;
}

/** An inbound injected into the orchestrator that still awaits a reply. */
interface PendingReply {
  key: string;
  /** Whether the one-shot reminder has already been injected (max 1/key). */
  nudged: boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
  maxTimer: ReturnType<typeof setTimeout> | null;
}

/** An inbound that could not be delivered yet (persisted across restarts). */
interface PendingInbound {
  key: string;
  channel: string;
  threadTs: string;
  user: string | null;
  text: string;
  at: number;
}

interface ProjectState {
  /** Dedup ring of recently handled `channel:ts` keys (newest last). */
  seen: string[];
  /** Undelivered inbounds, oldest first. */
  pending: PendingInbound[];
}

/**
 * Per-project Socket Mode client. One instance for the whole app (main owns
 * it); `syncActiveChannels()` reconciles live connections against the active
 * channel set, and `sendMessage()` is the outbound path the bridge routes into.
 */
export class SlackPoller {
  private readonly deps: SlackPollerDeps;
  private readonly connections = new Map<string, ConnectionHandle>();
  /** Last inbound channel per project — default reply target for outbound. */
  private readonly lastChannel = new Map<string, string>();
  /** Last inbound thread per project — default reply thread for outbound. */
  private readonly lastThreadTs = new Map<string, string>();
  /** Cached bot user id per project (mention detection / self-message filter). */
  private readonly botUserIds = new Map<string, string | null>();
  /** In-memory mirror of the persisted per-project state. */
  private state: Record<string, ProjectState> = {};
  /** Inbound awaiting a reply, per project (un-replied nudge). */
  private readonly pendingReplies = new Map<string, PendingReply>();
  private readonly stats = new Map<string, SlackReliabilityStats>();
  private readonly lastDelivered = new Map<
    string,
    { at: number; key: string; target: InboundTargetDescriptor }
  >();
  private readonly log: Pick<Console, "log" | "warn" | "error">;
  /** Timer draining the pending-inbound queue; null when nothing is queued. */
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * True while a drain pass is in flight. Without this, an inbound arriving
   * during a drain's `await injectMessage` would arm a second timer whose pass
   * could read the same queue head and inject it twice — the exact duplicate
   * the dedup ring cannot catch, because both passes are handling the same
   * already-seen entry.
   */
  private draining = false;
  /** App-token conflict groups already warned about (log once per set change). */
  private readonly warnedTokenConflicts = new Set<string>();

  constructor(deps: SlackPollerDeps) {
    this.deps = deps;
    this.log = deps.logger ?? console;
  }

  // ── lifecycle ────────────────────────────────────────────────────────

  /** Load persisted state and connect every active channel. */
  start(): void {
    this.loadState();
    this.syncActiveChannels();
    // A restart may inherit a queue that predates this process — drain it as
    // soon as an orchestrator exists rather than waiting for the next inbound.
    if (this.totalPending() > 0) this.scheduleDrain();
  }

  /**
   * Reconcile live connections against the current active-channel set: connect
   * every newly-active project, disconnect the ones whose channel went
   * inactive. Idempotent — safe on config change, on powerMonitor resume, and
   * after each health sweep.
   *
   * ★Connections are deduped BY APP TOKEN, not just by project: Socket Mode
   * fans the SAME event out to every open connection of an app, so two projects
   * sharing one app token would each inject the same mention into a different
   * orchestrator and both would answer. The settings path blocks that at save
   * time (slack-channels findAppTokenConflicts); this is the runtime defense
   * for legacy/hand-edited data — one deterministic winner connects.
   */
  syncActiveChannels(): void {
    const byToken = new Map<string, string[]>();
    for (const projectId of this.listActiveProjectIds()) {
      const token = this.getAppToken(projectId);
      if (!token) continue; // no app token → the loop would exit immediately
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
      const sorted = [...group].sort();
      const winner = sorted.find((p) => this.connections.has(p)) ?? sorted[0];
      active.add(winner);
      const signature = `${tokenHash(token)}:${sorted.join(",")}`;
      if (!this.warnedTokenConflicts.has(signature)) {
        this.warnedTokenConflicts.add(signature);
        this.log.warn(
          `[SlackPoller] projects [${sorted.join(", ")}] share ONE Slack app token ` +
            `(hash=${tokenHash(token)}). Socket Mode delivers every event to EVERY ` +
            `connection of an app, so only project=${winner} connects; the others get ` +
            `no inbound until each project is given its own Slack app.`,
        );
      }
    }

    for (const projectId of active) {
      if (!this.connections.has(projectId)) this.startConnection(projectId);
    }
    for (const projectId of [...this.connections.keys()]) {
      if (!active.has(projectId)) void this.stopConnection(projectId);
    }
  }

  /** Disconnect everything (app quit / channel teardown). */
  async stopAll(): Promise<void> {
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
    await Promise.all(
      [...this.connections.keys()].map((p) => this.stopConnection(p)),
    );
  }

  private startConnection(projectId: string): void {
    // Duplicate-start guard: exactly one Socket Mode connection per project.
    if (this.connections.has(projectId)) return;
    const handle: ConnectionHandle = {
      stop: false,
      done: Promise.resolve(),
      socket: null,
      connected: false,
    };
    this.connections.set(projectId, handle);
    this.deps.onLoopActivityChange?.();
    handle.done = this.runConnection(projectId, handle).finally(() => {
      // Only delete if this exact handle is still the registered one.
      if (this.connections.get(projectId) === handle) {
        this.connections.delete(projectId);
        this.deps.onLoopActivityChange?.();
      }
    });
    this.log.log(
      `[SlackPoller] started Socket Mode connection for project ${projectId}`,
    );
  }

  private async stopConnection(projectId: string): Promise<void> {
    const handle = this.connections.get(projectId);
    if (!handle) return;
    handle.stop = true;
    this.connections.delete(projectId);
    this.deps.onLoopActivityChange?.();
    // Drop pending-reply nudge timers so they don't fire after teardown.
    this.clearPendingReply(projectId);
    try {
      handle.socket?.close();
    } catch {
      /* already closed */
    }
    try {
      await handle.done;
    } catch {
      /* the loop already logged its own errors */
    }
    this.log.log(
      `[SlackPoller] stopped Socket Mode connection for project ${projectId}`,
    );
  }

  // ── the connect / reconnect loop ─────────────────────────────────────

  private async runConnection(
    projectId: string,
    ctrl: ConnectionHandle,
  ): Promise<void> {
    const baseBackoff =
      this.deps.reconnectBackoffMs ?? DEFAULT_RECONNECT_BACKOFF_MS;
    const maxBackoff =
      this.deps.maxReconnectBackoffMs ?? DEFAULT_MAX_RECONNECT_BACKOFF_MS;
    let backoff = baseBackoff;

    while (!ctrl.stop) {
      const appToken = this.getAppToken(projectId);
      if (!appToken) break; // channel deactivated → exit loop

      let url: string | null = null;
      try {
        const resp = await slackApi(
          appToken,
          "apps.connections.open",
          undefined,
          this.apiOpts(),
        );
        if (resp.ok && typeof resp.url === "string") {
          url = resp.url;
        } else {
          this.log.warn(
            `[SlackPoller] project=${projectId} apps.connections.open not ok: ` +
              `${scrubSlackTokens(String(resp.error ?? "unknown"), appToken)}. ` +
              `(app token 은 Socket Mode 용 xapp- 토큰이어야 하고 connections:write 스코프가 필요합니다.)`,
          );
        }
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        this.log.warn(
          `[SlackPoller] project=${projectId} apps.connections.open error: ${scrubSlackTokens(
            raw,
            appToken,
          )}`,
        );
      }

      if (!url) {
        await this.delay(backoff);
        backoff = Math.min(backoff * 2, maxBackoff);
        continue;
      }

      // Reaching a usable wss url means credentials are good; reset the ramp so
      // a routine Slack-initiated refresh doesn't inherit an old long backoff.
      backoff = baseBackoff;
      await this.runSocket(projectId, ctrl, url);
      if (ctrl.stop) break;
      await this.delay(backoff);
      backoff = Math.min(backoff * 2, maxBackoff);
    }
  }

  /**
   * Hold one WebSocket until it closes. Resolves on close/error — never
   * rejects, so the reconnect loop above is the only place that decides
   * whether to keep going.
   */
  private runSocket(
    projectId: string,
    ctrl: ConnectionHandle,
    url: string,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      let socket: SlackSocket;
      try {
        socket = (this.deps.webSocketFactory ?? defaultSocketFactory)(url);
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        this.log.warn(
          `[SlackPoller] project=${projectId} WebSocket construction failed: ${raw}`,
        );
        resolve();
        return;
      }
      ctrl.socket = socket;

      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        ctrl.connected = false;
        if (ctrl.socket === socket) ctrl.socket = null;
        resolve();
      };

      socket.on("open", () => {
        this.log.log(
          `[SlackPoller] project=${projectId} Socket Mode WebSocket open.`,
        );
      });
      socket.on("message", (data: unknown) => {
        void this.onSocketMessage(projectId, ctrl, socket, String(data));
      });
      socket.on("error", (err: unknown) => {
        const raw = err instanceof Error ? err.message : String(err);
        this.log.warn(
          `[SlackPoller] project=${projectId} Socket Mode error: ${raw}`,
        );
        finish();
      });
      socket.on("close", () => {
        this.log.log(
          `[SlackPoller] project=${projectId} Socket Mode connection closed; will reconnect.`,
        );
        finish();
      });

      // If teardown was requested while we were opening, close immediately.
      if (ctrl.stop) {
        try {
          socket.close();
        } catch {
          /* nothing to close */
        }
        finish();
      }
    });
  }

  /**
   * Handle one frame. ★The ack is sent FIRST and unconditionally (Slack gives
   * us 3s and retries otherwise) — every delivery decision happens after, on
   * the pending queue, so a slow or absent orchestrator can never cost us the
   * message. See the module header for why this diverges from Telegram's
   * hold-the-offset trick.
   */
  private async onSocketMessage(
    projectId: string,
    ctrl: ConnectionHandle,
    socket: SlackSocket,
    raw: string,
  ): Promise<void> {
    const envelope = parseSocketEnvelope(raw);
    if (!envelope) return;

    if (envelope.envelope_id) {
      try {
        socket.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.warn(
          `[SlackPoller] project=${projectId} failed to ack envelope: ${msg}`,
        );
      }
    }

    if (envelope.type === "hello") {
      ctrl.connected = true;
      this.log.log(
        `[SlackPoller] project=${projectId} Socket Mode handshake complete (hello).`,
      );
      // A fresh connection is the natural moment to retry anything queued.
      if (this.pendingFor(projectId).length > 0) this.scheduleDrain();
      return;
    }

    if (envelope.type === "disconnect") {
      // Slack asks us to reconnect roughly every 10-15 min (reason "warning"/
      // "refresh_requested"). Closing here lets runConnection dial a fresh url.
      this.log.log(
        `[SlackPoller] project=${projectId} Slack requested disconnect (${
          envelope.reason ?? "unspecified"
        }); reconnecting.`,
      );
      try {
        socket.close();
      } catch {
        /* the close handler still fires */
      }
      return;
    }

    if (envelope.type !== "events_api") return; // slash/interactive: not MVP

    const botUserId = await this.resolveBotUserId(projectId);
    const message = extractInboundMessage(envelope.payload?.event, botUserId);
    if (!message) return; // service message / bot echo / unmentioned chatter

    // Authorization: a non-empty allowlist gates which channels may drive the
    // orchestrator. Unauthorized inbound is dropped (already acked), never
    // injected — mirrors the Telegram allowlist exactly.
    const allowed = this.getAllowedChannelIds(projectId);
    if (allowed.length > 0 && !allowed.includes(message.channel)) {
      this.log.warn(
        `[SlackPoller] project=${projectId} dropping inbound from unauthorized channel ${message.channel}.`,
      );
      return;
    }

    // Dedup: Slack emits BOTH `message` and `app_mention` for one channel
    // mention, and retries un-acked envelopes. Both carry the same channel+ts,
    // so `channel:ts` collapses them into one injection.
    if (this.markSeen(projectId, message.key)) {
      return; // already handled
    }

    await this.deliverOrQueue(projectId, {
      key: message.key,
      channel: message.channel,
      threadTs: message.threadTs,
      user: message.user,
      text: message.text,
      at: Date.now(),
    });
  }

  // ── delivery (at-least-once via the persisted pending queue) ──────────

  /**
   * Try to hand an inbound to the live orchestrator; queue it for redelivery if
   * there is none (or the PTY write did not land). Returns true when delivered.
   */
  private async deliverOrQueue(
    projectId: string,
    inbound: PendingInbound,
  ): Promise<boolean> {
    // Anything already queued is older than this message. Jumping the line
    // would hand the orchestrator a conversation out of order, so join the
    // queue and let the drain deliver it in turn.
    if (this.pendingFor(projectId).length > 0) {
      this.enqueuePending(projectId, inbound);
      return false;
    }
    const delivered = await this.tryDeliver(projectId, inbound);
    if (!delivered) this.enqueuePending(projectId, inbound);
    return delivered;
  }

  private async tryDeliver(
    projectId: string,
    inbound: PendingInbound,
  ): Promise<boolean> {
    const orch = this.deps.resolveOrchestrator(projectId);
    if (!orch) return false; // queue it — redeliver after the next boot

    const injected = formatInboundInjection(projectId, inbound);
    try {
      const wrote = await orch.injectMessage(injected);
      if (!wrote) {
        // ★The Telegram expectPty regression (inbound silently dropped when the
        // PTY changed mid-flight) is guarded in OrchestratorManager.injectMessage,
        // which returns false instead of faking success. Honor that contract:
        // a false write is NOT a delivery, so the message stays queued.
        this.log.warn(
          `[SlackPoller] project=${projectId} injectMessage did not write to a live PTY; queueing for redelivery.`,
        );
        return false;
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      this.log.warn(
        `[SlackPoller] project=${projectId} injectMessage failed: ${raw}`,
      );
      return false;
    }

    // Only remember the channel/thread once we actually delivered — these
    // become the default outbound reply target.
    this.lastChannel.set(projectId, inbound.channel);
    this.lastThreadTs.set(projectId, inbound.threadTs);
    const target = describeTarget(orch);
    this.lastDelivered.set(projectId, {
      at: Date.now(),
      key: inbound.key,
      target,
    });
    this.log.log(
      `[SlackPoller] project=${projectId} delivered inbound ${inbound.key} to ` +
        `${target.kind} pty=${target.ptySessionId ?? "unknown"} status=${target.status}; ` +
        `replies thread to ${inbound.threadTs}.`,
    );
    this.armReplyTracking(projectId, inbound.key);
    return true;
  }

  /** Append to the persisted pending queue and make sure a drain is scheduled. */
  private enqueuePending(projectId: string, inbound: PendingInbound): void {
    const state = this.stateFor(projectId);
    // Re-queueing an already-queued key (a failed drain attempt) must not
    // duplicate it.
    const existing = state.pending.findIndex((p) => p.key === inbound.key);
    if (existing >= 0) state.pending.splice(existing, 1);
    state.pending.push(inbound);

    const max =
      this.deps.maxPendingPerProject ?? DEFAULT_MAX_PENDING_PER_PROJECT;
    while (state.pending.length > max) {
      const dropped = state.pending.shift();
      this.bumpStat(projectId, "droppedOverflow");
      // Never a silent loss — say exactly what was dropped and why.
      this.log.warn(
        `[SlackPoller] project=${projectId} pending inbound queue exceeded ${max}; ` +
          `dropped the oldest undelivered message (${dropped?.key ?? "unknown"}) from ` +
          `channel ${dropped?.channel ?? "unknown"}. The orchestrator has been offline ` +
          `long enough to overflow the queue — that message will NOT be delivered.`,
      );
    }
    this.persistState();
    this.scheduleDrain();
  }

  /** Arm the queue-drain timer (idempotent — one timer for all projects). */
  private scheduleDrain(): void {
    if (this.drainTimer) return;
    const ms = this.deps.pendingRetryMs ?? DEFAULT_PENDING_RETRY_MS;
    this.drainTimer = this.armTimer(ms, () => {
      this.drainTimer = null;
      void this.drainPending();
    });
  }

  /**
   * Attempt redelivery of every queued inbound, oldest first. Stops a project's
   * drain at its first failure so ordering is preserved, and re-arms itself
   * while anything remains queued.
   */
  private async drainPending(): Promise<void> {
    if (this.draining) return; // a pass is already walking the queue
    this.draining = true;
    try {
      for (const projectId of Object.keys(this.state)) {
        const queue = this.pendingFor(projectId);
        while (queue.length > 0) {
          const next = queue[0];
          const delivered = await this.tryDeliver(projectId, next);
          // Still no orchestrator — keep ordering and retry the whole queue
          // later rather than skipping ahead.
          if (!delivered) break;
          // Re-check identity: the head can only have moved if something else
          // consumed it, in which case there is nothing to drop here.
          if (queue[0]?.key === next.key) queue.shift();
          this.persistState();
        }
      }
    } finally {
      this.draining = false;
    }
    if (this.totalPending() > 0) this.scheduleDrain();
  }

  // ── un-replied nudge (Telegram parity) ───────────────────────────────
  //
  // After an inbound is delivered we wait for the orchestrator to finish its
  // turn (busy→idle, fed by markOrchestratorActivity). If it went idle without
  // calling send_slack_message (which clears the pending entry), we inject ONE
  // reminder. If the next idle still shows no reply, we count it as unanswered
  // and stop — max one nudge per inbound, no loop.

  private armReplyTracking(projectId: string, key: string): void {
    // A newer inbound supersedes an older un-answered one.
    this.clearPendingReply(projectId);
    this.pendingReplies.set(projectId, {
      key,
      nudged: false,
      idleTimer: null,
      maxTimer: this.armTimer(this.nudgeMaxGraceMs(), () =>
        this.onOrchestratorIdle(projectId),
      ),
    });
  }

  /**
   * Feed an orchestrator "busy" signal for a project (main calls this from the
   * orchestrator PTY output filtered by isBusySignal). While an inbound awaits
   * a reply, each busy signal (re)arms the quiet-window debounce.
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
    if (pending.idleTimer) clearTimeout(pending.idleTimer);
    if (pending.maxTimer) clearTimeout(pending.maxTimer);
    pending.idleTimer = null;
    pending.maxTimer = null;

    if (!pending.nudged) {
      const orch = this.deps.resolveOrchestrator(projectId);
      if (!orch) {
        this.bumpStat(projectId, "unanswered");
        this.pendingReplies.delete(projectId);
        return;
      }
      pending.nudged = true;
      const thread = this.lastThreadTs.get(projectId);
      const reminder =
        `위 Slack 메시지에 아직 답하지 않았습니다. 답할 내용이 있으면 ` +
        `marblo MCP 의 send_slack_message 도구를 호출해 답장하세요` +
        `(projectId="${projectId}"${thread ? `, threadTs="${thread}"` : ""}). ` +
        `답이 필요 없으면 무시해도 됩니다.`;
      void Promise.resolve(orch.injectMessage(reminder))
        .then((wrote) => {
          if (!wrote) {
            this.log.warn(
              `[SlackPoller] project=${projectId} nudge injectMessage did not write to a live PTY`,
            );
          }
        })
        .catch((err) => {
          const raw = err instanceof Error ? err.message : String(err);
          this.log.warn(
            `[SlackPoller] project=${projectId} nudge injectMessage failed: ${raw}`,
          );
        });
      this.log.log(
        `[SlackPoller] project=${projectId} nudged orchestrator to reply to inbound ${pending.key}.`,
      );
      pending.maxTimer = this.armTimer(this.nudgeMaxGraceMs(), () =>
        this.onOrchestratorIdle(projectId),
      );
      return;
    }

    this.bumpStat(projectId, "unanswered");
    this.log.warn(
      `[SlackPoller] project=${projectId} inbound ${pending.key} went unanswered after a nudge.`,
    );
    this.pendingReplies.delete(projectId);
  }

  private clearPendingReply(projectId: string): void {
    const pending = this.pendingReplies.get(projectId);
    if (!pending) return;
    if (pending.idleTimer) clearTimeout(pending.idleTimer);
    if (pending.maxTimer) clearTimeout(pending.maxTimer);
    this.pendingReplies.delete(projectId);
  }

  private armTimer(ms: number, fn: () => void): ReturnType<typeof setTimeout> {
    const t = setTimeout(fn, ms);
    // Never let one of our timers keep the process alive on quit.
    t.unref?.();
    return t;
  }

  // ── outbound (send_slack_message MCP tool → bridge → here) ────────────

  /**
   * Post an outbound Slack message. The channel defaults to the last inbound
   * channel, then the configured channel; the thread defaults to the last
   * inbound thread so a reply lands under the message that asked for it.
   * NEVER returns or logs a token (errors are scrubbed).
   */
  async sendMessage(
    projectId: string,
    text: string,
    opts?: { channelId?: string; threadTs?: string },
  ): Promise<SlackSendResult> {
    // The orchestrator is replying → cancel the un-replied nudge. Do this even
    // if the post below fails: it DID answer; a delivery failure is counted
    // separately as a send failure.
    this.clearPendingReply(projectId);

    const token = this.getBotToken(projectId);
    if (!token) {
      return {
        ok: false,
        error: `no active Slack channel for project "${projectId}"`,
      };
    }
    const channel =
      (opts?.channelId && opts.channelId.trim()) ||
      this.lastChannel.get(projectId) ||
      this.getDefaultChannelId(projectId);
    if (!channel) {
      return {
        ok: false,
        error:
          "no channel available — pass channelId explicitly or wait for an inbound message first",
      };
    }
    if (!text || !text.trim()) {
      return { ok: false, error: "message text is empty" };
    }
    // An explicit empty threadTs means "post to the channel, not in a thread".
    const threadTs =
      opts?.threadTs !== undefined
        ? opts.threadTs.trim() || undefined
        : this.lastThreadTs.get(projectId);

    // Same-channel disambiguation prefix: when another enabled project posts
    // into this channel too, there is no way to tell whose orchestrator
    // answered — prefix with the project label. No sharers ⇒ text unchanged.
    const outboundText = this.channelIdSharers(projectId, channel).length
      ? `[${this.projectLabel(projectId)}] ${text}`
      : text;

    const maxRetries = this.deps.sendMaxRetries ?? DEFAULT_SEND_MAX_RETRIES;
    const baseBackoff = this.deps.sendBackoffMs ?? DEFAULT_SEND_BACKOFF_MS;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const resp = await slackApi(
          token,
          "chat.postMessage",
          {
            channel,
            text: outboundText,
            ...(threadTs ? { thread_ts: threadTs } : {}),
          },
          this.apiOpts(),
        );
        if (!resp.ok) {
          // Slack signals rate limiting with a 200 + ok:false in some paths —
          // that one is retryable; every other application error is permanent.
          const code = String(resp.error ?? "postMessage failed");
          if (code === "ratelimited" && attempt < maxRetries) {
            await this.delay(baseBackoff * 2 ** attempt);
            continue;
          }
          this.bumpStat(projectId, "sendFailures");
          return { ok: false, error: scrubSlackTokens(code, token) };
        }
        return {
          ok: true,
          channel,
          ...(threadTs ? { threadTs } : {}),
        };
      } catch (err) {
        const retriable = isRetriableSendError(err);
        if (attempt < maxRetries && retriable) {
          const waitMs = retryWaitMs(err, baseBackoff, attempt);
          this.log.warn(
            `[SlackPoller] project=${projectId} chat.postMessage attempt ${
              attempt + 1
            }/${maxRetries + 1} failed (${scrubSlackTokens(
              err instanceof Error ? err.message : String(err),
              token,
            )}); retrying in ${waitMs}ms`,
          );
          await this.delay(waitMs);
          continue;
        }
        this.bumpStat(projectId, "sendFailures");
        const raw = err instanceof Error ? err.message : String(err);
        return { ok: false, error: scrubSlackTokens(raw, token) };
      }
    }
    // Unreachable (the loop always returns), but satisfies the type checker.
    this.bumpStat(projectId, "sendFailures");
    return { ok: false, error: "chat.postMessage exhausted retries" };
  }

  // ── health / introspection ───────────────────────────────────────────

  /** Per-project reliability counters. Defaults to zeros. */
  getReliabilityStats(projectId: string): SlackReliabilityStats {
    return { ...(this.stats.get(projectId) ?? emptyStats()) };
  }

  /**
   * Token-free health snapshot for switch/takeover diagnostics — proves which
   * PTY will receive Slack inbound without exposing credentials or messages.
   */
  getRouteHealth(projectId: string): SlackRouteHealth {
    const delivered = this.lastDelivered.get(projectId);
    return {
      projectId,
      connected: this.connections.get(projectId)?.connected ?? false,
      lastChannelKnown: this.lastChannel.has(projectId),
      pendingReply: this.pendingReplies.has(projectId),
      pendingInbound: this.pendingFor(projectId).length,
      lastInboundAt: delivered?.at ?? null,
      lastDeliveredKey: delivered?.key ?? null,
      lastDeliveredTarget: delivered?.target ?? null,
      reliability: this.getReliabilityStats(projectId),
    };
  }

  /** True if a Socket Mode connection is registered for the project (tests). */
  hasConnection(projectId: string): boolean {
    return this.connections.has(projectId);
  }

  /** True if any project currently holds a Socket Mode connection. */
  hasActiveLoops(): boolean {
    return this.connections.size > 0;
  }

  /** Last inbound channel recorded for the project, or undefined (tests). */
  getLastChannel(projectId: string): string | undefined {
    return this.lastChannel.get(projectId);
  }

  /** Last inbound thread recorded for the project, or undefined (tests). */
  getLastThreadTs(projectId: string): string | undefined {
    return this.lastThreadTs.get(projectId);
  }

  /** True if an inbound is awaiting a reply for the project (tests). */
  hasPendingReply(projectId: string): boolean {
    return this.pendingReplies.has(projectId);
  }

  /** Queued undelivered inbounds for the project (tests/health). */
  getPendingInboundCount(projectId: string): number {
    return this.pendingFor(projectId).length;
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private apiOpts(): SlackApiOptions {
    return { fetchImpl: this.deps.fetchImpl };
  }

  private bumpStat(
    projectId: string,
    field: keyof SlackReliabilityStats,
  ): void {
    const s = this.stats.get(projectId) ?? emptyStats();
    s[field] += 1;
    this.stats.set(projectId, s);
  }

  private delay(ms: number): Promise<void> {
    if (this.deps.sleepImpl) return this.deps.sleepImpl(ms);
    return new Promise((r) => setTimeout(r, ms));
  }

  private listActiveProjectIds(): string[] {
    if (this.deps.listActiveProjectIds) return this.deps.listActiveProjectIds();
    try {
      return listSlackChannelConfigs()
        .filter(
          (c) => c.botToken && c.appToken && isSlackChannelActive(c.projectId),
        )
        .map((c) => c.projectId);
    } catch {
      return [];
    }
  }

  private getBotToken(projectId: string): string | null {
    if (this.deps.getBotToken) return this.deps.getBotToken(projectId);
    if (!isSlackChannelActive(projectId)) return null;
    return getSlackChannelConfig(projectId)?.botToken ?? null;
  }

  private getAppToken(projectId: string): string | null {
    if (this.deps.getAppToken) return this.deps.getAppToken(projectId);
    if (!isSlackChannelActive(projectId)) return null;
    return getSlackChannelConfig(projectId)?.appToken ?? null;
  }

  private getDefaultChannelId(projectId: string): string | null {
    if (this.deps.getDefaultChannelId)
      return this.deps.getDefaultChannelId(projectId);
    return getSlackChannelConfig(projectId)?.channelId ?? null;
  }

  private getAllowedChannelIds(projectId: string): string[] {
    if (this.deps.getAllowedChannelIds)
      return this.deps.getAllowedChannelIds(projectId);
    try {
      return getSlackChannelAccess(projectId)?.allowedChannelIds ?? [];
    } catch {
      return [];
    }
  }

  /**
   * The bot's own user id, cached per project. Needed to (a) detect `<@BOT>`
   * mentions and (b) ignore our own posts. A failed lookup caches null and the
   * mention gate then falls back to app_mention events / DMs only.
   */
  private async resolveBotUserId(projectId: string): Promise<string | null> {
    if (this.botUserIds.has(projectId)) {
      return this.botUserIds.get(projectId) ?? null;
    }
    let resolved: string | null = null;
    try {
      if (this.deps.getBotUserId) {
        resolved = await this.deps.getBotUserId(projectId);
      } else {
        const token = this.getBotToken(projectId);
        if (token) {
          const auth = await slackApi(
            token,
            "auth.test",
            undefined,
            this.apiOpts(),
          );
          resolved =
            auth.ok && typeof auth.user_id === "string" ? auth.user_id : null;
        }
      }
    } catch {
      resolved = null;
    }
    this.botUserIds.set(projectId, resolved);
    if (!resolved) {
      this.log.warn(
        `[SlackPoller] project=${projectId} could not resolve the bot user id ` +
          `(auth.test). Channel messages are then only actionable as app_mention ` +
          `events or DMs.`,
      );
    }
    return resolved;
  }

  /** Other enabled projects posting into the same channel (prefix trigger). */
  private channelIdSharers(projectId: string, channelId: string): string[] {
    if (this.deps.listChannelIdSharers)
      return this.deps.listChannelIdSharers(projectId, channelId);
    try {
      return listSlackChannelIdSharers(projectId, channelId);
    } catch {
      return [];
    }
  }

  /**
   * Outbound prefix label — project name, else a short projectId stub. Reuses
   * the label cache the Telegram meta sync already fills (same projects, same
   * names); Slack gets its own sync in a follow-up and the fallback is
   * cosmetic either way.
   */
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

  // ── state persistence (dedup ring + pending queue) ────────────────────

  private stateFile(): string {
    return this.deps.statePath ?? DEFAULT_STATE_FILE;
  }

  private stateFor(projectId: string): ProjectState {
    let s = this.state[projectId];
    if (!s) {
      s = { seen: [], pending: [] };
      this.state[projectId] = s;
    }
    return s;
  }

  private pendingFor(projectId: string): PendingInbound[] {
    return this.state[projectId]?.pending ?? [];
  }

  private totalPending(): number {
    return Object.values(this.state).reduce(
      (sum, s) => sum + s.pending.length,
      0,
    );
  }

  /**
   * Record a dedup key. Returns true when it was ALREADY seen (⇒ skip). The
   * ring is bounded so a long-lived channel cannot grow the state file without
   * limit.
   */
  private markSeen(projectId: string, key: string): boolean {
    const state = this.stateFor(projectId);
    if (state.seen.includes(key)) return true;
    state.seen.push(key);
    const max = this.deps.maxSeenPerProject ?? DEFAULT_MAX_SEEN_PER_PROJECT;
    if (state.seen.length > max) {
      state.seen.splice(0, state.seen.length - max);
    }
    this.persistState();
    return false;
  }

  private loadState(): void {
    try {
      const raw = fs.readFileSync(this.stateFile(), "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return;
      const out: Record<string, ProjectState> = {};
      for (const [projectId, value] of Object.entries(
        parsed as Record<string, unknown>,
      )) {
        if (!value || typeof value !== "object" || Array.isArray(value))
          continue;
        const v = value as { seen?: unknown; pending?: unknown };
        out[projectId] = {
          seen: Array.isArray(v.seen)
            ? v.seen.filter((k): k is string => typeof k === "string")
            : [],
          pending: Array.isArray(v.pending)
            ? v.pending.filter(isPendingInbound)
            : [],
        };
      }
      this.state = out;
    } catch {
      // Missing/corrupt → start fresh. The cost is at most one duplicate
      // injection of a very recent message, never a silent loss.
      this.state = {};
    }
  }

  private persistState(): void {
    try {
      const file = this.stateFile();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), {
        encoding: "utf-8",
        mode: STATE_FILE_MODE,
      });
      fs.chmodSync(tmp, STATE_FILE_MODE);
      fs.renameSync(tmp, file);
      fs.chmodSync(file, STATE_FILE_MODE);
    } catch (err) {
      // Non-fatal: a failed persist only risks a duplicate/lost redelivery on
      // restart, and the in-memory state still drives this process.
      this.log.warn(
        `[SlackPoller] failed to persist state: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

// ─── module helpers (pure — unit-testable, no state) ──────────────────────

function emptyStats(): SlackReliabilityStats {
  return { unanswered: 0, sendFailures: 0, droppedOverflow: 0 };
}

/** Short, log-safe fingerprint of a token (never the token itself). */
function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 8);
}

function isPendingInbound(raw: unknown): raw is PendingInbound {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const p = raw as Partial<PendingInbound>;
  return (
    typeof p.key === "string" &&
    typeof p.channel === "string" &&
    typeof p.threadTs === "string" &&
    typeof p.text === "string"
  );
}

/**
 * Parse one Socket Mode frame. Returns null for anything that isn't a JSON
 * object — Slack only ever sends those, so a non-object frame is noise we must
 * not crash the socket handler over.
 */
export function parseSocketEnvelope(raw: string): SocketEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as SocketEnvelope;
  } catch {
    return null;
  }
}

/**
 * Remove our own `<@BOTID>` mention from the text so the orchestrator reads a
 * clean instruction rather than a raw Slack mention token. Other users'
 * mentions are left intact — they carry meaning.
 */
export function stripBotMention(
  text: string,
  botUserId: string | null,
): string {
  if (!botUserId) return text.trim();
  // `<@U123>` and the aliased `<@U123|name>` form.
  const re = new RegExp(`<@${escapeRegExp(botUserId)}(\\|[^>]*)?>`, "g");
  return text.replace(re, "").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Turn an Events API event into an actionable inbound, or null when it is not
 * ours to act on. The gate, in order:
 *   - only `message` / `app_mention` events (everything else is metadata);
 *   - no subtype (edits, deletes, joins, channel_topic … are not new asks);
 *   - never our own posts, and never any bot's (a bot loop is the classic way
 *     a channel integration melts down);
 *   - in a channel, the message must mention the bot. In a DM (`im`) it need
 *     not — the whole conversation is addressed to us. `app_mention` events
 *     are mentions by construction.
 *
 * The dedup key is `channel:ts` deliberately: Slack emits BOTH a `message` and
 * an `app_mention` for one channel mention, with different event ids but the
 * same channel+ts, so this key is what collapses the pair into one injection.
 */
export function extractInboundMessage(
  event: SlackEventPayload | undefined,
  botUserId: string | null,
): SlackInboundMessage | null {
  if (!event) return null;
  const type = event.type;
  if (type !== "message" && type !== "app_mention") return null;
  // Any subtype means "this is not a plain new user message".
  if (event.subtype) return null;
  if (event.bot_id) return null;
  if (!event.user) return null;
  if (botUserId && event.user === botUserId) return null;

  const channel = typeof event.channel === "string" ? event.channel : null;
  const ts = typeof event.ts === "string" ? event.ts : null;
  const rawText = typeof event.text === "string" ? event.text : "";
  if (!channel || !ts) return null;

  const isDirectMessage = event.channel_type === "im";
  const mentionsBot =
    type === "app_mention" ||
    (!!botUserId && rawText.includes(`<@${botUserId}`));
  // In a shared team channel, un-addressed chatter is not an instruction.
  if (!isDirectMessage && !mentionsBot) return null;

  const text = stripBotMention(rawText, botUserId);
  if (!text) return null; // a bare mention with no ask

  return {
    key: `${channel}:${ts}`,
    channel,
    // Reply into the message's thread; a top-level message starts one.
    threadTs:
      typeof event.thread_ts === "string" && event.thread_ts
        ? event.thread_ts
        : ts,
    user: event.user ?? null,
    text,
    isDirectMessage,
  };
}

/**
 * The text injected into the orchestrator PTY. Mirrors the Telegram wording
 * (including the "a plain text answer is NOT delivered" warning, which is what
 * makes the orchestrator actually call the tool) and adds the two things a team
 * channel needs: WHO asked (several people share one channel) and WHICH thread
 * to answer in.
 */
export function formatInboundInjection(
  projectId: string,
  inbound: {
    channel: string;
    threadTs: string;
    user: string | null;
    text: string;
  },
): string {
  const from = inbound.user ? `<@${inbound.user}>` : "unknown";
  return (
    `[Slack inbound from ${from} in channel ${inbound.channel} (thread ${inbound.threadTs})]: ${inbound.text}\n\n` +
    `이 프로젝트의 Slack 채널로 사용자가 보낸 메시지입니다. Slack 으로 답장하려면 ` +
    `marblo MCP 의 send_slack_message 도구를 호출하세요(projectId="${projectId}", threadTs="${inbound.threadTs}"). ` +
    `도구를 호출하지 않고 일반 텍스트로만 답하면 사용자에게 전달되지 않습니다. ` +
    `threadTs 를 그대로 넘기면 물어본 스레드에 답장이 달립니다.`
  );
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
    return { kind: "orchestrator", ptySessionId: null, status: "unknown" };
  }
}

/**
 * Whether an outbound postMessage error is worth retrying: 429 (rate limit) or
 * any 5xx from Slack, plus non-HTTP errors (network reset / timeout / abort).
 * A 4xx other than 429 (bad auth, bad channel) is permanent → no retry.
 */
export function isRetriableSendError(err: unknown): boolean {
  if (err instanceof SlackHttpError) {
    return err.status === 429 || err.status >= 500;
  }
  // Network-level failure (fetch threw) — transient, retry.
  return true;
}

/**
 * How long to wait before the next outbound retry. Honors Slack's `Retry-After`
 * (seconds) on a 429; otherwise exponential backoff from base.
 */
export function retryWaitMs(
  err: unknown,
  baseBackoffMs: number,
  attempt: number,
): number {
  if (err instanceof SlackHttpError && typeof err.retryAfter === "number") {
    return Math.max(0, err.retryAfter * 1000);
  }
  return baseBackoffMs * 2 ** attempt;
}
