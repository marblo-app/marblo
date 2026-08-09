/** Boots the real proxy server on an ephemeral port, pointed at a mock upstream. */

import type { AddressInfo } from "node:net";

import { loadConfigFromEnv } from "../../src/config";
import { createProxyServer, type MetricsRing } from "../../src/server";

export interface RunningProxy {
  baseUrl: string;
  metrics: MetricsRing;
  close: () => Promise<void>;
}

export async function startProxy(args: {
  upstreamBaseUrl: string;
  upstreamApiKey?: string;
  maxBodyBytes?: number;
  upstreamTimeoutMs?: number;
}): Promise<RunningProxy> {
  const config = loadConfigFromEnv({
    PORT: "0",
    UPSTREAM_BASE_URL: args.upstreamBaseUrl,
    ANTHROPIC_API_KEY: args.upstreamApiKey ?? "sk-test-server-side-key",
    MAX_BODY_BYTES: args.maxBodyBytes ? String(args.maxBodyBytes) : undefined,
    UPSTREAM_TIMEOUT_MS: args.upstreamTimeoutMs
      ? String(args.upstreamTimeoutMs)
      : undefined,
  } as NodeJS.ProcessEnv);

  const { server, metrics } = createProxyServer(config);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    metrics,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
