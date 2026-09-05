export const IN_APP_BROWSER_SESSION_PARTITION = "persist:marblo-browser-tab";

export type InAppBrowserExternalReason =
  | "google-auth"
  | "auth"
  | "payment"
  | "external-protocol";

export type InAppBrowserDenyReason = "unsupported-protocol" | "invalid-url";

export type InAppBrowserNavigationDecision =
  | { action: "allow" }
  | { action: "external"; reason: InAppBrowserExternalReason }
  | { action: "deny"; reason: InAppBrowserDenyReason };

/**
 * Every reason `browserPaneNoticeForExternalReason` can explain to the user —
 * a classify() "external" reason, a classify() "deny" reason, the OS-level
 * `shell.openExternal` call itself failing (ticket bHuirRxD643VVvhdaWGM: a
 * click that reaches this far must never end in silence), or the app-tab
 * `browserPane:openUrl` delivery going unacknowledged and falling back to
 * the OS browser (ticket GiChqmgXxSQxdUwo3NLq — "tab-open-failed" is
 * distinct from "open-failed": the former fires while the OS-browser
 * fallback is still likely to succeed, so it must not claim the browser
 * open itself failed), or there being no window able to host an app tab at
 * all (ticket pmpcvaEsswlsOLJDwer6 — "no-tab-target": the click was supposed
 * to become a Web tab and could not, and the user must be told that rather
 * than left guessing why the OS browser jumped in front of them).
 */
export type InAppBrowserNoticeReason =
  | InAppBrowserExternalReason
  | InAppBrowserDenyReason
  | "open-failed"
  | "tab-open-failed"
  | "no-tab-target";

/**
 * A scheme, as opposed to a `host:port`. The negative lookahead is what tells
 * `mailto:hi@example.com` (scheme) from `localhost:3001` (host and port):
 * only the latter has nothing but digits after the colon.
 */
