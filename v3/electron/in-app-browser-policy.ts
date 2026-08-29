export const IN_APP_BROWSER_SESSION_PARTITION = "persist:marblo-browser-tab";

export type InAppBrowserExternalReason =
  | "google-auth"
  | "auth"
  | "payment"
  | "external-protocol";

export type InAppBrowserNavigationDecision =
  | { action: "allow" }
  | { action: "external"; reason: InAppBrowserExternalReason }
  | { action: "deny"; reason: "unsupported-protocol" | "invalid-url" };

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

  if (isGoogleAuthUrl(url))
    return { action: "external", reason: "google-auth" };
  if (isKnownAuthUrl(url)) return { action: "external", reason: "auth" };
  if (isKnownPaymentUrl(url)) return { action: "external", reason: "payment" };
  return { action: "allow" };
}

export function browserPaneNoticeForExternalReason(
  reason: InAppBrowserExternalReason,
): {
  code: "google-auth-external" | "auth-external" | "payment-external";
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
  return null;
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
