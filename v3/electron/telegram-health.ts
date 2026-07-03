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

/** Strip any occurrence of the bot token from a diagnostic string. */
function scrub(msg: string, token: string): string {
  if (!token) return msg;
  return msg.split(token).join("<token>");
}

/**
 * Call one Telegram Bot API method with a hard timeout. Returns parsed JSON, or
 * throws on network/timeout/non-2xx. The token lives only in the URL path and
 * is never returned or logged by callers (see scrub()).
 */
async function callApi(
  token: string,
  method: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<{ ok: boolean; result?: unknown; description?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${TELEGRAM_API}/bot${token}/${method}`, {
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as {
      ok: boolean;
      result?: unknown;
      description?: string;
    };
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

  try {
    const info = await callApi(trimmed, "getWebhookInfo", fetchImpl, timeoutMs);
    if (!info.ok) {
      return {
        ...base,
        error: scrub(info.description ?? "getWebhookInfo not ok", trimmed),
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
      const del = await callApi(trimmed, "deleteWebhook", fetchImpl, timeoutMs);
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
    return { ...base, error: scrub(raw, trimmed) };
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
