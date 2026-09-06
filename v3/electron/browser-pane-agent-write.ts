import type { WebContents } from "electron";
import { raceAbort } from "./browser-pane-agent-read";
import { capFillValue } from "./browser-pane-agent-write-policy";

/**
 * How a reversible write actually lands on the page — the execution half of
 * ticket m6pSfPKMgNog8qonXsu4 (3a). Reuses `raceAbort` from Stage 1/2's read
 * path unchanged: the global stop must be able to cut off an in-flight fill's
 * RESULT exactly the way it already cuts off a read's, and the owner-facing
 * "field cleared/didn't land" behavior that gives depends on it.
 *
 * ★No submit/click/keypress function exists in this module, on purpose — not
 * merely undocumented, absent. The only capability here is "locate one
 * element by selector and set its value", which cannot dispatch a form
 * submission, click a button, or send a synthetic Enter keypress. The policy
 * layer (`browser-pane-agent-write-policy.ts`) additionally refuses any
 * `actionKind: "submit"` request before it would ever reach here — this file
 * is the second, structural half of that boundary: even a caller that skipped
 * the policy check has no function here to call for it.
 */
export interface RunAgentFillOptions {
  signal?: AbortSignal;
}

export interface AgentFillResult {
  ok: boolean;
  elementFound: boolean;
  fieldIsFillable: boolean;
  appliedValueLength: number;
  truncated: boolean;
}

function buildFillScript(selector: string, value: string): string {
  const encodedSelector = JSON.stringify(selector);
  const encodedValue = JSON.stringify(value);
  return `(() => {
    const el = document.querySelector(${encodedSelector});
    if (!el) {
      return { ok: false, elementFound: false, fieldIsFillable: false, appliedValueLength: 0 };
    }
    const tag = el.tagName ? el.tagName.toUpperCase() : "";
    const isContentEditable = el.isContentEditable === true;
    if (tag !== "INPUT" && tag !== "TEXTAREA" && !isContentEditable) {
      return { ok: false, elementFound: true, fieldIsFillable: false, appliedValueLength: 0 };
    }
    const nextValue = ${encodedValue};
    if (isContentEditable) {
      el.innerText = nextValue;
    } else {
      const proto = tag === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value") && Object.getOwnPropertyDescriptor(proto, "value").set;
      if (setter) {
        setter.call(el, nextValue);
      } else {
        el.value = nextValue;
      }
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return { ok: true, elementFound: true, fieldIsFillable: true, appliedValueLength: nextValue.length };
  })()`;
}

/**
 * Sets one input/textarea/contenteditable's value and fires `input` so
 * controlled React fields notice — nothing else. `change` is deliberately
 * NOT dispatched: a real user's `change` fires at blur, not on every
 * keystroke, so firing it immediately here would make an agent's fill MORE
 * aggressive than a human typing — and on a page wired as
 * `<input onchange="this.form.submit()">`, that turns one fill call into a
 * submission, breaking this ticket's only contract ("reversible writes
 * only"). If a future stage needs change-triggered behavior, that is a
 * stage-3b decision (gated on the confirm design that stage requires), not
 * something to reach for here. Callers own the policy decision
 * (`classifyAgentWriteRequest`) and the rate limiter, matching the read
 * path's division of responsibility.
 */
export async function runAgentFillAction(
  webContents: WebContents,
  selector: string,
  value: string,
  opts: RunAgentFillOptions = {},
): Promise<AgentFillResult> {
  // Checked before dispatching the script (not just raced afterwards) so an
  // already-tripped global stop never runs the fill at all.
  if (opts.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  const capped = capFillValue(value);
  const script = buildFillScript(selector, capped.value);
  const raw = (await raceAbort(
    webContents.executeJavaScript(script, true),
    opts.signal,
  )) as {
    ok: unknown;
    elementFound: unknown;
    fieldIsFillable: unknown;
    appliedValueLength: unknown;
  };
  return {
    ok: raw?.ok === true,
    elementFound: raw?.elementFound === true,
    fieldIsFillable: raw?.fieldIsFillable === true,
    appliedValueLength:
      typeof raw?.appliedValueLength === "number" ? raw.appliedValueLength : 0,
    truncated: capped.truncated,
  };
}
