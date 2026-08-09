/**
 * HTTP surface.
 *
 * Built on bare `node:http` on purpose. Express/Fastify style frameworks parse
 * and re-serialize JSON bodies by default, and that is exactly the thing that
 * breaks the prompt cache (§4-A row 1). Nothing here touches the body.
 *
 * Scope: this is P1 of §11 — passthrough plus measurement. Auth, model
 * allowlist, holds and the ledger are P2 (T-6…T-8) and are deliberately absent;
 * shipping them before G-P1 is green would be building on an unmeasured
 * assumption. The PoC server must not be exposed publicly with a live key.
 */

import { createServer as createHttpServer, type Server } from "node:http";

import type { ProxyConfig } from "./config";
import { relay } from "./relay";
import type { RelayRecord } from "./types";

/** Bounded in-memory record ring. Nothing is persisted — PoC only (§5-F P4). */
export class MetricsRing {
  private readonly records: RelayRecord[] = [];

  constructor(private readonly capacity: number) {}

  add(record: RelayRecord): void {
    this.records.push(record);
    while (this.records.length > this.capacity) this.records.shift();
  }

  list(): RelayRecord[] {
    return [...this.records];
  }

  clear(): void {
    this.records.length = 0;
  }
}

export interface ProxyServer {
  server: Server;
  metrics: MetricsRing;
}

function sendJson(
  res: import("node:http").ServerResponse,
  status: number,
  payload: unknown,
): void {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": String(body.length),
  });
  res.end(body);
}

export function createProxyServer(config: ProxyConfig): ProxyServer {
  const metrics = new MetricsRing(config.metricsRingSize);

  const server = createHttpServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];

    if (path === "/healthz") {
      sendJson(res, 200, {
        ok: true,
        upstreamConfigured: config.upstreamApiKey.length > 0,
      });
      return;
    }

    // PoC-only measurement readout. Contains ids, counts and usage — no bodies.
    if (path === "/__poc/metrics") {
      sendJson(res, 200, { records: metrics.list() });
      return;
    }

    if (!path.startsWith("/v1/")) {
      sendJson(res, 404, {
        type: "error",
        error: { type: "not_found_error", message: `no route for ${path}` },
      });
      return;
    }

    if (config.upstreamApiKey.length === 0) {
      // Fail loudly rather than relaying an unauthenticated request that the
      // vendor would reject with a confusing 401.
      sendJson(res, 503, {
        type: "error",
        error: {
          type: "api_error",
          message: "proxy has no upstream credential configured",
        },
      });
      return;
    }

    void relay(req, res, {
      upstreamBaseUrl: config.upstreamBaseUrl,
      upstreamApiKey: config.upstreamApiKey,
      defaultAnthropicVersion: config.defaultAnthropicVersion,
      maxBodyBytes: config.maxBodyBytes,
      upstreamTimeoutMs: config.upstreamTimeoutMs,
    }).then((record) => {
      metrics.add(record);
    });
  });

  // Long agent turns: never let the server time out a live SSE stream.
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;
  server.keepAliveTimeout = 75_000;

  return { server, metrics };
}
