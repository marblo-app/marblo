/**
 * Claude account rate-limit probe (Phase 1b).
 *
 * Claude Code session JSONLs carry no rate-limit data (unlike codex
 * rollouts), and the statusline JSON — which DOES carry `rate_limits`
 * (five_hour / seven_day used % + resets_at) — is only emitted to the
 * statusLine command in interactive TUI sessions, never in -p/--print mode
 * (verified empirically on claude CLI 2.1.172: a statusline command injected
 * via --settings is never invoked under -p).
 *
 * The official headless path is the SDK control protocol: writing a
 * `get_usage` control request to a stream-json stdin returns the structured
 * /usage data (account-global plan rate-limit utilization + subscription
 * type) WITHOUT sending any conversation message — no model call is made,
 * `total_cost_usd` stays 0, and the response arrives in ~1s.
 *
 * Verified request/response against claude CLI 2.1.172:
 *   → {"type":"control_request","request_id":"…","request":{"subtype":"get_usage"}}
 *   ← {"type":"control_response","response":{"subtype":"success","request_id":"…",
 *        "response":{"subscription_type":"max","rate_limits_available":true,
 *          "rate_limits":{
 *            "five_hour":{"utilization":23,"resets_at":"2026-06-11T06:00:00+00:00"},
 *            "seven_day":{"utilization":16,"resets_at":"2026-06-12T06:00:00+00:00"},
 *            …}}}}
 *
 * Upstream marks this API Experimental (the SDK method is literally named
 * `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET`), so parsing
 * is strictly defensive: any unexpected shape resolves to null, and callers
 * must treat null as "no information" — never as zero usage.
 */

import os from "os";
import { spawn } from "child_process";
import type { RateLimitInfo } from "./session-parsers";

/** Account-global usage snapshot with capture time for staleness checks. */
export interface ClaudeUsageSnapshot extends RateLimitInfo {
  /** When this snapshot was captured (epoch ms). */
  capturedAt: number;
}

export const GET_USAGE_TIMEOUT_MS = 20_000;

/**
 * CLI args for a minimal, isolated probe session. The flags keep the spawn
 * cheap and side-effect free: no user/project settings (so no hooks), no MCP
 * servers, no session file on disk, no skills.
 */
export function buildProbeArgs(): string[] {
  return [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose", // stream-json output requires it under --print
    "--model",
    "haiku", // never used (no message is sent) — avoids default-model setup
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--no-session-persistence",
    "--disable-slash-commands",
  ];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Clamp a used-% reading into 0–100 (defensive against bad upstream data). */
function pctOrNull(v: unknown): number | null {
  const n = numOrNull(v);
  return n === null ? null : Math.min(100, Math.max(0, n));
}

/** resets_at arrives as an ISO string (2.1.172); accept epoch seconds too. */
function resetEpochSeconds(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === "string") {
    const ms = Date.parse(v);
    if (!Number.isNaN(ms)) return Math.floor(ms / 1000);
  }
  return null;
}

interface WindowReading {
  percent: number | null;
  resetAt: number | null;
}

function readWindow(v: unknown): WindowReading {
  if (!isRecord(v)) return { percent: null, resetAt: null };
  return {
    percent: pctOrNull(v.utilization),
    resetAt: resetEpochSeconds(v.resets_at),
  };
}

/**
 * Parse one stream-json line against our pending get_usage request.
 * Returns the snapshot on a matching success response with at least one
 * usable window reading; null otherwise (not ours / malformed / no data).
 */
export function parseGetUsageResponse(
  obj: unknown,
  requestId: string,
): ClaudeUsageSnapshot | null {
  if (!isRecord(obj) || obj.type !== "control_response") return null;
  const resp = obj.response;
  if (!isRecord(resp) || resp.request_id !== requestId) return null;
  if (resp.subtype !== "success") return null;
  const body = resp.response;
  if (!isRecord(body)) return null;
  // rate_limits_available:false = plan limits don't apply to this auth mode
  // (API key / Bedrock / Vertex) — there is genuinely no data to report.
  if (body.rate_limits_available === false) return null;
  if (!isRecord(body.rate_limits)) return null;
  const fiveHour = readWindow(body.rate_limits.five_hour);
  const sevenDay = readWindow(body.rate_limits.seven_day);
  if (fiveHour.percent === null && sevenDay.percent === null) return null;
  return {
    planType:
      typeof body.subscription_type === "string"
        ? body.subscription_type
        : null,
    primaryPercent: fiveHour.percent,
    primaryResetAt: fiveHour.resetAt,
    secondaryPercent: sevenDay.percent,
    secondaryResetAt: sevenDay.resetAt,
    capturedAt: Date.now(),
  };
}

