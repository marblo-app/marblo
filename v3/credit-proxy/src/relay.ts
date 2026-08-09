/**
 * The relay. This is the whole PoC in one file: everything else measures what
 * this does.
 *
 * ★ Design invariant P1 (§5-B, §4-A): the request body goes upstream as the
 * exact bytes we received. Not re-serialized, not normalized, not pretty-printed
 * — `JSON.parse(body)` followed by `JSON.stringify` would reorder nothing and
 * still change whitespace, and a single changed byte in the prefix is a cache
 * miss worth $53 a ticket. We therefore:
 *   - buffer the raw body as a Buffer and forward that Buffer,
 *   - parse a *copy* only to read `model` / `stream` for observability,
 *   - never inject anything into the body (our metadata is headers-only).
 *
 * Buffering, to be explicit, does not touch the bytes — it only delays them. It
 * is here because we will later need the body length for the hold estimate
 * (§6-D) and because it makes the byte-exactness assertion cheap to test.
 *
 * The response is teed: every chunk is written to the client first, then handed
 * to the usage extractor. Client latency is never gated on our accounting.
 */

import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";

import { buildDownstreamHeaders, buildUpstreamHeaders } from "./headers";
import { cacheHitRatio, emptyUsage, type RelayRecord } from "./types";
import { extractUsageFromJson, SseUsageExtractor } from "./usage";

export type FetchImpl = typeof globalThis.fetch;

export interface RelayOptions {
  upstreamBaseUrl: string;
  upstreamApiKey: string;
  defaultAnthropicVersion: string;
  maxBodyBytes: number;
  upstreamTimeoutMs: number;
  fetchImpl?: FetchImpl;
  now?: () => number;
}

class BodyTooLargeError extends Error {
  constructor(limit: number) {
    super(`request body exceeds ${limit} bytes`);
    this.name = "BodyTooLargeError";
  }
}

/** Collect the raw request body. Rejects past the cap instead of buffering it. */
async function readRequestBody(
  req: IncomingMessage,
  limit: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buf.length;
    if (total > limit) throw new BodyTooLargeError(limit);
    chunks.push(buf);
  }
  return Buffer.concat(chunks, total);
}

interface BodySniff {
  model: string | null;
  stream: boolean;
}

/**
 * Read `model` and `stream` from a *copy* of the body.
 *
 * ★ The parsed value is used for reporting only and is deliberately thrown away
 * — the bytes that go upstream are the ones we received. Any failure here is
 * non-fatal by design: an unparseable body is still relayed, and the vendor
 * decides whether it is valid.
 */
export function sniffBody(body: Buffer): BodySniff {
  try {
    const parsed: unknown = JSON.parse(body.toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) {
      return { model: null, stream: false };
    }
    const record = parsed as Record<string, unknown>;
    return {
      model: typeof record.model === "string" ? record.model : null,
      stream: record.stream === true,
    };
  } catch {
    return { model: null, stream: false };
  }
}

/** Write one chunk, honouring backpressure so a slow client cannot balloon memory. */
async function writeChunk(
  res: ServerResponse,
  chunk: Uint8Array,
): Promise<void> {
  if (!res.write(chunk)) {
    await once(res, "drain");
  }
}

function sendJson(
  res: ServerResponse,
  status: number,
  payload: Record<string, unknown>,
): void {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": String(body.length),
  });
  res.end(body);
}

/**
 * Relay one request upstream and stream the response back.
 *
 * Always resolves (never rejects) with a {@link RelayRecord}: transport failures
 * are recorded in `transportError` and answered with a 502 envelope, because a
 * thrown error at this layer would leave the client's socket hanging.
 */
