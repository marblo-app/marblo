/**
 * Codex account rate-limit probe.
 *
 * Codex rollouts carry rate-limit snapshots, but they only exist after a
 * Codex session has run. The Usage tab needs account-global Codex limits even
 * with zero agents, so we ask the authenticated Codex app-server directly:
 *
 *   codex app-server --stdio
 *   → {"id":1,"method":"initialize",...}
 *   → {"id":2,"method":"account/rateLimits/read","params":{}}
 *
 * Verified against codex-cli 0.142.2. The request sends no model message and
 * only reads the current account plan utilization.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import type { RateLimitInfo } from "./session-parsers";

export interface CodexUsageSnapshot extends RateLimitInfo {
  /** When this snapshot was captured (epoch ms). */
  capturedAt: number;
}

export const CODEX_RATE_LIMIT_TIMEOUT_MS = 20_000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function pctOrNull(v: unknown): number | null {
  const n = numOrNull(v);
  return n === null ? null : Math.min(100, Math.max(0, n));
}

function pickNumber(...values: unknown[]): number | null {
  for (const v of values) {
    const n = numOrNull(v);
    if (n !== null) return n;
  }
  return null;
}

function pickString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return null;
}

function resetEpochSeconds(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === "string") {
    const ms = Date.parse(v);
    if (!Number.isNaN(ms)) return Math.floor(ms / 1000);
  }
  return null;
}

function hasValue(name: string): boolean {
  const v = process.env[name];
  return typeof v === "string" && v.trim().length > 0;
}

function hasUsableCodexAuth(codexHome: string): boolean {
  const authPath = path.join(codexHome, "auth.json");
  if (!fs.existsSync(authPath)) return false;
  try {
    const raw = JSON.parse(fs.readFileSync(authPath, "utf-8")) as unknown;
    if (!isRecord(raw)) return false;
    if (
      typeof raw.OPENAI_API_KEY === "string" &&
      raw.OPENAI_API_KEY.length > 0
    ) {
      return true;
    }
    if (isRecord(raw.tokens)) return true;
    return Object.keys(raw).length > 0;
  } catch {
    return false;
  }
}

function findExecutableOnPath(command: string): string | null {
  const pathEnv = process.env.PATH;
  if (!pathEnv) return null;
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = path.join(dir, `${command}${ext}`);
      try {
        fs.accessSync(full, fs.constants.X_OK);
        return full;
      } catch {
        // try next PATH entry
      }
    }
  }
  return null;
}

function buildProbeEnv(): NodeJS.ProcessEnv | null {
  if (hasValue("OPENAI_API_KEY")) return process.env;

  const envCodexHome = process.env.CODEX_HOME;
  if (envCodexHome && hasUsableCodexAuth(envCodexHome)) return process.env;

  const userCodexHome = path.join(os.homedir(), ".codex");
  if (hasUsableCodexAuth(userCodexHome)) {
    const env: NodeJS.ProcessEnv = { ...process.env };
    // A stale per-agent CODEX_HOME would make app-server miss ~/.codex auth.
    delete env.CODEX_HOME;
    return env;
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
    percent: pctOrNull(
      pickNumber(
        v.usedPercent,
        v.used_percent,
        v.percentUsed,
        v.percent_used,
        v.used,
      ),
    ),
    resetAt: resetEpochSeconds(v.resetsAt ?? v.resets_at ?? v.resetAt),
  };
}

function rateLimitsFromResult(result: unknown): unknown {
  if (!isRecord(result)) return null;
  if (isRecord(result.rateLimits)) return result.rateLimits;
  const byId = result.rateLimitsByLimitId;
  if (!isRecord(byId)) return null;
  if (isRecord(byId.codex)) return byId.codex;
  for (const value of Object.values(byId)) {
    if (!isRecord(value)) continue;
    if (
      isRecord(value.primary) ||
      isRecord(value.secondary) ||
      isRecord(value.fiveHour) ||
      isRecord(value.five_hour) ||
      isRecord(value.sevenDay) ||
      isRecord(value.seven_day) ||
      isRecord(value.weekly)
    ) {
      return value;
    }
  }
  return null;
}

