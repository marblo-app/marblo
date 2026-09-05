import type { WebContents } from "electron";
import {
  capReadText,
  redactLikelySecrets,
  type CappedText,
  type RedactedText,
} from "./browser-pane-agent-read-policy";

/**
 * How the page's text is pulled out of a granted pane — the (A) half of
 * ticket FQ7nshXHjDWOvD0WWUVV.
 *
 * ★Design choice, per product-owner request to record it: Electron's
 * `webContents.debugger` exposes the same Chrome DevTools Protocol Playwright
 * drives, and nothing in this tree attaches it today (`grep -rn
 * "\.debugger\b" electron` → 0 hits, confirmed 2026-09-05). It was considered
 * and rejected FOR THIS STAGE:
 *
 * - CDP is not a read-only protocol. Attaching `webContents.debugger` opens
 *   `Input.dispatchMouseEvent`, `Page.navigate`, `Network.*` — everything —
 *   on the SAME session object a read would use. "Read only" would then be
 *   a promise about which CDP *methods we choose to call*, not something the
 *   attachment itself enforces. A stage whose entire acceptance criterion is
 *   "no write API exists" should not build its read path on a protocol that
 *   makes writing one line away.
 * - `executeJavaScript` needs no new capability grant: every
 *   `WebContentsView` we construct can already run it, exactly as Chromium's
 *   own DevTools console would, without enabling remote debugging or
 *   touching `nodeIntegration`/`contextIsolation` (execution happens in the
 *   page's main world, same as a user's own console).
 *
 * This is a stage-1-scoped call, not a permanent one. Stage 2 (reversible
 * writes — draft text, fill a form without submitting) and stage 3
 * (irreversible actions — publish, spend, delete) are a real fork: either we
 * grow our own element-targeting/wait/retry layer on top of
 * `executeJavaScript`, or we attach CDP and let a real Playwright drive the
 * pane. Playwright's value is that upper layer (locators, auto-waiting,
 * retry semantics), not CDP access itself — attaching CDP alone gets "clicks
 * work, 3 times in 10 they hit the wrong element", which is not durable
 * enough for an ad-campaign edit. That fork is stage 2's decision, made with
 * a write boundary already in hand; recorded here so stage 2 doesn't have to
 * rediscover it.
 */
const EXTRACTION_SCRIPT = `(() => {
  const MAX_RAW_CHARS = 200000; // upper bound before our own cap/redaction pass
  const text = (document.body ? document.body.innerText : "") || "";
  return {
    title: document.title || "",
    url: location.href,
    text: text.length > MAX_RAW_CHARS ? text.slice(0, MAX_RAW_CHARS) : text,
  };
})()`;

export interface AgentReadSnapshot {
  title: string;
  url: string;
  text: string;
  truncated: boolean;
  redactedCount: number;
}

export interface RunAgentReadExtractionOptions {
  signal?: AbortSignal;
}

/**
 * Races a promise against an `AbortSignal`. `executeJavaScript` has no
 * native cancellation, so the global stop (design doc §B) can't reach into
 * Chromium and interrupt an in-flight script — but it doesn't need to: a
 * read has no side effect worth stopping mid-flight, only a *result* worth
 * refusing to deliver. Racing means `suspend()` calling `abort()` makes THIS
 * function reject immediately, so the caller never returns, logs, or
 * broadcasts a result for a read the owner has just cut off, even though the
 * underlying script may still finish harmlessly in the page a moment later.
 */
function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

/**
 * Runs the fixed extraction script against a pane's page and applies the
 * text cap + secret redaction before anything else sees the result. Callers
 * own the policy decision (`classifyAgentReadRequest`) and the rate limiter
 * — this function only knows how to take one safe snapshot.
 */
export async function runAgentReadExtraction(
  webContents: WebContents,
  opts: RunAgentReadExtractionOptions = {},
): Promise<AgentReadSnapshot> {
  // Checked before dispatching the script (not just raced afterwards) so an
  // already-tripped global stop never runs the extraction at all.
  if (opts.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  const raw = (await raceAbort(
    webContents.executeJavaScript(EXTRACTION_SCRIPT, true),
    opts.signal,
  )) as {
    title: unknown;
    url: unknown;
    text: unknown;
  };
  const rawText = typeof raw?.text === "string" ? raw.text : "";
  const capped: CappedText = capReadText(rawText);
  const redacted: RedactedText = redactLikelySecrets(capped.text);
  const rawUrl = typeof raw?.url === "string" ? raw.url : "";
  return {
    title: typeof raw?.title === "string" ? raw.title : "",
    url: rawUrl || webContents.getURL(),
    text: redacted.text,
    truncated: capped.truncated,
    redactedCount: redacted.redactedCount,
  };
}