/**
 * True when this line is an error control_response to OUR request — e.g. an
 * older CLI that doesn't know the get_usage subtype. Lets the caller stop
 * waiting instead of burning the full timeout.
 */
export function isGetUsageError(obj: unknown, requestId: string): boolean {
  if (!isRecord(obj) || obj.type !== "control_response") return false;
  const resp = obj.response;
  if (!isRecord(resp) || resp.request_id !== requestId) return false;
  return resp.subtype === "error";
}

/**
 * Spawn a short-lived headless claude session, ask it for the account's
 * current plan rate-limit utilization, and kill it. Resolves null on any
 * failure (spawn error, timeout, error response, unusable shape) — callers
 * surface that as "no information", not as a value.
 *
 * @param claudeCommand absolute path to the claude binary (callers should
 *   pass `resolveClaudeBinary().command` so a stale shadow install is never
 *   probed).
 */
export function probeClaudeUsage(
  claudeCommand: string,
  timeoutMs: number = GET_USAGE_TIMEOUT_MS,
): Promise<ClaudeUsageSnapshot | null> {
  return new Promise((resolve) => {
    const requestId = `marblo-get-usage-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(claudeCommand, buildProbeArgs(), {
        // Neutral cwd: never scan a real project's CLAUDE.md / trust state.
        cwd: os.tmpdir(),
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      console.warn(
        "[ClaudeUsageProbe] spawn failed:",
        err instanceof Error ? err.message : err,
      );
      resolve(null);
      return;
    }

    let settled = false;
    const finish = (snap: ClaudeUsageSnapshot | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        // already gone
      }
      resolve(snap);
    };

    const timer = setTimeout(() => {
      console.warn(`[ClaudeUsageProbe] get_usage timed out (${timeoutMs}ms)`);
      finish(null);
    }, timeoutMs);

    let buf = "";

    // Parse a single stdout line; calls finish() and returns true on a
    // terminal outcome (our success snapshot or an error response for us).
    const tryLine = (line: string): boolean => {
      let obj: unknown;
      try {
        obj = JSON.parse(line);
      } catch {
        return false; // non-JSON noise on stdout
      }
      const snap = parseGetUsageResponse(obj, requestId);
      if (snap) {
        finish(snap);
        return true;
      }
      if (isGetUsageError(obj, requestId)) {
        console.warn(
          "[ClaudeUsageProbe] get_usage rejected by CLI (old version?)",
        );
        finish(null);
        return true;
      }
      return false;
    };

    // Drain complete (newline-terminated) lines from buf. When `flush` is set
    // — i.e. stdout has ended or the process exited — also try whatever tail
    // remains in buf: the final response can arrive without a trailing newline
    // right before exit, and dropping it is exactly the lost-response race.
    // Returns true once a terminal outcome is reached.
    const drain = (flush: boolean): boolean => {
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line && tryLine(line)) return true;
      }
      if (flush) {
        const tail = buf.trim();
        buf = "";
        if (tail && tryLine(tail)) return true;
      }
      return false;
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf-8");
      drain(false);
    });

    // stdout fully drained — the authoritative "no more output" signal. Flush
    // the tail before giving up so a valid final line is never discarded.
    child.stdout?.on("end", () => {
      if (!drain(true)) finish(null);
    });

    child.on("error", (err) => {
      console.warn("[ClaudeUsageProbe] process error:", err.message);
      finish(null);
    });
    // Exit can fire before stdout's final 'data'/'end' is processed. Flush the
    // buffer first (a valid response may sit unparsed in the tail) and only
    // then resolve null. The `settled` guard makes this idempotent with the
    // 'end' path, so whichever fires first wins.
    child.on("exit", () => {
      if (!drain(true)) finish(null);
    });

    try {
      child.stdin?.write(
        JSON.stringify({
          type: "control_request",
          request_id: requestId,
          request: { subtype: "get_usage" },
        }) + "\n",
      );
    } catch (err) {
      console.warn(
        "[ClaudeUsageProbe] stdin write failed:",
        err instanceof Error ? err.message : err,
      );
      finish(null);
    }
  });
}
