/**
 * Ticket 8ssBnDzFll0eHDKNYqZB: the agent-write toggle must not silently do
 * nothing. `classifyAgentWriteRequest` (electron/browser-pane-agent-write-policy.ts)
 * refuses every write on a Google host regardless of the owner's grant — but
 * that refusal happens in the main process, after the owner has already
 * turned the toggle on. Without a renderer-side check the pane just shows
 * "쓰기 허용됨" on google.com/gmail.com/etc. and every fill silently fails,
 * which is exactly the "조용히 아무 일도 안 나는" state the ticket forbids.
 *
 * This is a deliberate duplicate of `isGoogleHost`, not a shared import —
 * `electron/` is main-process code and is not part of the renderer bundle.
 * Keep the host list identical to `isGoogleHost`'s; a parity test in
 * `tests/unit/agentWriteGoogleHost.test.ts` fails if the two ever diverge.
 * If they disagree, the main-process function is the one that's actually
 * enforced — this one only decides whether to show a warning.
 */
export function isGoogleHostForAgentWrite(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  const suffixes = [
    "google.com",
    "gmail.com",
    "youtube.com",
    "googleusercontent.com",
    "googlevideo.com",
    "ytimg.com",
  ];
  return suffixes.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
  );
}
