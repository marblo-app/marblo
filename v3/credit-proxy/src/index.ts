/** Cloud Run entrypoint. */

import { describeConfigForLogging, loadConfigFromEnv } from "./config";
import { createProxyServer } from "./server";

function main(): void {
  const config = loadConfigFromEnv();
  const { server } = createProxyServer(config);

  // Masked shape only — never the key itself (§5-F).
  console.info(
    "[credit-proxy] starting",
    JSON.stringify(describeConfigForLogging(config)),
  );

  if (config.upstreamApiKey.length === 0) {
    console.warn(
      "[credit-proxy] ANTHROPIC_API_KEY is not set — /v1/* will answer 503. " +
        "Live cache measurement needs a pay-go key (see v3/docs/onramp-l2-proxy-cache-poc-2026-08-09.md §7).",
    );
  }

  server.listen(config.port, () => {
    console.info(`[credit-proxy] listening on :${config.port}`);
  });

  const shutdown = (signal: string): void => {
    console.info(`[credit-proxy] ${signal} received, closing`);
    server.close(() => process.exit(0));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main();
