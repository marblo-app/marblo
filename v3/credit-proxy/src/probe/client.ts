/**
 * Minimal `/v1/messages` client used by the probes.
 *
 * Deliberately not an SDK: the probe has to control the exact bytes it sends so
 * that "the same prefix" really is the same prefix. It takes a pre-serialized
 * Buffer and reuses it across the calls in a lane, which removes key order and
 * whitespace as variables in the measurement.
 */

import {
  assembleFromJson,
  SseMessageAssembler,
  type AssembledMessage,
} from "../messageAssembler";
import { cacheHitRatio, type ResponseObservation } from "../types";
import { extractUsageFromJson } from "../usage";

export interface CallOptions {
  /** Origin only, e.g. `https://api.anthropic.com` or `http://127.0.0.1:8080`. */
  baseUrl: string;
  /**
   * Credential. Against the vendor it is sent as `x-api-key`; against our proxy
   * as `Authorization: Bearer`, which is what `claude` sends when driven by
   * `ANTHROPIC_AUTH_TOKEN` — and is the header the proxy strips and replaces.
   */
  apiKey: string;
  direct: boolean;
  anthropicVersion?: string;
  /** Pre-serialized request body; byte-identical across calls in a lane. */
  bodyBytes: Buffer;
  stream: boolean;
}

export interface CallResult {
  status: number;
  observation: ResponseObservation;
  message: AssembledMessage | null;
  cacheHitRatio: number;
  ttfbMs: number;
  totalMs: number;
  /** Present only on non-2xx, truncated. Never contains a credential. */
  errorBody: string | null;
  proxyRequestId: string | null;
}

export async function callMessages(options: CallOptions): Promise<CallResult> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": options.anthropicVersion ?? "2023-06-01",
    accept: options.stream ? "text/event-stream" : "application/json",
  };
  if (options.direct) {
    headers["x-api-key"] = options.apiKey;
  } else {
    headers.authorization = `Bearer ${options.apiKey}`;
  }

  const startedAt = Date.now();
  const response = await fetch(`${options.baseUrl}/v1/messages`, {
    method: "POST",
    headers,
    body: options.bodyBytes,
  });

  const proxyRequestId = response.headers.get("x-marblo-proxy-request-id");

  if (!response.ok) {
    const text = await response.text();
    const elapsed = Date.now() - startedAt;
    return {
      status: response.status,
      observation: extractUsageFromJson(text),
      message: null,
      cacheHitRatio: 0,
      ttfbMs: elapsed,
      totalMs: elapsed,
      errorBody: text.slice(0, 2000),
      proxyRequestId,
    };
  }

  let firstByteAt: number | null = null;
  let message: AssembledMessage;

  if (options.stream) {
    const assembler = new SseMessageAssembler();
    const reader = response.body?.getReader();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.length === 0) continue;
        if (firstByteAt === null) firstByteAt = Date.now();
        assembler.push(Buffer.from(value));
      }
    }
    message = assembler.finish();
  } else {
    const text = await response.text();
    firstByteAt = Date.now();
    message = assembleFromJson(text);
  }

  const finishedAt = Date.now();
  return {
    status: response.status,
    observation: message.observation,
    message,
    cacheHitRatio: cacheHitRatio(message.observation.usage),
    ttfbMs: (firstByteAt ?? finishedAt) - startedAt,
    totalMs: finishedAt - startedAt,
    errorBody: null,
    proxyRequestId,
  };
}
