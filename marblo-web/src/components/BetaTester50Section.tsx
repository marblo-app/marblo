"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { collection, getCountFromServer } from "firebase/firestore";
import { Sparkles } from "lucide-react";
import { db } from "@/lib/firebase";
import BetaTester50PriceBlock from "./BetaTester50PriceBlock";
import BetaTester50SignupForm from "./BetaTester50SignupForm";

const SEAT_CAP = 50;
const COLLECTION = "betatester50_waitlist";
// Only reveal the "N seats left" counter once at least this many people
// have signed up — empty counters read as "nobody's buying." Configurable
// at build time via NEXT_PUBLIC_SEATS_COUNTER_THRESHOLD.
const COUNTER_REVEAL_THRESHOLD = Number(
  process.env.NEXT_PUBLIC_SEATS_COUNTER_THRESHOLD ?? 15
);

export default function BetaTester50Section() {
  const t = useTranslations("betatester50");
  const locale = useLocale();

  const [seatsLeft, setSeatsLeft] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getCountFromServer(collection(db, COLLECTION));
        if (cancelled) return;
        const count = snap.data().count ?? 0;
        setSeatsLeft(Math.max(0, SEAT_CAP - count));
      } catch {
        // Fallback: static copy shown when seatsLeft remains null
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isClosed = seatsLeft === 0;
  // Reveal the live counter only after enough seats are taken — until then
  // show the static "한정 50명" copy so the section never reads as empty.
  const seatsTaken = seatsLeft === null ? 0 : SEAT_CAP - seatsLeft;
  const showLiveCounter =
    seatsLeft !== null && seatsTaken >= COUNTER_REVEAL_THRESHOLD;

  return (
    <section className="px-4 pt-4 pb-12 md:pb-16">
      <div className="max-w-4xl mx-auto">
        <div className="relative overflow-hidden rounded-3xl border border-indigo-500/40 bg-gradient-to-br from-indigo-950/60 via-zinc-900 to-zinc-900 p-8 md:p-12 shadow-2xl shadow-indigo-900/30">
          <div className="pointer-events-none absolute -top-24 -right-24 w-72 h-72 bg-indigo-500/20 rounded-full blur-3xl" />
          <div className="pointer-events-none absolute -bottom-32 -left-16 w-72 h-72 bg-fuchsia-500/10 rounded-full blur-3xl" />

          <div className="relative">
            <div className="flex flex-wrap items-center gap-3 mb-6">
              <span className="inline-flex items-center gap-2 bg-indigo-500/20 text-indigo-200 border border-indigo-400/40 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider">
                <Sparkles className="w-3.5 h-3.5" />
                {t("badge")}
              </span>
              <span className="inline-flex items-center bg-zinc-900/80 border border-zinc-700 text-zinc-200 px-3 py-1 rounded-full text-xs font-medium">
                {showLiveCounter
                  ? t("seats_left", { n: seatsLeft })
                  : t("seats_loading")}
              </span>
            </div>

            <h2 className="text-3xl md:text-5xl font-bold leading-tight tracking-tight">
              {t("title")}
            </h2>
            <p className="mt-4 text-lg md:text-xl text-zinc-300 leading-relaxed max-w-2xl">
              {t("subtitle")}
            </p>

            <div className="mt-7">
              <BetaTester50PriceBlock />
            </div>

            <div className="mt-8">
              <BetaTester50SignupForm
                source="home"
                isClosed={isClosed}
                onSuccess={() => {
                  if (seatsLeft !== null)
                    setSeatsLeft(Math.max(0, seatsLeft - 1));
                }}
              />
            </div>

            <div className="mt-8 pt-6 border-t border-zinc-800/80 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <p className="text-sm font-semibold text-indigo-200 mb-3">
                  {t("receive_heading")}
                </p>
                <ul className="space-y-2 text-sm text-zinc-200 leading-relaxed">
                  <li>{t("receive_item1")}</li>
                  <li>{t("receive_item2")}</li>
                  <li>{t("receive_item3")}</li>
                </ul>
              </div>
              <div>
                <p className="text-sm font-semibold text-indigo-200 mb-3">
                  {t("role_heading")}
                </p>
                <ul className="space-y-2 text-sm text-zinc-200 leading-relaxed">
                  <li>{t("role_required")}</li>
                  <li className="text-amber-200/90">{t("role_optional")}</li>
                </ul>
              </div>
            </div>

            <p className="mt-6 text-xs text-zinc-500 leading-relaxed">
              {t("byok_note")}
            </p>

            <Link
              href={`/${locale}/foundation50`}
              className="inline-flex items-center gap-1 mt-4 text-sm text-indigo-300 hover:text-indigo-200 transition"
            >
              {t("details_link")}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
