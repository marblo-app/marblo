/**
 * Grok account rate-limit probe placeholder.
 *
 * Measured against Grok Build CLI 0.2.117 (alpha):
 *   - `grok --help` lists no usage/account/quota command.
 *   - `grok help usage`, `grok help account`, and `grok help quota` exit with
 *     "unrecognized subcommand".
 *   - `grok models` reports auth/model availability only, not remaining quota.
 *
 * SuperGrok is browser-authenticated, and the CLI currently exposes no
 * headless account quota/remaining-usage surface equivalent to Claude's
 * control protocol or Codex's app-server RPC. Return null as "no information",
 * never zero usage.
 */

import type { RateLimitInfo } from "./session-parsers";

export interface GrokUsageSnapshot extends RateLimitInfo {
  /** When this snapshot was captured (epoch ms). */
  capturedAt: number;
}

export function probeGrokUsage(): Promise<GrokUsageSnapshot | null> {
  return Promise.resolve(null);
}
