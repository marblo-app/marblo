"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { onAuthStateChanged, User } from "firebase/auth";
import {
  httpsCallable,
  getFunctions,
  FunctionsError,
} from "firebase/functions";
import { auth } from "@/lib/firebase";
import app from "@/lib/firebase";
import { ArrowLeft, CheckCircle2, Loader2, Sparkles } from "lucide-react";

type Status = "idle" | "submitting" | "success";

// Maps Cloud Function error codes → translation keys for friendly messages.
const ERROR_KEY: Record<string, string> = {
  "failed-precondition": "error_email_unverified",
  "permission-denied": "error_not_founder",
  "already-exists": "error_already_submitted",
  "deadline-exceeded": "error_deadline",
  "invalid-argument": "error_invalid",
};

export default function FounderFeedbackPage() {
  const t = useTranslations("founderFeedback");
  const locale = useLocale();
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [q1, setQ1] = useState("");
  const [q2, setQ2] = useState("");
  const [q3, setQ3] = useState("");
  const [q4, setQ4] = useState("");
  const [q5, setQ5] = useState("");
  const [rating, setRating] = useState("");
  const [reason, setReason] = useState("");
  const [consentQuote, setConsentQuote] = useState(false);

  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setAuthLoading(false);
      if (!u) {
        const redirectPath = `/${locale}/founders/feedback`;
        router.push(
          `/${locale}/auth/login?redirect=${encodeURIComponent(redirectPath)}`
        );
      } else {
        setUser(u);
      }
    });
    return () => unsub();
  }, [locale, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "submitting" || !user) return;

    const ratingNum = Number(rating);
    if (
      !q1.trim() ||
      !q2.trim() ||
      !q4.trim() ||
      !q5.trim() ||
      !reason.trim()
    ) {
      setErrorMsg(t("error_required"));
      return;
    }
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 10) {
      setErrorMsg(t("error_rating"));
      return;
    }

    setStatus("submitting");
    setErrorMsg(null);

    try {
      const functions = getFunctions(app, "us-central1");
      const submit = httpsCallable(functions, "submitFounderFeedback");
      await submit({
        locale,
        answers: {
          q1: q1.trim(),
          q2: q2.trim(),
          q3: q3.trim(),
          q4: q4.trim(),
          q5: q5.trim(),
          reason: reason.trim(),
          rating: ratingNum,
          consentQuote,
        },
      });
      setStatus("success");
    } catch (err) {
      const code = (err as FunctionsError)?.code?.replace("functions/", "");
      const key = code && ERROR_KEY[code];
      setErrorMsg(key ? t(key) : t("error_network"));
      setStatus("idle");
    }
  }

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-300" />
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-emerald-500/10 border border-emerald-500/40 rounded-2xl p-8 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-300 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-emerald-100">
            {t("success_title")}
          </h1>
          <p className="text-emerald-200/80 mt-3 leading-relaxed">
            {t("success_body")}
          </p>
          <Link
            href={`/${locale}/download`}
            className="inline-flex items-center justify-center gap-2 mt-6 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-xl font-semibold transition"
          >
            {t("success_cta")}
          </Link>
        </div>
      </div>
    );
  }

  const fields = [
    { v: q1, set: setQ1, key: "q1", required: true },
    { v: q2, set: setQ2, key: "q2", required: true },
    { v: q3, set: setQ3, key: "q3", required: false },
    { v: q4, set: setQ4, key: "q4", required: true },
    { v: q5, set: setQ5, key: "q5", required: true },
  ] as const;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-950/40 via-zinc-950 to-zinc-950" />
        <div className="relative max-w-2xl mx-auto px-4 pt-16 pb-8">
          <Link
            href={`/${locale}/founders`}
            className="inline-flex items-center gap-1.5 text-sm text-indigo-300 hover:text-indigo-200 transition mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            {t("back_link")}
          </Link>
          <span className="inline-flex items-center gap-2 bg-indigo-600/15 text-indigo-300 border border-indigo-500/40 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5" />
            {t("badge")}
          </span>
          <h1 className="text-3xl md:text-4xl font-bold mt-5 leading-tight">
            {t("title")}
          </h1>
          <p className="text-zinc-300 mt-4 leading-relaxed whitespace-pre-line">
            {t("intro")}
          </p>
        </div>
      </section>

      <section className="max-w-2xl mx-auto px-4 pb-20">
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          {fields.map((f) => (
            <div key={f.key}>
              <label className="block text-sm font-semibold text-zinc-200 mb-2">
                {t(`${f.key}_label`)}
                {!f.required && (
                  <span className="ml-2 text-xs text-zinc-500 font-normal">
                    {t("optional")}
                  </span>
                )}
              </label>
              <textarea
                value={f.v}
                onChange={(e) => f.set(e.target.value)}
                rows={3}
                maxLength={5000}
                placeholder={t(`${f.key}_ph`)}
                className="w-full bg-zinc-950/70 border border-zinc-700 rounded-xl px-4 py-3 text-base text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/60 focus:border-indigo-500 resize-y"
              />
            </div>
          ))}

          <div>
            <label className="block text-sm font-semibold text-zinc-200 mb-2">
              {t("rating_label")}
            </label>
            <select
              value={rating}
              onChange={(e) => setRating(e.target.value)}
              className="w-full sm:w-40 bg-zinc-950/70 border border-zinc-700 rounded-xl px-4 py-3 text-base text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/60 focus:border-indigo-500"
            >
              <option value="">{t("rating_ph")}</option>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-zinc-200 mb-2">
              {t("reason_label")}
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={5000}
              placeholder={t("reason_ph")}
              className="w-full bg-zinc-950/70 border border-zinc-700 rounded-xl px-4 py-3 text-base text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/60 focus:border-indigo-500 resize-y"
            />
          </div>

          <label className="flex items-start gap-2 text-sm text-zinc-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={consentQuote}
              onChange={(e) => setConsentQuote(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-zinc-600 bg-zinc-900 text-indigo-500 focus:ring-indigo-500/40"
            />
            <span className="leading-snug">{t("consent_quote")}</span>
          </label>

          {errorMsg && <p className="text-sm text-red-300">{errorMsg}</p>}

          <button
            type="submit"
            disabled={status === "submitting"}
            className="inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-400 text-white px-7 py-4 rounded-xl text-base font-semibold transition shadow-lg shadow-indigo-600/30"
          >
            {status === "submitting" && (
              <Loader2 className="w-4 h-4 animate-spin" />
            )}
            {status === "submitting" ? t("submitting") : t("submit")}
          </button>
          <p className="text-xs text-zinc-500 leading-relaxed">
            {t("foot_note")}
          </p>
        </form>
      </section>
    </div>
  );
}
