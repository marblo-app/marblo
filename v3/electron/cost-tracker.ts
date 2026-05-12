/**
 * Cost tracker — two strategies:
 *   1. Claude sessions: parse JSONL session files for message.usage (accurate)
 *   2. Other CLIs: parse PTY output for token/cost patterns (best-effort)
 * Read-only observer: does not affect PTY data flow.
 */

import fs from "fs";
import path from "path";
import os from "os";
import readline from "readline";

export interface CostEntry {
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  model: string;
  timestamp: number;
  // Delta (incremental) values for this poll interval
  deltaInputTokens: number;
  deltaOutputTokens: number;
  deltaCacheReadTokens: number;
  deltaCacheWriteTokens: number;
  deltaCost: number;
}

// Patent claim 8 (단락 256-264): 서로 다른 과금체계가 적용되는 2 이상의
// 에이전트별로, 사용량과 과금체계에 기초하여 개별 과금량을 산출하고,
// 이를 합산해 통합과금량을 산출한다. 명세서는 "특정 에이전트는 구독제로
// 요금이 책정될 수 있고, 다른 에이전트는 토큰 수에 따라 비용이 부과될 수
// 있다" 를 명시 — 그래서 두 종류의 PricingScheme 을 분리해 모델링한다.
export type PricingScheme = "per-token" | "subscription";

interface PerTokenPricing {
  scheme: "per-token";
  inputPer1M: number;
  outputPer1M: number;
}

interface SubscriptionPricing {
  scheme: "subscription";
  /** Flat monthly fee in USD (e.g. Claude Max $200, ChatGPT Plus $20). */
  monthlyFlatUsd: number;
  /**
   * Optional soft monthly token allowance. Below this we attribute usage
   * against the flat fee (no incremental cost). Above it we fall back to
   * `overagePerToken` for the excess.
   */
  monthlyTokenAllowance?: number;
  /** Per-token pricing applied only when allowance is exceeded. */
  overagePerToken?: { inputPer1M: number; outputPer1M: number };
}

type ModelPricing = PerTokenPricing | SubscriptionPricing;

/** Raw per-token rate row in the literal MODEL_PRICING table (sans the
 * `scheme` discriminator — that's lifted in by `findPricing`). */
type RawTokenRate = { inputPer1M: number; outputPer1M: number };

// Active subscription plans the user has declared via settings. Keyed
// by model prefix (matched longest-first by `findPricing`). Loaded from
// `~/.marblo/subscription-plans.json` at app start so the per-agent
// MCP servers see the same plan map (they re-load the file on first
// pricing lookup).
const SUBSCRIPTION_PLANS_FILE = path.join(
  os.homedir(),
  ".marblo",
  "subscription-plans.json",
);

interface SubscriptionPlanEntry {
  /** Model id prefix this plan applies to (e.g. "claude-opus", "gpt-5") */
  modelPrefix: string;
  monthlyFlatUsd: number;
  monthlyTokenAllowance?: number;
  overagePerToken?: { inputPer1M: number; outputPer1M: number };
}

let subscriptionPlanCache: SubscriptionPlanEntry[] | null = null;
let subscriptionPlanCacheMtime = 0;

