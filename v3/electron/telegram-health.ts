/**
 * telegram-health — out-of-band Telegram poller health probe + minimal self-heal.
 *
 * ★WHY THIS EXISTS (ticket rDUJouZp — "연결 유지 중에도 텔레그램 MCP 간헐 끊김")
 *
 * The Telegram channel poller (`bun server.ts`) is a `--channels` MCP **stdio
 * grandchild** of the orchestrator's `claude` process. Its lifecycle is owned
 * entirely by claude's MCP host — Marblo neither spawns nor supervises it, so
 * Marblo CANNOT restart *just* the poller without restarting the whole
 * orchestrator session. That external limit is documented in
 * docs/TELEGRAM-CHANNEL-STABILITY.md.
 *
 * But Marblo DOES hold the bot token (telegram-channels store), so it can talk
 * to the Telegram Bot API out-of-band. That lets it do the two things that are
 * both within Marblo's control AND correct regardless of which disconnect cause
 * fired:
 *
 *   (1) FIX the one steady-state failure that never self-heals — a **webhook**
 *       registered on the bot. getUpdates + webhook are mutually exclusive in
 *       the Bot API: with a webhook set, getUpdates returns 409 Conflict
 *       *permanently*. The plugin retries 8× then EXITS its poll loop
 *       (external server.ts) → the poller process stays alive but is forever
 *       deaf. This is exactly the "connected but intermittently/permanently
 *       dead" report. `deleteWebhook` is the mechanism-correct remedy and needs
 *       no restart. (drop_pending_updates=false so queued messages still arrive
 *       once polling resumes.)
 *
 *   (2) OBSERVE liveness for the causes Marblo can't fix (mac sleep/wake TCP
 *       death, MCP stdio hiccup, plugin self-heal). getWebhookInfo returns
 *       `pending_update_count`: a live, consuming poller keeps it ~0; a climbing
 *       count means updates are piling up unconsumed = the poller is deaf.
 *       Marblo surfaces that so the user knows to reconnect the orchestrator.
 *
 * Invariants: never throws (network-safe — a wedged probe must not wedge the
 * wake handler), never logs or returns the bot token.
 */

import {
  listTelegramChannelConfigs,
  isTelegramChannelActive,
} from "./telegram-channels";

/** Result of a single channel's health probe. Contains NO secret material. */
export interface TelegramHealth {
  /** getWebhookInfo succeeded (API reachable + ok:true). */
  ok: boolean;
  /** A webhook was registered on the bot (⇒ getUpdates is 409-wedged). */
  webhookWasSet: boolean;
  /** We successfully deleted a registered webhook this probe. */
  webhookCleared: boolean;
  /**
   * Telegram's queued-but-unconsumed update backlog. ~0 for a live poller;
   * climbing ⇒ poller deaf. null if the probe failed before reading it.
   */
  pendingUpdateCount: number | null;
  /** Non-fatal diagnostic (token-scrubbed) when ok is false. */
  error?: string;
}

export interface ProbeOptions {
  /** Injectable fetch for tests. Defaults to global fetch (Node ≥ 18/22). */
  fetchImpl?: typeof fetch;
  /** Auto-delete a registered webhook when found. Default true. */
  deleteIfSet?: boolean;
  /** Per-request timeout (ms). Default 8000 — a hung probe must not wedge wake. */
  timeoutMs?: number;
}

const TELEGRAM_API = "https://api.telegram.org";
const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Strip any occurrence of the bot token from a diagnostic string. Exported so
 * every Telegram caller (health probe, poller inbound/outbound) can scrub the
 * token out of logs, errors, and tool return values — the token must NEVER
 * surface. Empty token is a no-op.
 */
export function scrubToken(msg: string, token: string): string {
  if (!token) return msg;
  return msg.split(token).join("<token>");
}

/** Parsed Telegram Bot API envelope. `result` shape is per-method. */
export interface TelegramApiResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
}

/**
 * A non-2xx HTTP response from the Bot API, carrying the status code and (for
 * 429) the server-advised `retry_after` seconds. Lets outbound callers decide
 * whether to retry and how long to wait. `message` is "HTTP <status>[: desc]";
 * the description never contains the token (Telegram doesn't echo it), but
 * callers still scrub before surfacing (belt-and-suspenders).
 */
export class TelegramHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfter?: number,
    message?: string,
  ) {
    super(message ?? `HTTP ${status}`);
    this.name = "TelegramHttpError";
  }
}

/** Options for a single {@link telegramApi} call. */
export interface TelegramApiOptions {
  /** Injectable fetch for tests. Defaults to global fetch (Node ≥ 18/22). */
  fetchImpl?: typeof fetch;
  /**
   * Per-request abort timeout (ms). Default 8000. Long-poll getUpdates callers
   * MUST pass a timeout LONGER than their `timeout` query param (else the abort
   * fires mid-poll). Default 8000.
   */
  timeoutMs?: number;
}

/**
 * Call one Telegram Bot API method with a hard timeout. `params` (when given)
 * is sent as a JSON POST body — Telegram accepts POST for every method, which
 * keeps values like message text out of the URL/query string. Returns the
 * parsed JSON envelope, or throws on network/timeout/non-2xx.
 *
 * ★The bot token lives ONLY in the URL path (`/bot<token>/<method>`) and is
 * never returned or logged here — callers scrub it from any diagnostic they
 * surface via {@link scrubToken}. Shared by the health probe (getWebhookInfo/
 * deleteWebhook) and the poller (getUpdates/sendMessage).
 */
