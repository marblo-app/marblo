/**
 * Header policy for the passthrough relay.
 *
 * ★ Design invariant P1 (§5-B): the request *body* is relayed byte-for-byte, so
 * every piece of our own metadata has to live in headers. That makes the header
 * policy the only place where we are allowed to differ from the client, and it
 * has to be explicit — a stray header that upstream rejects, or a missing
 * `anthropic-beta`, silently changes behaviour and can change how the prefix is
 * interpreted.
 *
 * Two directions, two rules:
 *  - upstream:   allowlist client headers, strip every credential the client
 *                sent, inject OUR vendor key. The client's token is a Marblo
 *                credit token, never a vendor key (§5-C).
 *  - downstream: copy upstream headers except hop-by-hop / framing headers we
 *                have to recompute, and add our request id for correlation.
 */

import type { IncomingHttpHeaders } from "node:http";

/** RFC 7230 hop-by-hop headers — never forwarded in either direction. */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/**
 * Client headers that must never reach upstream.
 * - credentials: the caller authenticates to *us*, we authenticate to the vendor
 * - host/content-length: framing, recomputed by the HTTP client
 * - accept-encoding: we let the fetch implementation negotiate and decode; if we
 *   forwarded the client's value we would have to re-encode the response body to
 *   match the `content-encoding` header. Response encoding has no effect on the
 *   prompt cache — the cache is keyed on the *request* prefix — so decoding and
 *   re-framing the response is safe here.
 */
const CLIENT_HEADER_DENYLIST = new Set([
  "authorization",
  "x-api-key",
  "cookie",
  "host",
  "content-length",
  "accept-encoding",
]);

/**
 * Exact client header names that are forwarded upstream.
 * Anything not here and not matching {@link FORWARD_PREFIXES} is dropped, so a
 * new client header can never reach the vendor without us noticing.
 */
const FORWARD_EXACT = new Set([
  "content-type",
  "accept",
  "user-agent",
  "x-app",
  "x-client-name",
  "x-client-version",
]);

/**
 * Prefixes forwarded verbatim:
 *  - `anthropic-` : `anthropic-version` (required) and `anthropic-beta`
 *    (feature flags — including the ones that gate cache behaviour, e.g.
 *    extended cache TTL). Dropping these changes semantics.
 *  - `x-stainless-`: SDK telemetry the vendor's own clients send. Harmless,
 *    and keeping it makes our traffic look exactly like a direct client, which
 *    is what the A/B in the cache probe needs.
 */
const FORWARD_PREFIXES = ["anthropic-", "x-stainless-"];

function isForwardable(name: string): boolean {
  if (HOP_BY_HOP.has(name)) return false;
  if (CLIENT_HEADER_DENYLIST.has(name)) return false;
  if (FORWARD_EXACT.has(name)) return true;
  return FORWARD_PREFIXES.some((p) => name.startsWith(p));
}

function flatten(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.join(", ");
  return value;
}

export interface UpstreamHeaderOptions {
  /** Vendor API key. Injected as `x-api-key`; never logged, never echoed. */
  upstreamApiKey: string;
  /** Fallback when the client omitted `anthropic-version` (the CLI always sends it). */
  defaultAnthropicVersion: string;
}

/**
 * Build the header set we send upstream.
 *
 * Note what is *not* here: no `x-marblo-*` request metadata. Vendor APIs reject
 * or log unknown headers inconsistently, and the PoC's whole point is to look
 * byte-identical to a direct client. Our correlation id goes downstream only.
 */
export function buildUpstreamHeaders(
  incoming: IncomingHttpHeaders,
  opts: UpstreamHeaderOptions,
): Record<string, string> {
  const out: Record<string, string> = {};

  for (const [rawName, rawValue] of Object.entries(incoming)) {
    const name = rawName.toLowerCase();
    if (!isForwardable(name)) continue;
    const value = flatten(rawValue);
    if (value === null) continue;
    out[name] = value;
  }

  if (!out["anthropic-version"]) {
    out["anthropic-version"] = opts.defaultAnthropicVersion;
  }
  if (!out["content-type"]) {
    out["content-type"] = "application/json";
  }

  // Our credential, last, so it cannot be shadowed by a forwarded header.
  out["x-api-key"] = opts.upstreamApiKey;

  return out;
}

/** Response headers we must recompute rather than copy. */
const DOWNSTREAM_DROP = new Set(["content-length", "content-encoding"]);

/**
 * Build the header set we return to the client.
 *
 * `content-length`/`content-encoding` are dropped because the body is re-framed
 * (we stream it out chunked, already decoded). Everything else — including
 * `request-id`, rate-limit headers and `retry-after` — is passed through so the
 * client's own backoff logic keeps working. ★ That matters for cache: a client
 * that retries too aggressively can blow past the 5-minute cache TTL (§4-A row 4).
 */
export function buildDownstreamHeaders(
  upstream: Headers,
  proxyRequestId: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  upstream.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower)) return;
    if (DOWNSTREAM_DROP.has(lower)) return;
    out[lower] = value;
  });
  out["x-marblo-proxy-request-id"] = proxyRequestId;
  return out;
}

/** Exported for tests and for the header-policy section of the PoC doc. */
export const HEADER_POLICY = {
  hopByHop: [...HOP_BY_HOP],
  clientDenylist: [...CLIENT_HEADER_DENYLIST],
  forwardExact: [...FORWARD_EXACT],
  forwardPrefixes: [...FORWARD_PREFIXES],
  downstreamDrop: [...DOWNSTREAM_DROP],
} as const;