function loadSubscriptionPlans(): SubscriptionPlanEntry[] {
  try {
    if (!fs.existsSync(SUBSCRIPTION_PLANS_FILE)) {
      subscriptionPlanCache = [];
      return [];
    }
    const stat = fs.statSync(SUBSCRIPTION_PLANS_FILE);
    if (subscriptionPlanCache && stat.mtimeMs === subscriptionPlanCacheMtime) {
      return subscriptionPlanCache;
    }
    const raw = fs.readFileSync(SUBSCRIPTION_PLANS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as SubscriptionPlanEntry[];
    subscriptionPlanCache = Array.isArray(parsed) ? parsed : [];
    subscriptionPlanCacheMtime = stat.mtimeMs;
    return subscriptionPlanCache;
  } catch (err) {
    console.error(
      "[CostTracker] Failed to load subscription plans:",
      err instanceof Error ? err.message : err,
    );
    subscriptionPlanCache = [];
    return [];
  }
}

const MODEL_PRICING: Record<string, RawTokenRate> = {
  // Claude 4.x family
  "claude-opus-4-7": { inputPer1M: 15, outputPer1M: 75 },
  "claude-opus-4-6": { inputPer1M: 15, outputPer1M: 75 },
  "claude-opus-4-0": { inputPer1M: 15, outputPer1M: 75 },
  "claude-sonnet-4-6": { inputPer1M: 3, outputPer1M: 15 },
  "claude-sonnet-4-0": { inputPer1M: 3, outputPer1M: 15 },
  "claude-haiku-4-5": { inputPer1M: 0.8, outputPer1M: 4 },
  // Claude 3.x family (legacy)
  "claude-3-5-sonnet": { inputPer1M: 3, outputPer1M: 15 },
  "claude-3-5-haiku": { inputPer1M: 0.8, outputPer1M: 4 },
  "claude-3-opus": { inputPer1M: 15, outputPer1M: 75 },
  // OpenAI
  "gpt-5.5": { inputPer1M: 5, outputPer1M: 20 },
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10 },
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gpt-4.1": { inputPer1M: 2, outputPer1M: 8 },
  "gpt-4.1-mini": { inputPer1M: 0.4, outputPer1M: 1.6 },
  "gpt-4.1-nano": { inputPer1M: 0.1, outputPer1M: 0.4 },
  o3: { inputPer1M: 10, outputPer1M: 40 },
  "o3-mini": { inputPer1M: 1.1, outputPer1M: 4.4 },
  "o4-mini": { inputPer1M: 1.1, outputPer1M: 4.4 },
  // Gemini
  "gemini-2.5-pro": { inputPer1M: 1.25, outputPer1M: 10 },
  "gemini-2.5-flash": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gemini-2.0-flash": { inputPer1M: 0.1, outputPer1M: 0.4 },
  // Fallback
  default: { inputPer1M: 3, outputPer1M: 15 },
};

// Regex patterns for PTY output parsing (non-Claude CLIs)
const COST_PATTERN =
  /(?:Total cost|Cost|Session cost)[:\s]*\$([0-9]+\.?[0-9]*)/i;
const INPUT_TOKENS_PATTERN = /(?:input)[\s]*(?:tokens)?[:\s]*([0-9,]+)/i;
const OUTPUT_TOKENS_PATTERN = /(?:output)[\s]*(?:tokens)?[:\s]*([0-9,]+)/i;

const MAX_BUFFER_SIZE = 2048;
const SESSION_POLL_INTERVAL_MS = 15_000; // poll JSONL every 15s

interface SessionTracker {
  agentId: string;
  filePath: string;
  model: string;
  lastLineCount: number;
  accumulated: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
  timer: ReturnType<typeof setInterval>;
}

export class CostTracker {
  private buffers: Map<string, string> = new Map();
  private sessions: Map<string, SessionTracker> = new Map();
  private onCostDetected?: (agentId: string, cost: CostEntry) => void;

  constructor(onCostDetected?: (agentId: string, cost: CostEntry) => void) {
    this.onCostDetected = onCostDetected;
  }

