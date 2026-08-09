/**
 * ★ The measurement we can run TODAY, with no vendor key.
 *
 * Starts the mock upstream (which implements a real prefix cache, keyed on the
 * bytes up to the last `cache_control` breakpoint) and the real proxy in front
 * of it, then runs exactly the lanes the live probe runs:
 *
 *   direct lane   client -> mock
 *   proxied lane  client -> proxy -> mock
 *
 * and the G-P2 tool loop through the proxy.
 *
 * What a green result here means: our relay does not perturb the prefix, does
 * not lose SSE frames, and does not break a tool loop. What it does NOT mean:
 * that Anthropic's cache keys on what this mock assumes, or that their minimum
 * cacheable length and TTL behave as documented. Only `npm run probe:cache`
 * against a live pay-go key can close that gap — see the PoC doc §7.
 *
 * Output shape is identical to the live probe so the two reports are directly
 * comparable once a key exists.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { dirname } from "node:path";

import { loadConfigFromEnv } from "../config";
import { cacheBreakMultiplier, costUsd, ratesForModel } from "../cost";
import { evaluateCachePreservation } from "../gate";
import { startMockAnthropic } from "../mock/anthropicMock";
import { createProxyServer } from "../server";
import { cacheHitRatio, totalInputTokens } from "../types";
import { callMessages, type CallResult } from "./client";
import { buildCacheProbeBody } from "./payload";
import { driveToolLoop } from "./toolLoop";

const MODEL = "claude-sonnet-5";

async function runLane(args: {
  label: string;
  baseUrl: string;
  apiKey: string;
  direct: boolean;
}): Promise<{ warm: CallResult; read: CallResult }> {
  // ★ Lane-specific salt: one lane must not warm the other lane's cache.
  const { bytes } = buildCacheProbeBody({
    model: MODEL,
    salt: `mock-${args.label}`,
    stream: true,
  });

  const call = (): Promise<CallResult> =>
    callMessages({
      baseUrl: args.baseUrl,
      apiKey: args.apiKey,
      direct: args.direct,
      bodyBytes: bytes,
      stream: true,
    });

  const warm = await call();
  const read = await call();
  return { warm, read };
}

async function main(): Promise<void> {
  const outPath = process.env.PROBE_OUT ?? "probe-out/mock-probe.json";

  const mock = await startMockAnthropic();
  const config = loadConfigFromEnv({
    PORT: "0",
    UPSTREAM_BASE_URL: mock.baseUrl,
    ANTHROPIC_API_KEY: "sk-mock-server-side-key",
  } as NodeJS.ProcessEnv);
  const { server } = createProxyServer(config);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const proxyBaseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const direct = await runLane({
      label: "direct",
      baseUrl: mock.baseUrl,
      apiKey: "sk-direct",
      direct: true,
    });
    const proxied = await runLane({
      label: "proxied",
      baseUrl: proxyBaseUrl,
      apiKey: "marblo-credit-token",
      direct: false,
    });

    const directRatio = cacheHitRatio(direct.read.observation.usage);
    const proxiedRatio = cacheHitRatio(proxied.read.observation.usage);
    const gateGP1 = evaluateCachePreservation(directRatio, proxiedRatio);

    const toolLoop = await driveToolLoop({
      baseUrl: proxyBaseUrl,
      apiKey: "marblo-credit-token",
      direct: false,
      model: MODEL,
      stream: true,
    });

    const rates = ratesForModel(MODEL);
    const proxiedRead = proxied.read.observation.usage;

    const report = {
      harness: "mock-upstream (no vendor key)",
      model: MODEL,
      lanes: {
        direct: {
          warmUsage: direct.warm.observation.usage,
          readUsage: direct.read.observation.usage,
          readCacheHitRatio: Number(directRatio.toFixed(4)),
        },
        proxied: {
          warmUsage: proxied.warm.observation.usage,
          readUsage: proxiedRead,
          readCacheHitRatio: Number(proxiedRatio.toFixed(4)),
          readTotalInputTokens: totalInputTokens(proxiedRead),
          readCostUsd: Number(costUsd(proxiedRead, rates).toFixed(6)),
          readCacheBreakMultiplier: Number(
            cacheBreakMultiplier(proxiedRead, rates).toFixed(3),
          ),
        },
      },
      gateGP1: { ...gateGP1, deltaPp: Number(gateGP1.deltaPp.toFixed(3)) },
      gateGP2: {
        ...toolLoop.result,
        malformedToolInputs: toolLoop.malformedToolInputs,
        turnDetails: toolLoop.turns,
      },
      byteExactness: {
        upstreamRequestCount: mock.requests.length,
        note: "byte equality is asserted per-request in test/relay.e2e.test.ts",
      },
    };

    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    console.info("=== mock harness (no vendor key) ===");
    console.info(
      `direct  lane: warm write=${direct.warm.observation.usage.cacheCreationInputTokens} read=${direct.read.observation.usage.cacheReadInputTokens} ratio=${(directRatio * 100).toFixed(2)}%`,
    );
    console.info(
      `proxied lane: warm write=${proxied.warm.observation.usage.cacheCreationInputTokens} read=${proxiedRead.cacheReadInputTokens} ratio=${(proxiedRatio * 100).toFixed(2)}%`,
    );
    console.info(
      `G-P1 delta  : ${gateGP1.deltaPp.toFixed(3)} pp -> ${gateGP1.verdict.toUpperCase()}`,
    );
    console.info(
      `G-P2        : ${toolLoop.result.verdict.toUpperCase()} — ${toolLoop.result.reason} (malformed tool inputs: ${toolLoop.malformedToolInputs})`,
    );
    console.info(
      `cache break multiplier on the proxied read turn: ${cacheBreakMultiplier(proxiedRead, rates).toFixed(2)}x`,
    );
    console.info(`report written to: ${outPath}`);

    const ok =
      gateGP1.verdict === "green" &&
      toolLoop.result.verdict === "green" &&
      toolLoop.malformedToolInputs === 0;
    process.exitCode = ok ? 0 : 1;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await mock.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    "[mock-probe] failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
