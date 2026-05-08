/**
 * GA4 init wrapper. Same opt-in + PII-scrub principles as sentry.ts.
 *
 * GA4 ships via the gtag.js script tag. We append the script only AFTER
 * consent — never preload it, since browsers fingerprint requests as
 * soon as they fire and we want a clean "no signal sent before opt-in"
 * promise.
 *
 * Event payloads pass through `scrubValue` before being handed to gtag,
 * so even if a caller accidentally puts a file path or BYOK key in
 * event params, it gets masked.
 */
import { scrubValue } from "./scrub";

const MEASUREMENT_ID = import.meta.env.VITE_GA4_MEASUREMENT_ID as
  | string
  | undefined;

let initialized = false;
let enabled = false;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

function injectScript(id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.getElementById("ga4-script")) return resolve();
    const s = document.createElement("script");
    s.id = "ga4-script";
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(
      id
    )}`;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("ga4 script load failed"));
    document.head.appendChild(s);
  });
}

/** Initialize GA4 IF user consented AND measurement ID is set. Idempotent. */
export async function maybeInitGA4(consented: boolean): Promise<void> {
  if (initialized) {
    enabled = consented;
    return;
  }
  if (!consented) return;
  if (!MEASUREMENT_ID) {
    console.info("[GA4] VITE_GA4_MEASUREMENT_ID not set — skipping init.");
    return;
  }
  try {
    await injectScript(MEASUREMENT_ID);
    window.dataLayer = window.dataLayer || [];
    const dataLayer = window.dataLayer;
    window.gtag = function gtag(...args: unknown[]) {
      dataLayer.push(args);
    };
    window.gtag("js", new Date());
    window.gtag("config", MEASUREMENT_ID, {
      // No IP storage — extra layer over PIPA national-export consent.
      anonymize_ip: true,
      // Suppress the auto page_view — Marblo is single-page; we'll fire
      // explicit screen_view events with scrubbed params instead.
      send_page_view: false,
    });
    initialized = true;
    enabled = true;
  } catch (err) {
    console.warn("[GA4] init failed:", err);
  }
}

/** Track an event. No-ops if SDK absent or user opted out. */
export function trackEvent(
  name: string,
  params?: Record<string, unknown>
): void {
  if (!enabled || !window.gtag) return;
  const safeParams =
    params && typeof params === "object"
      ? (scrubValue(params) as Record<string, unknown>)
      : undefined;
  try {
    window.gtag("event", name, safeParams);
  } catch {
    // never break the app on analytics failure
  }
}