export function parseRateLimitsReadResponse(
  obj: unknown,
  requestId: number,
): CodexUsageSnapshot | null {
  if (!isRecord(obj) || obj.id !== requestId || !isRecord(obj.result)) {
    return null;
  }
  const rateLimits = rateLimitsFromResult(obj.result);
  if (!isRecord(rateLimits)) return null;
  const primary = readWindow(
    rateLimits.primary ?? rateLimits.fiveHour ?? rateLimits.five_hour,
  );
  const secondary = readWindow(
    rateLimits.secondary ??
      rateLimits.sevenDay ??
      rateLimits.seven_day ??
      rateLimits.weekly,
  );
  if (primary.percent === null && secondary.percent === null) return null;
  return {
    planType: pickString(
      rateLimits.planType,
      rateLimits.plan_type,
      rateLimits.subscriptionType,
      rateLimits.subscription_type,
    ),
    primaryPercent: primary.percent,
    primaryResetAt: primary.resetAt,
    secondaryPercent: secondary.percent,
    secondaryResetAt: secondary.resetAt,
    capturedAt: Date.now(),
  };
}

function isJsonRpcError(obj: unknown, requestId: number): boolean {
  return isRecord(obj) && obj.id === requestId && isRecord(obj.error);
}

/**
 * Spawn Codex app-server, read account rate limits, then terminate it.
 * Returns null quietly when Codex is missing, unauthenticated, times out, or
 * returns an unexpected shape. Callers should fall back to rollout parsing.
 */
export function probeCodexUsage(
  timeoutMs: number = CODEX_RATE_LIMIT_TIMEOUT_MS,
): Promise<CodexUsageSnapshot | null> {
  return new Promise((resolve) => {
    const codexCommand = findExecutableOnPath("codex");
    const env = buildProbeEnv();
    if (!codexCommand || !env) {
      resolve(null);
      return;
    }

    const initializeId = 1;
    const rateLimitsId = 2;

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(codexCommand, ["app-server", "--stdio"], {
        cwd: os.tmpdir(),
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      resolve(null);
      return;
    }

    let settled = false;
    const finish = (snap: CodexUsageSnapshot | null): void => {
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

    const timer = setTimeout(() => finish(null), timeoutMs);

    let initialized = false;
    let buf = "";

    // Parse a single stdout line. Returns true on a terminal outcome (our
    // snapshot or an error response for us), at which point finish() has run.
    const tryLine = (line: string): boolean => {
      let obj: unknown;
      try {
        obj = JSON.parse(line);
      } catch {
        return false;
      }

      if (!initialized && isRecord(obj) && obj.id === initializeId) {
        initialized = true;
        if (isJsonRpcError(obj, initializeId)) {
          finish(null);
          return true;
        }
        try {
          child.stdin?.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: rateLimitsId,
              method: "account/rateLimits/read",
              params: {},
            }) + "\n",
          );
        } catch {
          finish(null);
          return true;
        }
        return false;
      }

      const snap = parseRateLimitsReadResponse(obj, rateLimitsId);
      if (snap) {
        finish(snap);
        return true;
      }
      if (isJsonRpcError(obj, rateLimitsId)) {
        finish(null);
        return true;
      }
      return false;
    };

    // Drain newline-terminated lines from buf. When `flush` is set (stdout
    // ended or process exited), also try the unterminated tail: the rateLimits
    // response can land without a trailing newline right before exit, and
    // dropping it is the lost-response race this probe shares with claude.
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

    // stdout fully drained: flush the tail before resolving null.
    child.stdout?.on("end", () => {
      if (!drain(true)) finish(null);
    });

    child.on("error", () => finish(null));
    // Exit can beat stdout's final 'data'/'end'; flush the buffer before
    // giving up. The `settled` guard keeps this idempotent with 'end'.
    child.on("exit", () => {
      if (!drain(true)) finish(null);
    });

    try {
      child.stdin?.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: initializeId,
          method: "initialize",
          params: {
            clientInfo: { name: "marblo", version: "0.0.0" },
          },
        }) + "\n",
      );
    } catch {
      finish(null);
    }
  });
}