export async function telegramApi<T = unknown>(
  token: string,
  method: string,
  params?: Record<string, unknown>,
  opts: TelegramApiOptions = {},
): Promise<TelegramApiResponse<T>> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const init: RequestInit = { signal: controller.signal };
    if (params !== undefined) {
      init.method = "POST";
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(params);
    }
    const res = await fetchImpl(`${TELEGRAM_API}/bot${token}/${method}`, init);
    if (!res.ok) {
      // Best-effort parse of the error envelope so 429 callers can honor
      // `retry_after` and surface a description. Never throws on parse failure.
      let retryAfter: number | undefined;
      let description: string | undefined;
      try {
        const body = (await res.json()) as {
          description?: string;
          parameters?: { retry_after?: number };
        };
        description =
          typeof body?.description === "string" ? body.description : undefined;
        const ra = body?.parameters?.retry_after;
        retryAfter = typeof ra === "number" ? ra : undefined;
      } catch {
        /* non-JSON error body — status alone still drives retry decisions */
      }
      throw new TelegramHttpError(
        res.status,
        retryAfter,
        description
          ? `HTTP ${res.status}: ${description}`
          : `HTTP ${res.status}`,
      );
    }
    return (await res.json()) as TelegramApiResponse<T>;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe a bot's getUpdates health and heal a webhook wedge if present.
 * See module header for the full rationale. Never throws.
 */
export async function probeAndHealTelegramWebhook(
  token: string,
  opts: ProbeOptions = {},
): Promise<TelegramHealth> {
  const trimmed = (token ?? "").trim();
  const base: TelegramHealth = {
    ok: false,
    webhookWasSet: false,
    webhookCleared: false,
    pendingUpdateCount: null,
  };
  if (!trimmed) {
    return { ...base, error: "empty token" };
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const deleteIfSet = opts.deleteIfSet ?? true;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const apiOpts: TelegramApiOptions = { fetchImpl, timeoutMs };

  try {
    const info = await telegramApi(
      trimmed,
      "getWebhookInfo",
      undefined,
      apiOpts,
    );
    if (!info.ok) {
      return {
        ...base,
        error: scrubToken(info.description ?? "getWebhookInfo not ok", trimmed),
      };
    }
    const result = (info.result ?? {}) as {
      url?: string;
      pending_update_count?: number;
    };
    const webhookWasSet =
      typeof result.url === "string" && result.url.length > 0;
    const pendingUpdateCount =
      typeof result.pending_update_count === "number"
        ? result.pending_update_count
        : null;

    let webhookCleared = false;
    if (webhookWasSet && deleteIfSet) {
      // drop_pending_updates=false: keep the backlog so messages queued while
      // the poller was wedged are delivered once getUpdates resumes.
      const del = await telegramApi(
        trimmed,
        "deleteWebhook",
        { drop_pending_updates: false },
        apiOpts,
      );
      webhookCleared = del.ok === true;
    }

    return {
      ok: true,
      webhookWasSet,
      webhookCleared,
      pendingUpdateCount,
    };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return { ...base, error: scrubToken(raw, trimmed) };
  }
}

/** Per-channel health report surfaced to callers (renderer/logs). No secrets. */
export interface ChannelHealthReport {
  projectId: string;
  health: TelegramHealth;
}

/**
 * Probe every ACTIVE Telegram channel's poller health and heal webhook wedges.
 *
 * Called on `system:wake` (mac sleep is the most common steady-state
 * disconnect trigger) and on a conservative interval (catches non-wake death:
 * a webhook appearing mid-session, or a silently deaf poller). Skips channels
 * that aren't active or have no token. Never throws.
 *
 * `onReport` (optional) receives each report for side-effects like broadcasting
 * to the renderer — kept as a callback so this module stays free of Electron
 * deps and unit-testable. Returns all reports for the caller to log/aggregate.
 */
export async function runTelegramChannelHealthCheck(
  reason: string,
  opts: ProbeOptions & {
    onReport?: (report: ChannelHealthReport) => void;
  } = {},
): Promise<ChannelHealthReport[]> {
  let configs;
  try {
    configs = listTelegramChannelConfigs();
  } catch {
    return [];
  }
  const active = configs.filter(
    (c) => c.botToken && isTelegramChannelActive(c.projectId),
  );
  if (active.length === 0) return [];

  const { onReport, ...probeOpts } = opts;
  const reports: ChannelHealthReport[] = [];
  for (const cfg of active) {
    const health = await probeAndHealTelegramWebhook(cfg.botToken!, probeOpts);
    const report: ChannelHealthReport = { projectId: cfg.projectId, health };
    reports.push(report);

    // Concise, token-free health line. Loud when action was taken or the poller
    // looks deaf; quiet-ish otherwise.
    if (health.webhookCleared) {
      console.warn(
        `[TelegramHealth:${reason}] project=${cfg.projectId} — removed a stray webhook that was ` +
          `409-wedging getUpdates (pending=${health.pendingUpdateCount ?? "?"}). Poller can now recover.`,
      );
    } else if (!health.ok) {
      console.warn(
        `[TelegramHealth:${reason}] project=${cfg.projectId} — probe failed: ${health.error ?? "unknown"}`,
      );
    } else if (
      typeof health.pendingUpdateCount === "number" &&
      health.pendingUpdateCount > 0
    ) {
      console.warn(
        `[TelegramHealth:${reason}] project=${cfg.projectId} — ${health.pendingUpdateCount} updates queued ` +
          `unconsumed: the channel poller may be deaf. If inbound stays silent, restart/reconnect the orchestrator.`,
      );
    } else {
      console.log(
        `[TelegramHealth:${reason}] project=${cfg.projectId} — poller healthy (no webhook, backlog clear).`,
      );
    }

    if (onReport) {
      try {
        onReport(report);
      } catch {
        // A broken listener must never break the health sweep.
      }
    }
  }
  return reports;
}
