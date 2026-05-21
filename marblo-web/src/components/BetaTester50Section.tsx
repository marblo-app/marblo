"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import {
  addDoc,
  collection,
  getCountFromServer,
  serverTimestamp,
} from "firebase/firestore";
import { Sparkles, ArrowRight, CheckCircle2 } from "lucide-react";
import { db } from "@/lib/firebase";
import BetaTester50PriceBlock from "./BetaTester50PriceBlock";

const SEAT_CAP = 50;
const COLLECTION = "betatester50_waitlist";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Status = "idle" | "submitting" | "success" | "error" | "closed";
type Locale = "ko" | "en" | "ja";

export default function BetaTester50Section() {
  const t = useTranslations("betatester50");
  const locale = useLocale() as Locale;

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [seatsLeft, setSeatsLeft] = useState<number | null>(null);

  // Live counter from Firestore
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getCountFromServer(collection(db, COLLECTION));
        if (cancelled) return;
        const count = snap.data().count ?? 0;
        const remaining = Math.max(0, SEAT_CAP - count);
        setSeatsLeft(remaining);
        if (remaining === 0) setStatus("closed");
      } catch {
        // Fallback: leave seatsLeft null so static "한정 50명" copy is shown
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "submitting" || status === "closed") return;

    const cleaned = email.trim().toLowerCase();
    if (!EMAIL_RE.test(cleaned) || cleaned.length > 254) {
      setErrorMsg(t("error_invalid_email"));
      setStatus("error");
      return;
    }

    setStatus("submitting");
    setErrorMsg(null);

    try {
      await addDoc(collection(db, COLLECTION), {
        email: cleaned,
        locale,
        source: "home",
        createdAt: serverTimestamp(),
      });
      setStatus("success");
      if (seatsLeft !== null) setSeatsLeft(Math.max(0, seatsLeft - 1));
    } catch {
      setErrorMsg(t("error_network"));
      setStatus("error");
    }
  }

  const isClosed = status === "closed";
  const isSubmitting = status === "submitting";
  const isSuccess = status === "success";

  return (
    <section className="px-4 pt-4 pb-12 md:pb-16">
      <div className="max-w-4xl mx-auto">
        <div className="relative overflow-hidden rounded-3xl border border-indigo-500/40 bg-gradient-to-br from-indigo-950/60 via-zinc-900 to-zinc-900 p-8 md:p-12 shadow-2xl shadow-indigo-900/30">
          {/* Glow accent */}
          <div className="pointer-events-none absolute -top-24 -right-24 w-72 h-72 bg-indigo-500/20 rounded-full blur-3xl" />
          <div className="pointer-events-none absolute -bottom-32 -left-16 w-72 h-72 bg-fuchsia-500/10 rounded-full blur-3xl" />

          <div className="relative">
            {/* Header row: badge + counter */}
            <div className="flex flex-wrap items-center gap-3 mb-6">
              <span className="inline-flex items-center gap-2 bg-indigo-500/20 text-indigo-200 border border-indigo-400/40 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider">
                <Sparkles className="w-3.5 h-3.5" />
                {t("badge")}
              </span>
              <span className="inline-flex items-center bg-zinc-900/80 border border-zinc-700 text-zinc-200 px-3 py-1 rounded-full text-xs font-medium">
                {seatsLeft === null
                  ? t("seats_loading")
                  : t("seats_left", { n: seatsLeft })}
              </span>
            </div>

            <h2 className="text-3xl md:text-5xl font-bold leading-tight tracking-tight">
              {t("title")}
            </h2>
            <p className="mt-4 text-lg md:text-xl text-zinc-300 leading-relaxed max-w-2xl">
              {t("subtitle")}
            </p>

            {/* Price block */}
            <div className="mt-7">
              <BetaTester50PriceBlock />
            </div>

            {/* Form / success / closed */}
            <div className="mt-8">
              {isSuccess ? (
                <div className="flex items-start gap-3 bg-emerald-500/10 border border-emerald-500/40 rounded-2xl p-5">
                  <CheckCircle2 className="w-6 h-6 text-emerald-300 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-emerald-100 font-semibold text-lg">
                      {t("success_title")}
                    </p>
                    <p className="text-emerald-200/80 text-sm mt-1 leading-relaxed">
                      {t("success_body")}
                    </p>
                  </div>
                </div>
              ) : (
                <form
                  onSubmit={handleSubmit}
                  className="flex flex-col sm:flex-row gap-3"
                >
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    required
                    disabled={isClosed || isSubmitting}
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (status === "error") setStatus("idle");
                    }}
                    placeholder={t("email_placeholder")}
                    className="flex-1 bg-zinc-950/70 border border-zinc-700 rounded-xl px-5 py-4 text-base text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/60 focus:border-indigo-500 disabled:opacity-50"
                    aria-label={t("email_placeholder")}
                  />
                  <button
                    type="submit"
                    disabled={isClosed || isSubmitting}
                    className="inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-400 disabled:cursor-not-allowed text-white px-7 py-4 rounded-xl text-base font-semibold transition shadow-lg shadow-indigo-600/30"
                  >
                    {isClosed
                      ? t("closed")
                      : isSubmitting
                      ? t("cta_submitting")
                      : t("cta_apply")}
                    {!isClosed && !isSubmitting && (
                      <ArrowRight className="w-4 h-4" />
                    )}
                  </button>
                </form>
              )}
              {errorMsg && !isSuccess && (
                <p className="mt-3 text-sm text-red-300">{errorMsg}</p>
              )}
            </div>

            {/* Obligations */}
            <div className="mt-8 pt-6 border-t border-zinc-800/80">
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-3">
                {t("obligations_heading")}
              </p>
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center bg-zinc-900/80 border border-zinc-700 text-zinc-200 text-sm px-3 py-1.5 rounded-lg">
                  {t("ob_review_required")}
                </span>
                <span className="inline-flex items-center bg-amber-500/10 border border-amber-500/30 text-amber-100 text-sm px-3 py-1.5 rounded-lg">
                  {t("ob_interview_optional")}
                </span>
              </div>
              <p className="mt-3 text-xs text-zinc-500 leading-relaxed">
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
      </div>
    </section>
  );
}
