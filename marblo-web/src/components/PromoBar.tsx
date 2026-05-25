"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { Sparkles, X } from "lucide-react";
import { isPromoBarOpen, PROMO_BAR_DISMISS_KEY } from "@/lib/foundation50";
import BetaTester50SignupForm from "./BetaTester50SignupForm";

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
    <div className="relative z-[60] border-b border-indigo-500/30 bg-gradient-to-r from-indigo-700/40 via-violet-700/30 to-indigo-700/40 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 text-sm">
          <div className="flex items-center gap-2 text-indigo-100">
            <Sparkles className="w-4 h-4 text-indigo-300 shrink-0" />
            <span className="font-medium">{t("message")}</span>
          </div>

          <div className="w-full sm:w-auto sm:max-w-md">
            <BetaTester50SignupForm
              source="promo_bar"
              layout="inline-compact"
            />
          </div>

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
      </div>
    </div>
  );
}