  /**
   * Resolve the pricing scheme for a model.
   *
   * Subscription plans declared in `~/.marblo/subscription-plans.json`
   * win over per-token defaults — patent claim 8 explicitly contemplates
   * mixing 구독제 and 토큰단위 across agents in one orchestration. If the
   * model has no subscription declared, fall back to the per-token rate
   * table (longest-prefix match). Sentinel "default" row is the last
   * resort so unknown models still produce a sensible cost figure.
   */
  private findPricing(model: string): ModelPricing {
    // 1. Subscription plans win when the user has declared one for this model.
    const plans = loadSubscriptionPlans();
    const matchedPlan = plans
      .filter((p) => model.startsWith(p.modelPrefix))
      .sort((a, b) => b.modelPrefix.length - a.modelPrefix.length)[0];
    if (matchedPlan) {
      return {
        scheme: "subscription",
        monthlyFlatUsd: matchedPlan.monthlyFlatUsd,
        monthlyTokenAllowance: matchedPlan.monthlyTokenAllowance,
        overagePerToken: matchedPlan.overagePerToken,
      };
    }
    // 2. Per-token rate (default).
    const wrap = (r: RawTokenRate): PerTokenPricing => ({
      scheme: "per-token",
      inputPer1M: r.inputPer1M,
      outputPer1M: r.outputPer1M,
    });
    if (MODEL_PRICING[model]) return wrap(MODEL_PRICING[model]);
    const keys = Object.keys(MODEL_PRICING)
      .filter((k) => k !== "default")
      .sort((a, b) => b.length - a.length);
    for (const key of keys) {
      if (model.startsWith(key)) return wrap(MODEL_PRICING[key]);
    }
    return wrap(MODEL_PRICING["default"]);
  }

  /**
   * Compute USD cost for a given (input, output) token bundle under the
   * resolved pricing scheme. Single chokepoint so subscription / per-token
   * math lives in one place — patent claim 8 통합과금량 산출 시 호출자가
   * scheme 별 분기를 신경쓰지 않게 한다.
   *
   * For subscription scheme:
   *   - within `monthlyTokenAllowance`: incremental cost = 0 (the flat
   *     monthly fee covers it; the fee itself is reported as a separate
   *     rollup line, not per-call)
   *   - over allowance: charge `overagePerToken` rate for excess only
   *   - allowance accounting requires `accumulatedTokens` (cumulative for
   *     the month so far) so the caller can detect the crossover
   */
  computeIncrementalCost(
    pricing: ModelPricing,
    deltaInputTokens: number,
    deltaOutputTokens: number,
    accumulatedInputTokens = 0,
    accumulatedOutputTokens = 0,
  ): number {
    if (pricing.scheme === "per-token") {
      return (
        (deltaInputTokens * pricing.inputPer1M +
          deltaOutputTokens * pricing.outputPer1M) /
        1_000_000
      );
    }
    // subscription
    if (!pricing.monthlyTokenAllowance || !pricing.overagePerToken) {
      // Pure flat-fee plan with no overage — incremental cost is 0;
      // the flat monthly fee is rolled up separately.
      return 0;
    }
    const totalAfter =
      accumulatedInputTokens +
      accumulatedOutputTokens +
      deltaInputTokens +
      deltaOutputTokens;
    const totalBefore = accumulatedInputTokens + accumulatedOutputTokens;
    const allowance = pricing.monthlyTokenAllowance;
    if (totalAfter <= allowance) return 0;
    // Some or all of this delta crossed the allowance. Charge only the
    // portion above allowance, split proportionally across input/output.
    const overageDelta = Math.min(
      deltaInputTokens + deltaOutputTokens,
      totalAfter - Math.max(totalBefore, allowance),
    );
    if (overageDelta <= 0) return 0;
    const totalDelta = deltaInputTokens + deltaOutputTokens || 1;
    const overInput = (deltaInputTokens / totalDelta) * overageDelta;
    const overOutput = (deltaOutputTokens / totalDelta) * overageDelta;
    return (
      (overInput * pricing.overagePerToken.inputPer1M +
        overOutput * pricing.overagePerToken.outputPer1M) /
      1_000_000
    );
  }

  // ── Strategy 1: Claude JSONL Session File Tracking ──────────

