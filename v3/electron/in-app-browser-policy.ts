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
 * open itself failed).
 */
export type InAppBrowserNoticeReason =
  | InAppBrowserExternalReason
  | InAppBrowserDenyReason
  | "open-failed"
  | "tab-open-failed";

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
  return `https://${trimmed}`;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

/** True when a URL is a local dev server rather than the app's own origin. */
export function isLocalBrowserPaneUrl(
  rawUrl: string,
  appOrigin: string | null,
): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (!isLoopbackHost(url.hostname)) return false;
  return appOrigin === null || url.origin !== appOrigin;
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
    | "tab-open-failed";
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
  if (reason === "tab-open-failed") {
    return {
      code: "tab-open-failed",
      message:
        "Marblo couldn't open this link as an app tab — opened it in your system browser instead.",
    };
  }
  return null;
}

/**
 * What routing a top-level (outside any open browser tab) link click resolves
 * to — pure decision, no IPC/dialog/shell side effects, so it is unit
 * testable without Electron. `hasOpenTarget` mirrors main's
 * `browserPaneOpenTargets.has(owner.id)`: whether the clicking window has an
 * app tab ready to receive `browserPane:openUrl`.
 *
 * Every branch carries a notice except the happy "open-in-tab" path — a deny
 * or an external hand-off must always explain itself to the caller (ticket
 * bHuirRxD643VVvhdaWGM: no branch may resolve to silence).
 */
export type ExternalLinkRouting =
  | { kind: "open-in-tab" }
  | {
      kind: "open-external";
      notice: ReturnType<typeof browserPaneNoticeForExternalReason>;
    }
  | {
      kind: "blocked";
      notice: NonNullable<ReturnType<typeof browserPaneNoticeForExternalReason>>;
    };

export function resolveExternalLinkRouting(
  decision: InAppBrowserNavigationDecision,
  hasOpenTarget: boolean,
  /** Only local demo URLs opt into the in-app Browser pane. */
  shouldOpenInTab = true,
): ExternalLinkRouting {
  if (decision.action === "allow" && hasOpenTarget && shouldOpenInTab) {
    return { kind: "open-in-tab" };
  }
  if (decision.action === "external") {
    return {
      kind: "open-external",
      notice: browserPaneNoticeForExternalReason(decision.reason),
    };
  }
  if (decision.action === "allow") {
    return { kind: "open-external", notice: null };
  }
  // decision.action === "deny" — must never resolve silently.
  const notice = browserPaneNoticeForExternalReason(decision.reason);
  if (!notice) {
    throw new Error(
      `No notice defined for deny reason "${decision.reason}" — every deny reason must explain itself.`,
    );
  }
  return { kind: "blocked", notice };
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
