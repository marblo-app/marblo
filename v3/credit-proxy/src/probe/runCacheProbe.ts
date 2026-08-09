/**
 * ★ G-P1 — the live cache-preservation measurement.
 *
 * Method (why it is shaped this way):
 *
 *  A lane = one salt = one cacheable prefix. Within a lane we send the SAME
 *  bytes twice: call #1 writes the cache, call #2 should read it. We report
 *  call #2's `cache_read_input_tokens / total_input_tokens`.
 *
 *  Two lanes: `direct` (straight to the vendor) and `proxied` (through us).
 *  ★ The salts differ per lane on purpose. Both lanes bill the same upstream
 *  account, and the cache is scoped to account+prefix — so a shared salt would
 *  let the direct lane warm the proxied lane's cache and the proxied lane would
 *  score a hit it did not earn. Different salts make each lane warm its own.
 *
 *  Verdict: proxied ratio must not fall more than 10 points below direct
 *  (§11 G-P1). If it does, the proxy is perturbing the prefix and L2 is dead
 *  regardless of which vendor we pick.
 *
 * Requires a pay-go `ANTHROPIC_API_KEY`. Without one this exits 2 with the
 * runbook pointer — the wiring and the mock-upstream E2E still verify byte
 * preservation and SSE passthrough, but only a real vendor can price a token.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { costUsd, cacheBreakMultiplier, ratesForModel } from "../cost";
import { evaluateCachePreservation } from "../gate";
import { totalInputTokens } from "../types";
import { callMessages, type CallResult } from "./client";
import { buildCacheProbeBody } from "./payload";

const DEFAULT_MODEL = "claude-sonnet-5";

interface LaneResult {
  label: string;
  warm: CallResult;
  read: CallResult;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runLane(args: {
  label: string;
  baseUrl: string;
  apiKey: string;
  direct: boolean;
  model: string;
  stream: boolean;
  gapMs: number;
}): Promise<LaneResult> {
  const { bytes, approxPrefixChars } = buildCacheProbeBody({
    model: args.model,
    salt: `marblo-l2-poc-${args.label}`,
    stream: args.stream,
  });

  console.info(
    `[${args.label}] prefix ~${approxPrefixChars} chars, body ${bytes.length} bytes -> ${args.baseUrl}`,
  );

  const warm = await callMessages({
    baseUrl: args.baseUrl,
    apiKey: args.apiKey,
    direct: args.direct,
    bodyBytes: bytes,
    stream: args.stream,
  });
  if (warm.status !== 200) {
    throw new Error(
      `[${args.label}] warm call failed: HTTP ${warm.status} ${
        warm.errorBody ?? ""
      }`,
    );
  }

  // Same bytes, second time. The gap stays well inside the 5-minute cache TTL.
  await sleep(args.gapMs);

  const read = await callMessages({
    baseUrl: args.baseUrl,
    apiKey: args.apiKey,
    direct: args.direct,
    bodyBytes: bytes,
    stream: args.stream,
  });
  if (read.status !== 200) {
    throw new Error(
      `[${args.label}] read call failed: HTTP ${read.status} ${
        read.errorBody ?? ""
      }`,
    );
  }

  return { label: args.label, warm, read };
}

function describeLane(
  lane: LaneResult,
  model: string,
): Record<string, unknown> {
  const rates = ratesForModel(model);
  const usage = lane.read.observation.usage;
  return {
    label: lane.label,
    warmUsage: lane.warm.observation.usage,
    warmCacheHitRatio: Number(lane.warm.cacheHitRatio.toFixed(4)),
    readUsage: usage,
    readCacheHitRatio: Number(lane.read.cacheHitRatio.toFixed(4)),
    readTotalInputTokens: totalInputTokens(usage),
    readCostUsd: Number(costUsd(usage, rates).toFixed(6)),
    readCacheBreakMultiplier: Number(
      cacheBreakMultiplier(usage, rates).toFixed(3),
    ),
    ttfbMs: { warm: lane.warm.ttfbMs, read: lane.read.ttfbMs },
    totalMs: { warm: lane.warm.totalMs, read: lane.read.totalMs },
  };
}

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  const proxyUrl = process.env.PROXY_BASE_URL ?? "http://127.0.0.1:8080";
  const directUrl =
    process.env.UPSTREAM_BASE_URL ?? "https://api.anthropic.com";
  const model = process.env.PROBE_MODEL ?? DEFAULT_MODEL;
  const stream = process.env.PROBE_STREAM !== "0";
  const gapMs = Number.parseInt(process.env.PROBE_GAP_MS ?? "3000", 10);
  const outPath = process.env.PROBE_OUT ?? "probe-out/cache-probe.json";

  if (apiKey.length === 0) {
    console.error(
      [
        "ANTHROPIC_API_KEY is not set — the live G-P1 measurement cannot run.",
        "",
        "This is expected today: we have no Anthropic pay-go key yet (design doc §10-A L-2,",
        "sales track L-1). Everything measurable without a key is already covered by",
        "`npm test` (byte-exact relay, SSE passthrough, cache_control survival, tool loop",
        "against a mock upstream that implements a real prefix cache).",
        "",
        "When the key lands, see v3/docs/onramp-l2-proxy-cache-poc-2026-08-09.md §7 for the runbook.",
      ].join("\n"),
    );
    process.exit(2);
  }

  console.info(
    `[cache-probe] model=${model} stream=${stream} gap=${gapMs}ms direct=${directUrl} proxy=${proxyUrl}`,
  );

  const direct = await runLane({
    label: "direct",
    baseUrl: directUrl,
    apiKey,
    direct: true,
    model,
    stream,
    gapMs,
  });

  const proxied = await runLane({
    label: "proxied",
    baseUrl: proxyUrl,
    // The proxy replaces this with its own server-side key; any non-empty value
    // works and exercises the credential-swap path.
    apiKey: "marblo-poc-placeholder-token",
    direct: false,
    model,
    stream,
    gapMs,
  });

  const gate = evaluateCachePreservation(
    direct.read.cacheHitRatio,
    proxied.read.cacheHitRatio,
  );

  const report = {
    measuredAtIso: new Date().toISOString(),
    model,
    stream,
    gapMs,
    lanes: [describeLane(direct, model), describeLane(proxied, model)],
    gateGP1: {
      ...gate,
      deltaPp: Number(gate.deltaPp.toFixed(2)),
      tolerancePp: 10,
    },
    latencyOverheadMs: proxied.read.ttfbMs - direct.read.ttfbMs,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.info("\n=== G-P1 cache preservation ===");
  console.info(
    `direct  cache hit ratio : ${(gate.directRatio * 100).toFixed(1)}%`,
  );
  console.info(
    `proxied cache hit ratio : ${(gate.proxiedRatio * 100).toFixed(1)}%`,
  );
  console.info(
    `delta                   : ${gate.deltaPp.toFixed(1)} pp (tolerance ±10)`,
  );
  console.info(`verdict                 : ${gate.verdict.toUpperCase()}`);
  console.info(`proxy TTFB overhead     : ${report.latencyOverheadMs} ms`);
  console.info(`report written to       : ${outPath}`);

  process.exit(gate.verdict === "green" ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(
    "[cache-probe] failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
