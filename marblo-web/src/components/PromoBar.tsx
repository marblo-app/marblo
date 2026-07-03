"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { Sparkles, ArrowRight, X } from "lucide-react";
import { isPromoBarOpen, PROMO_BAR_DISMISS_KEY } from "@/lib/foundation50";

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

  if (!isPromoBarOpen() || dismissed) return null;

  const handleDismiss = () => {
    setLocallyDismissed(true);
    try {
      window.localStorage.setItem(PROMO_BAR_DISMISS_KEY, "1");
    } catch {
      // ignore
    }
  };

  return (
    <div className="relative z-[60] border-b border-indigo-500/20 bg-indigo-950/60 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-center gap-x-3 gap-y-1 py-1.5 pr-8 text-sm flex-wrap">
          <Sparkles
            className="w-4 h-4 text-indigo-300 shrink-0"
            aria-hidden="true"
          />
          <span className="font-medium text-indigo-100 text-center">
            {t("message")}
          </span>

          <Link
            href={`/${locale}/founders`}
            className="inline-flex items-center gap-1 shrink-0 font-semibold text-white underline-offset-4 hover:underline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2 focus-visible:ring-offset-indigo-950"
          >
            {t("cta")}
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </Link>

          <button
            type="button"
            onClick={handleDismiss}
            aria-label={t("dismiss_aria")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-indigo-200/70 hover:text-white transition rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2 focus-visible:ring-offset-indigo-950"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