  /**
   * Start tracking a Claude session JSONL file for token usage.
   * If sessionId is provided, tracks that specific file.
   * If sessionId is null/undefined, finds the most recent JSONL in the project dir.
   */
  trackSession(
    agentId: string,
    rootPath: string,
    sessionId: string | null | undefined,
    model: string,
  ): void {
    // Don't double-track
    if (this.sessions.has(agentId)) {
      this.stopSession(agentId);
    }

    const encodedPath = rootPath.replace(/\//g, "-");
    const projectDir = path.join(
      os.homedir(),
      ".claude",
      "projects",
      encodedPath,
    );

    let filePath: string;
    if (sessionId) {
      filePath = path.join(projectDir, `${sessionId}.jsonl`);
    } else {
      // Find the most recently modified JSONL file
      try {
        const files = fs
          .readdirSync(projectDir)
          .filter((f) => f.endsWith(".jsonl"))
          .map((f) => ({
            name: f,
            mtime: fs.statSync(path.join(projectDir, f)).mtimeMs,
          }))
          .sort((a, b) => b.mtime - a.mtime);
        if (files.length === 0) {
          console.warn(`[CostTracker] No JSONL files found in ${projectDir}`);
          return;
        }
        filePath = path.join(projectDir, files[0].name);
        console.log(
          `[CostTracker] No sessionId — using most recent: ${files[0].name}`,
        );
      } catch {
        console.warn(`[CostTracker] Cannot read project dir: ${projectDir}`);
        return;
      }
    }

    if (!fs.existsSync(filePath)) {
      console.warn(`[CostTracker] Session file not found: ${filePath}`);
      return;
    }

    const tracker: SessionTracker = {
      agentId,
      filePath,
      model,
      lastLineCount: 0,
      accumulated: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      timer: setInterval(
        () => this.pollSessionFile(agentId),
        SESSION_POLL_INTERVAL_MS,
      ),
    };

    this.sessions.set(agentId, tracker);
    console.log(
      `[CostTracker] Tracking session file for agent=${agentId}: ${filePath}`,
    );

    // Do an initial scan right away
    this.pollSessionFile(agentId);
  }

  stopSession(agentId: string): void {
    const tracker = this.sessions.get(agentId);
    if (tracker) {
      clearInterval(tracker.timer);
      this.sessions.delete(agentId);
    }
  }

  private async pollSessionFile(agentId: string): Promise<void> {
    const tracker = this.sessions.get(agentId);
    if (!tracker) return;

    try {
      const { filePath, lastLineCount } = tracker;
      if (!fs.existsSync(filePath)) return;

      // Read file line by line
      const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
      const rl = readline.createInterface({
        input: stream,
        crlfDelay: Infinity,
      });

      let lineNum = 0;
      let newInput = 0;
      let newOutput = 0;
      let newCacheRead = 0;
      let newCacheWrite = 0;
      let detectedModel = tracker.model;

      for await (const line of rl) {
        lineNum++;
        // Skip already-processed lines
        if (lineNum <= lastLineCount) continue;

        try {
          const entry = JSON.parse(line);
          if (entry.type === "assistant" && entry.message?.usage) {
            const u = entry.message.usage;
            newInput += u.input_tokens || 0;
            newOutput += u.output_tokens || 0;
            newCacheRead += u.cache_read_input_tokens || 0;
            newCacheWrite += u.cache_creation_input_tokens || 0;

            // Detect model from the message
            if (entry.message.model) {
              detectedModel = entry.message.model;
            }
          }
        } catch {
          // Skip malformed lines
        }
      }

      tracker.lastLineCount = lineNum;
      tracker.model = detectedModel;

      // Only fire callback if new tokens detected
      if (
        newInput > 0 ||
        newOutput > 0 ||
        newCacheRead > 0 ||
        newCacheWrite > 0
      ) {
        tracker.accumulated.inputTokens += newInput;
        tracker.accumulated.outputTokens += newOutput;
        tracker.accumulated.cacheReadTokens += newCacheRead;
        tracker.accumulated.cacheWriteTokens += newCacheWrite;

        const acc = tracker.accumulated;

        // Patent claim 8: route through pricing-scheme aware calculator.
        // For per-token models this is the same arithmetic as before; for
        // subscription models the incremental cost is 0 within allowance
        // and only over-allowance excess gets per-token charged.
        const pricing = this.findPricing(detectedModel);
        const totalCost = this.computeIncrementalCost(
          pricing,
          acc.inputTokens,
          acc.outputTokens,
          0,
          0,
        );
        const deltaCost = this.computeIncrementalCost(
          pricing,
          newInput,
          newOutput,
          acc.inputTokens - newInput,
          acc.outputTokens - newOutput,
        );

        this.onCostDetected?.(agentId, {
          totalCost,
          inputTokens: acc.inputTokens,
          outputTokens: acc.outputTokens,
          cacheReadTokens: acc.cacheReadTokens,
          cacheWriteTokens: acc.cacheWriteTokens,
          model: detectedModel,
          timestamp: Date.now(),
          deltaInputTokens: newInput,
          deltaOutputTokens: newOutput,
          deltaCacheReadTokens: newCacheRead,
          deltaCacheWriteTokens: newCacheWrite,
          deltaCost,
        });

        console.log(
          `[CostTracker] Agent=${agentId} model=${detectedModel} ` +
            `in=${acc.inputTokens.toLocaleString()} out=${acc.outputTokens.toLocaleString()} ` +
            `cache_read=${acc.cacheReadTokens.toLocaleString()} cache_write=${acc.cacheWriteTokens.toLocaleString()}`,
        );
      }
    } catch (err) {
      console.error(
        `[CostTracker] Error polling session file for agent=${agentId}:`,
        err,
      );
    }
  }

  // ── Strategy 2: PTY Output Parsing (non-Claude CLIs) ───────

  processOutput(agentId: string, data: string): void {
    // Skip if we're tracking this agent via session file
    if (this.sessions.has(agentId)) return;

    let buffer = (this.buffers.get(agentId) || "") + data;
    if (buffer.length > MAX_BUFFER_SIZE) {
      buffer = buffer.slice(-MAX_BUFFER_SIZE);
    }
    this.buffers.set(agentId, buffer);

    this.tryParse(agentId, data);
  }

  private tryParse(agentId: string, data: string): void {
    const costMatch = COST_PATTERN.exec(data);
    if (costMatch) {
      const totalCost = parseFloat(costMatch[1]);
      if (totalCost > 0) {
        this.onCostDetected?.(agentId, {
          totalCost,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "unknown",
          timestamp: Date.now(),
          deltaInputTokens: 0,
          deltaOutputTokens: 0,
          deltaCacheReadTokens: 0,
          deltaCacheWriteTokens: 0,
          deltaCost: totalCost,
        });
      }
      return;
    }

    const inputMatch = INPUT_TOKENS_PATTERN.exec(data);
    const outputMatch = OUTPUT_TOKENS_PATTERN.exec(data);
    if (inputMatch || outputMatch) {
      const inputTokens = inputMatch
        ? parseInt(inputMatch[1].replace(/,/g, ""), 10)
        : 0;
      const outputTokens = outputMatch
        ? parseInt(outputMatch[1].replace(/,/g, ""), 10)
        : 0;

      if (inputTokens > 0 || outputTokens > 0) {
        // Unknown-model fallback: use the per-token "default" rate. We
        // don't try subscription matching here since we don't know which
        // model produced the tokens.
        const fallback = MODEL_PRICING["default"];
        const pricing: ModelPricing = {
          scheme: "per-token",
          inputPer1M: fallback.inputPer1M,
          outputPer1M: fallback.outputPer1M,
        };
        const cost = this.computeIncrementalCost(
          pricing,
          inputTokens,
          outputTokens,
        );

        this.onCostDetected?.(agentId, {
          totalCost: cost,
          inputTokens,
          outputTokens,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "unknown",
          timestamp: Date.now(),
          deltaInputTokens: inputTokens,
          deltaOutputTokens: outputTokens,
          deltaCacheReadTokens: 0,
          deltaCacheWriteTokens: 0,
          deltaCost: cost,
        });
      }
    }
  }

  clearBuffer(agentId: string): void {
    this.buffers.delete(agentId);
  }

  clearAll(): void {
    this.buffers.clear();
    for (const tracker of this.sessions.values()) {
      clearInterval(tracker.timer);
    }
    this.sessions.clear();
  }
}