const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:(?!\d+(?:[/?#]|$))/;

export function normalizeBrowserPaneUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "about:blank") return "about:blank";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (
    /^localhost(:\d+)?([/?#].*)?$/i.test(trimmed) ||
    /^127\.0\.0\.1(:\d+)?([/?#].*)?$/i.test(trimmed) ||
    /^\d+\.\d+\.\d+\.\d+(:\d+)?([/?#].*)?$/.test(trimmed)
  ) {
    return `http://${trimmed}`;
  }
  // Anything that already names a scheme is left alone. Prefixing "https://"
  // onto it does not just fail to help — it silently changes the URL:
  // `mailto:hi@example.com` becomes `https://mailto:hi@example.com`, which
  // parses as https://example.com with credentials, so an email link
  // classified as an ordinary allowed page. Adding the scheme is only ever
  // right for a bare host the user typed.
  if (URL_SCHEME_RE.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function classifyInAppBrowserNavigation(
  rawUrl: string,
): InAppBrowserNavigationDecision {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { action: "deny", reason: "invalid-url" };
  }

  if (url.protocol === "about:" && url.href === "about:blank") {
    return { action: "allow" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    if (isExternalProtocol(url.protocol)) {
      return { action: "external", reason: "external-protocol" };
    }
    return { action: "deny", reason: "unsupported-protocol" };
  }

  // Authentication/OAuth is never an app-tab candidate. Google rejects
  // embedded OAuth user agents, and Marblo's supported loopback PKCE flow
  // deliberately completes in the system browser.
  if (isGoogleAuthUrl(url))
    return { action: "external", reason: "google-auth" };
  if (isKnownAuthUrl(url)) return { action: "external", reason: "auth" };
  if (isKnownPaymentUrl(url)) return { action: "external", reason: "payment" };
  return { action: "allow" };
}

export function browserPaneNoticeForExternalReason(
  reason: InAppBrowserNoticeReason,
): {
  code:
    | "google-auth-external"
    | "auth-external"
    | "payment-external"
    | "external-protocol"
    | "unsupported-protocol"
    | "invalid-url"
    | "open-failed"
    | "tab-open-failed"
    | "no-tab-target";
  message: string;
} | null {
  if (reason === "google-auth") {
    return {
      code: "google-auth-external",
      message:
        "Google blocks sign-in inside embedded browsers. Marblo opened it in your system browser instead.",
    };
  }
  if (reason === "auth") {
    return {
      code: "auth-external",
      message:
        "Authentication pages open in your system browser to avoid embedded-browser sign-in failures.",
    };
  }
  if (reason === "payment") {
    return {
      code: "payment-external",
      message:
        "Payment and billing pages open in your system browser for security.",
    };
  }
  if (reason === "external-protocol") {
    return {
      code: "external-protocol",
      message: "Marblo opened this link with your system's default app for it.",
    };
  }
  if (reason === "unsupported-protocol") {
    return {
      code: "unsupported-protocol",
      message: "Marblo blocked this link — its URL scheme isn't supported.",
    };
  }
  if (reason === "invalid-url") {
    return {
      code: "invalid-url",
      message: "Marblo couldn't open this link — the URL looks malformed.",
    };
  }
  if (reason === "open-failed") {
    return {
      code: "open-failed",
      message: "Marblo couldn't open this link in your system browser.",
    };
  }
  if (reason === "no-tab-target") {
    return {
      code: "no-tab-target",
      message:
        "Marblo opened this link in your system browser — no app window was ready to host a Web tab.",
    };
  }
  if (reason === "tab-open-failed") {
    return {
      code: "tab-open-failed",
      message:
        "Marblo couldn't open this link as an app tab — opened it in your system browser instead.",
    };
  }
  return null;
}

type ExternalLinkNotice = NonNullable<
  ReturnType<typeof browserPaneNoticeForExternalReason>
>;

/** Every reason in `InAppBrowserNoticeReason` has copy, so this never throws. */
function requireNotice(reason: InAppBrowserNoticeReason): ExternalLinkNotice {
  const notice = browserPaneNoticeForExternalReason(reason);
  if (!notice) {
    throw new Error(
      `No notice defined for reason "${reason}" — every reason must explain itself.`,
    );
  }
  return notice;
}

/**
 * What routing a top-level (outside any open Web tab) link click resolves to —
 * pure decision, no IPC/dialog/shell side effects, so it is unit testable
 * without Electron. `hasOpenTarget` mirrors main's
 * `browserPaneOpenTargets.has(owner.id)`: whether the clicking window has a
 * renderer ready to receive `browserPane:openUrl` and turn it into a Web tab.
 *
 * THE SPEC (ticket pmpcvaEsswlsOLJDwer6 — see docs/link-routing-spec.md):
 * an ordinary http(s) link belongs in an app Web tab, exactly like typing it
 * into the Web tab's address bar already does. Only the categories that are
 * known to break inside an embedded browser leave the app: OAuth/sign-in,
 * payment, and non-http(s) schemes.
 *
 * The previous rule sent a click to a tab only when the URL was a local demo
 * (a second loopback port), so github.com — and every other ordinary site —
 * left for the OS browser no matter what. Worse, it left *silently*: that
 * branch carried `notice: null`. Every branch here now carries a notice
 * except the happy "open-in-tab" path (ticket bHuirRxD643VVvhdaWGM: no branch
 * may resolve to silence), and the types enforce it.
 */
export type ExternalLinkRouting =
  | { kind: "open-in-tab" }
  | { kind: "open-external"; notice: ExternalLinkNotice }
  | { kind: "blocked"; notice: ExternalLinkNotice };

export interface BrowserPaneWindowOpenDecision {
  url: string;
  routing: ExternalLinkRouting;
}

/**
 * Pure decision for a `window.open`/`target=_blank` request originating in a
 * browser pane. The caller supplies whether the owning renderer can host a
 * new Web tab; no Electron or shell side effects happen here.
 */
export function resolveBrowserPaneWindowOpen(
  rawUrl: string,
  hasOpenTarget: boolean,
): BrowserPaneWindowOpenDecision {
  const url = normalizeBrowserPaneUrl(rawUrl);
  return {
    url,
    routing: resolveExternalLinkRouting(
      classifyInAppBrowserNavigation(url),
      hasOpenTarget,
    ),
  };
}

export function resolveExternalLinkRouting(
  decision: InAppBrowserNavigationDecision,
  hasOpenTarget: boolean,
): ExternalLinkRouting {
  if (decision.action === "allow") {
    if (hasOpenTarget) return { kind: "open-in-tab" };
    // Nowhere to put a tab (no workspace window listening). Falling back to
    // the OS browser is right, but saying so is not optional — this used to
    // be the silent branch.
    return { kind: "open-external", notice: requireNotice("no-tab-target") };
  }
  if (decision.action === "external") {
    return {
      kind: "open-external",
      notice: requireNotice(decision.reason),
    };
  }
  // decision.action === "deny" — must never resolve silently either.
  return { kind: "blocked", notice: requireNotice(decision.reason) };
}

/**
 * The side effects `routeExternalLinkClick` needs. Kept as an interface (no
 * `electron` import) so the whole click path — normalize → classify → route →
 * act — is exercised by unit tests rather than approximated by them, and so
 * main stays a thin adapter over one shared decision.
 */
export interface AppExternalLinkEffects {
  /** Hand the URL to the renderer to become a Web tab (ack-backed). */
  openInTab(url: string): void;
  /** Hand the URL to the OS browser. */
  openExternal(url: string): void;
  /** Tell the user why a link did not become a Web tab. */
  notify(notice: NonNullable<ReturnType<typeof browserPaneNoticeForExternalReason>>): void;
}

/**
 * A top-level link click that is not the app's own content: decide where it
 * goes and take it there. Returns the decision so the caller can log it.
 */
export function routeExternalLinkClick(
  rawUrl: string,
  hasOpenTarget: boolean,
  effects: AppExternalLinkEffects,
): { routing: ExternalLinkRouting; url: string } {
  const { url, routing } = resolveBrowserPaneWindowOpen(rawUrl, hasOpenTarget);
  if (routing.kind === "open-in-tab") {
    effects.openInTab(url);
    return { routing, url };
  }
  // Both remaining branches explain themselves BEFORE acting, so the reason
  // is on screen even if the hand-off itself then fails.
  effects.notify(routing.notice);
  if (routing.kind === "open-external") effects.openExternal(url);
  return { routing, url };
}

/**
 * `routeAppExternalLink`'s "open-in-tab" branch used to be a bare
 * `owner.send("browserPane:openUrl", ...)` — a one-way IPC with no receiver
 * confirmation. If the renderer's listener was never wired yet (registration
 * is async) or the window was mid-navigation/reload when the message
 * arrived, the click vanished: no tab opened, no fallback, no notice
 * (ticket GiChqmgXxSQxdUwo3NLq).
 *
 * This tracks each send by a request id and expects the renderer to
 * acknowledge it (see preload's `browserPane.ackOpenUrl`); if no ack lands
 * within `ackTimeoutMs`, `onDeliveryFailed` runs so the caller can fall back
 * to the OS browser and surface a notice. Kept dependency-free (no
 * `electron` import) so it can be unit tested with fake timers and a stub
 * sender, the same way `resolveExternalLinkRouting` is tested above.
 */
export interface BrowserPaneOpenUrlSender {
  id: number;
  isDestroyed(): boolean;
  send(channel: "browserPane:openUrl", payload: { url: string; requestId: string }): void;
}

export interface BrowserPaneOpenUrlDeliveryDeps {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  generateRequestId: () => string;
  onDeliveryFailed: (sender: BrowserPaneOpenUrlSender, url: string) => void;
  ackTimeoutMs?: number;
}

interface PendingBrowserPaneOpen {
  sender: BrowserPaneOpenUrlSender;
  url: string;
  timer: unknown;
}

const DEFAULT_BROWSER_PANE_OPEN_ACK_TIMEOUT_MS = 1500;

export class BrowserPaneOpenUrlDelivery {
  private readonly pending = new Map<string, PendingBrowserPaneOpen>();

  constructor(private readonly deps: BrowserPaneOpenUrlDeliveryDeps) {}

  /** Send `browserPane:openUrl` to `sender`, arming an ack timeout. */
  send(sender: BrowserPaneOpenUrlSender, url: string): void {
    const requestId = this.deps.generateRequestId();
    const timeoutMs =
      this.deps.ackTimeoutMs ?? DEFAULT_BROWSER_PANE_OPEN_ACK_TIMEOUT_MS;
    const timer = this.deps.setTimeout(() => {
      if (!this.pending.delete(requestId)) return;
      this.deps.onDeliveryFailed(sender, url);
    }, timeoutMs);
    this.pending.set(requestId, { sender, url, timer });
    sender.send("browserPane:openUrl", { url, requestId });
  }

  /** Renderer confirmed it handled the open. Returns false for an unknown/stale/foreign id. */
  acknowledge(senderId: number, requestId: string): boolean {
    const pending = this.pending.get(requestId);
    if (!pending || pending.sender.id !== senderId) return false;
    this.deps.clearTimeout(pending.timer);
    this.pending.delete(requestId);
    return true;
  }

  /**
   * A sender is known gone (window destroyed) or explicitly unregistered
   * (renderer told main it can no longer receive opens, e.g. leaving
   * WorkspaceShell for BeginnerShell in the same window) before it acked.
   * No ack is ever coming, so this resolves the pending send as failed right
   * away instead of waiting out the timeout — same `onDeliveryFailed` path,
   * just sooner.
   */
  cancelForSender(senderId: number): void {
    for (const [requestId, entry] of this.pending) {
      if (entry.sender.id !== senderId) continue;
      this.deps.clearTimeout(entry.timer);
      this.pending.delete(requestId);
      this.deps.onDeliveryFailed(entry.sender, entry.url);
    }
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}

function isExternalProtocol(protocol: string): boolean {
  return ["mailto:", "tel:", "sms:", "slack:", "zoommtg:", "zoomus:"].includes(
    protocol,
  );
}

function hostnameWithoutWww(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

function isGoogleAuthUrl(url: URL): boolean {
  const host = hostnameWithoutWww(url);
  return host === "accounts.google.com" || host === "oauth2.googleapis.com";
}

function isKnownAuthUrl(url: URL): boolean {
  const host = hostnameWithoutWww(url);
  if (host === "login.microsoftonline.com") return true;
  if (host === "appleid.apple.com") return true;
  if (host === "github.com" && url.pathname.startsWith("/login/oauth")) {
    return true;
  }
  return false;
}

function isKnownPaymentUrl(url: URL): boolean {
  const host = hostnameWithoutWww(url);
  if (host === "checkout.stripe.com" || host === "billing.stripe.com") {
    return true;
  }
  if (host === "paypal.com" || host.endsWith(".paypal.com")) return true;
  if (host === "tosspayments.com" || host.endsWith(".tosspayments.com")) {
    return true;
  }
  if (host === "pay.toss.im") return true;
  if (host === "kakaopay.com" || host.endsWith(".kakaopay.com")) return true;
  if (host === "inicis.com" || host.endsWith(".inicis.com")) return true;
  if (host === "kcp.co.kr" || host.endsWith(".kcp.co.kr")) return true;
  return false;
}

/**
 * WHICH surface a clicked link belongs to — the half of the routing decision
 * that lives in Electron's object graph rather than in the URL
 * (ticket Gebe84T64LVUh1iO1hQR).
 *
 * `resolveExternalLinkRouting` above takes `hasOpenTarget` as a given. Main
 * used to answer that with `browserPaneOpenTargets.has(owner.id)`, where
 * `owner` is whichever webContents fired the handler — but the only id ever
 * registered is the workspace shell's (WorkspaceShell's `registerOpenTarget`).
 * Any click that surfaces on a DIFFERENT webContents in the same app was
 * therefore declared homeless and shipped to the OS browser with a
 * `no-tab-target` notice, which is exactly the "웹이 준비된 게 없다" the CEO saw
 * while the Web tab was sitting right there.
 *
 * Two shipping paths surface a click on another webContents:
 *
 *  1. A window the shell opened. xterm's WebLinksAddon default handler opens
 *     a link in two steps — `window.open()` with NO url, then
 *     `location.href = uri` — so Electron creates a stray default
 *     BrowserWindow ("조그만 새 창") and the navigation surfaces on THAT
 *     window. The terminal now hands the real URL straight to
 *     `window.open` (src/lib/terminalLinkOpen.ts) so the stray window is not
 *     created at all, but the opener walk here keeps any other library that
 *     plays the same two-step from silently leaving the app.
 *
 *  2. The in-app Web tab's own page. Its WebContentsView also receives the
 *     global external-link handling, whose `will-navigate` listener is
 *     registered BEFORE the pane's own — so every link clicked inside the
 *     app's browser was preventDefault()ed and kicked outside. The pane has a
 *     complete policy of its own (`classifyInAppBrowserNavigation`), so the
 *     right answer there is to stand down, not to route.
 *
 * A Web-tab host is a property of the OPENER CHAIN, not of one webContents.
 */
export interface AppLinkSurfaceGraph {
  /** Has this renderer registered itself as a Web-tab host? */
  isWebTabHost(id: number): boolean;
  /** Is this the WebContentsView that renders an in-app Web tab's page? */
  isInAppBrowserPane(id: number): boolean;
  /** The webContents that opened this one via `window.open`, if any. */
  openerOf(id: number): number | null;
}

export type AppLinkSurface =
  /** The in-app browser owns this click; the app-level policy stands down. */
  | { kind: "in-app-browser-pane" }
  /** Deliver `browserPane:openUrl` to `hostId` — it has a Web tab surface. */
  | { kind: "web-tab-host"; hostId: number }
  /** Nothing in the chain can host a tab → OS browser + `no-tab-target`. */
  | { kind: "no-web-tab-host" };

/**
 * `maxHops` and the `seen` set exist because the opener map is fed by
 * Electron events: a stale or self-referential entry must end the walk, never
 * hang the main process on a link click.
 */
export function resolveAppLinkSurface(
  originId: number,
  graph: AppLinkSurfaceGraph,
  maxHops = 8,
): AppLinkSurface {
  if (graph.isInAppBrowserPane(originId)) return { kind: "in-app-browser-pane" };

  const seen = new Set<number>();
  let id: number | null = originId;
  for (let hop = 0; id !== null && hop <= maxHops; hop += 1) {
    if (seen.has(id)) break;
    seen.add(id);
    if (graph.isWebTabHost(id)) return { kind: "web-tab-host", hostId: id };
    id = graph.openerOf(id);
  }
  return { kind: "no-web-tab-host" };
}