export async function relay(
  req: IncomingMessage,
  res: ServerResponse,
  options: RelayOptions,
): Promise<RelayRecord> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? (() => Date.now());
  const startedAt = now();
  const proxyRequestId = randomUUID();

  const record: RelayRecord = {
    proxyRequestId,
    method: req.method ?? "GET",
    path: req.url ?? "/",
    status: 0,
    model: null,
    stream: false,
    requestBytes: 0,
    requestBodySha256: "",
    usage: emptyUsage(),
    cacheHitRatio: 0,
    stopReason: null,
    ttfbMs: 0,
    totalMs: 0,
    transportError: null,
  };

  let body: Buffer;
  try {
    body = await readRequestBody(req, options.maxBodyBytes);
  } catch (error) {
    const tooLarge = error instanceof BodyTooLargeError;
    record.status = tooLarge ? 413 : 400;
    record.transportError = tooLarge ? "body_too_large" : "request_read_failed";
    record.totalMs = now() - startedAt;
    sendJson(res, record.status, {
      type: "error",
      error: { type: "invalid_request_error", message: record.transportError },
      proxy_request_id: proxyRequestId,
    });
    return record;
  }

  record.requestBytes = body.length;
  record.requestBodySha256 = createHash("sha256").update(body).digest("hex");
  const sniff = sniffBody(body);
  record.model = sniff.model;
  record.stream = sniff.stream;

  const url = `${options.upstreamBaseUrl}${req.url ?? "/"}`;
  const headers = buildUpstreamHeaders(req.headers, {
    upstreamApiKey: options.upstreamApiKey,
    defaultAnthropicVersion: options.defaultAnthropicVersion,
  });

  // Abort upstream when the client goes away — an orphaned stream keeps billing.
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("upstream_timeout")),
    options.upstreamTimeoutMs,
  );
  const onClientClose = (): void => {
    if (!res.writableEnded) controller.abort(new Error("client_disconnected"));
  };
  req.on("aborted", onClientClose);
  res.on("close", onClientClose);

  try {
    const upstream = await fetchImpl(url, {
      method: record.method,
      headers,
      // Buffer -> Uint8Array view: the exact bytes, no re-encoding step.
      body:
        record.method === "GET" || record.method === "HEAD" ? undefined : body,
      signal: controller.signal,
      redirect: "manual",
    });

    record.status = upstream.status;
    res.writeHead(
      upstream.status,
      buildDownstreamHeaders(upstream.headers, proxyRequestId),
    );
    // SSE is useless if the kernel coalesces our small frames.
    res.socket?.setNoDelay(true);
    res.flushHeaders();

    const contentType = upstream.headers.get("content-type") ?? "";
    const isSse = contentType.includes("text/event-stream");
    const extractor = isSse ? new SseUsageExtractor() : null;
    const jsonChunks: Buffer[] = [];

    let firstByteAt: number | null = null;

    if (upstream.body) {
      const reader = upstream.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.length === 0) continue;
        if (firstByteAt === null) firstByteAt = now();

        // ★ Client first, accounting second.
        await writeChunk(res, value);

        if (extractor) {
          extractor.push(Buffer.from(value));
        } else {
          jsonChunks.push(Buffer.from(value));
        }
      }
    }

    res.end();

    const observation = extractor
      ? extractor.finish()
      : extractUsageFromJson(Buffer.concat(jsonChunks).toString("utf8"));

    record.usage = observation.usage;
    record.cacheHitRatio = cacheHitRatio(observation.usage);
    record.stopReason = observation.stopReason;
    record.ttfbMs = (firstByteAt ?? now()) - startedAt;
  } catch (error) {
    record.transportError =
      error instanceof Error ? error.message : "upstream_request_failed";
    if (!res.headersSent) {
      record.status = 502;
      sendJson(res, 502, {
        type: "error",
        error: {
          type: "api_error",
          message: `upstream relay failed: ${record.transportError}`,
        },
        proxy_request_id: proxyRequestId,
      });
    } else if (!res.writableEnded) {
      // Headers already flushed — the only honest signal left is a truncated stream.
      res.end();
    }
  } finally {
    clearTimeout(timeout);
    req.off("aborted", onClientClose);
    res.off("close", onClientClose);
  }

  record.totalMs = now() - startedAt;
  return record;
}
