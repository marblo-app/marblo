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
    percent: pctOrNull(v.usedPercent),
    resetAt: resetEpochSeconds(v.resetsAt),
  };
}

function rateLimitsFromResult(result: unknown): unknown {
  if (!isRecord(result)) return null;
  if (isRecord(result.rateLimits)) return result.rateLimits;
  const byId = result.rateLimitsByLimitId;
  if (!isRecord(byId)) return null;
  return isRecord(byId.codex) ? byId.codex : null;
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
  const primary = readWindow(rateLimits.primary);
  const secondary = readWindow(rateLimits.secondary);
  if (primary.percent === null && secondary.percent === null) return null;
  return {
    planType:
      typeof rateLimits.planType === "string" ? rateLimits.planType : null,
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
    child.stdout?.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf-8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let obj: unknown;
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }

        if (!initialized && isRecord(obj) && obj.id === initializeId) {
          initialized = true;
          if (isJsonRpcError(obj, initializeId)) {
            finish(null);
            return;
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
          }
          continue;
        }

        const snap = parseRateLimitsReadResponse(obj, rateLimitsId);
        if (snap) {
          finish(snap);
          return;
        }
        if (isJsonRpcError(obj, rateLimitsId)) {
          finish(null);
          return;
        }
      }
    });

    child.on("error", () => finish(null));
    child.on("exit", () => finish(null));

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
