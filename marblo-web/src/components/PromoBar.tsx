"use client";

import { useState, useSyncExternalStore, FormEvent } from "react";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { Sparkles, X, ArrowRight } from "lucide-react";
import {
  buildPrefillUrl,
  isPromoBarOpen,
  PROMO_BAR_DISMISS_KEY,
} from "@/lib/foundation50";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// useSyncExternalStore lets us read localStorage during render without
// SSR/client hydration mismatch and without a setState-in-effect anti-pattern.
function subscribeDismissed(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getDismissedSnapshot(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(PROMO_BAR_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function getDismissedServerSnapshot(): boolean {
  // Hide on the server so SSR markup matches the most likely first-frame
  // (returning users who already dismissed). The component re-renders with
  // the real value once the client mounts.
  return true;
}

export default function PromoBar() {
  const t = useTranslations("promoBar");
  const locale = useLocale();

  const externallyDismissed = useSyncExternalStore(
    subscribeDismissed,
    getDismissedSnapshot,
    getDismissedServerSnapshot
  );
  const [locallyDismissed, setLocallyDismissed] = useState(false);
  const dismissed = externallyDismissed || locallyDismissed;

  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!isPromoBarOpen() || dismissed) return null;

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) {
      setError(t("email_invalid"));
      return;
    }
    setError(null);
    const url = buildPrefillUrl(email);
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const handleDismiss = () => {
    setLocallyDismissed(true);
    try {
      window.localStorage.setItem(PROMO_BAR_DISMISS_KEY, "1");
    } catch {
      // ignore
    }
  };

  return (
    <div className="relative z-[60] border-b border-indigo-500/30 bg-gradient-to-r from-indigo-700/40 via-violet-700/30 to-indigo-700/40 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 text-sm">
          <div className="flex items-center gap-2 text-indigo-100">
            <Sparkles className="w-4 h-4 text-indigo-300 shrink-0" />
            <span className="font-medium">{t("message")}</span>
          </div>

          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-2 w-full sm:w-auto"
            noValidate
          >
            <input
              type="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError(null);
              }}
              placeholder={t("email_placeholder")}
              aria-label={t("email_placeholder")}
              className="bg-zinc-950/60 border border-indigo-400/40 focus:border-indigo-300 focus:outline-none rounded-md px-3 py-1.5 text-sm text-white placeholder-zinc-400 w-full sm:w-56"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1 bg-white text-indigo-700 hover:bg-indigo-50 transition px-3 py-1.5 rounded-md text-sm font-semibold shrink-0"
            >
              {t("cta")}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </form>

          <Link
            href={`/${locale}/foundation50`}
            className="text-xs text-indigo-100/80 hover:text-white underline-offset-4 hover:underline shrink-0"
          >
            {t("details_cta")}
          </Link>

          <button
            type="button"
            onClick={handleDismiss}
            aria-label={t("dismiss_aria")}
            className="absolute right-2 top-2 sm:static sm:ml-2 text-indigo-200/70 hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <p role="alert" className="text-center text-xs text-amber-300 mt-1.5">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
