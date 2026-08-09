/**
 * ★ G-P2 CLI — runs the tool loop through the proxy against a live vendor.
 *
 * Needs a pay-go key for the same reason G-P1 does. The equivalent loop against
 * the mock upstream runs in `npm test` today and already exercises every piece
 * of our code; what only a live key can prove is that the *vendor* is happy with
 * the bytes we forward.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { driveToolLoop } from "./toolLoop";

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  const proxyUrl = process.env.PROXY_BASE_URL ?? "http://127.0.0.1:8080";
  const model = process.env.PROBE_MODEL ?? "claude-sonnet-5";
  const stream = process.env.PROBE_STREAM !== "0";
  const outPath = process.env.PROBE_OUT ?? "probe-out/tool-loop.json";

  if (apiKey.length === 0) {
    console.error(
      [
        "ANTHROPIC_API_KEY is not set — the live G-P2 measurement cannot run.",
        "The mock-upstream tool loop in `npm test` covers our side of the contract.",
        "Runbook for when the key lands: v3/docs/onramp-l2-proxy-cache-poc-2026-08-09.md §7.",
      ].join("\n"),
    );
    process.exit(2);
  }

  const run = await driveToolLoop({
    baseUrl: proxyUrl,
    apiKey: "marblo-poc-placeholder-token",
    direct: false,
    model,
    stream,
  });

  const report = {
    measuredAtIso: new Date().toISOString(),
    model,
    stream,
    proxyUrl,
    gateGP2: run.result,
    malformedToolInputs: run.malformedToolInputs,
    turnDetails: run.turns,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.info("\n=== G-P2 tool loop ===");
  console.info(`turns          : ${run.result.turns}`);
  console.info(`tool calls     : ${run.result.toolCalls}`);
  console.info(`final stop     : ${run.result.finalStopReason}`);
  console.info(`malformed input: ${run.malformedToolInputs}`);
  console.info(
    `verdict        : ${run.result.verdict.toUpperCase()} — ${
      run.result.reason
    }`,
  );
  console.info(`report written : ${outPath}`);

  process.exit(
    run.result.verdict === "green" && run.malformedToolInputs === 0 ? 0 : 1,
  );
}

main().catch((error: unknown) => {
  console.error(
    "[tool-loop] failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
