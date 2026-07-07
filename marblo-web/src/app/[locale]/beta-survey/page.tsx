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

// V2 성실 설문 7문항 — 전부 필수 서술형. 서버(submitFounderFeedback)는
// answers.q1~q7 을 모두 비어있지 않은 문자열로 요구한다.
const QUESTION_KEYS = ["q1", "q2", "q3", "q4", "q5", "q6", "q7"] as const;

type QuestionKey = typeof QUESTION_KEYS[number];

export default function BetaSurveyPage() {
  const t = useTranslations("betaSurvey");
  const locale = useLocale();
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [answers, setAnswers] = useState<Record<QuestionKey, string>>({
    q1: "",
    q2: "",
    q3: "",
    q4: "",
    q5: "",
    q6: "",
    q7: "",
  });

  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setAuthLoading(false);
      if (!u) {
        const redirectPath = `/${locale}/beta-survey`;
        router.push(
          `/${locale}/auth/login?redirect=${encodeURIComponent(redirectPath)}`
        );
      } else {
        setUser(u);
      }
    });
    return () => unsub();
  }, [locale, router]);

  function setAnswer(key: QuestionKey, value: string) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "submitting" || !user) return;

    const missing = QUESTION_KEYS.some((k) => !answers[k].trim());
    if (missing) {
      setErrorMsg(t("error_required"));
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
          q1: answers.q1.trim(),
          q2: answers.q2.trim(),
          q3: answers.q3.trim(),
          q4: answers.q4.trim(),
          q5: answers.q5.trim(),
          q6: answers.q6.trim(),
          q7: answers.q7.trim(),
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
          <p className="text-emerald-200/80 mt-3 leading-relaxed whitespace-pre-line">
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
          {QUESTION_KEYS.map((key) => (
            <div key={key}>
              <label className="block text-sm font-semibold text-zinc-200 mb-2">
                {t(`${key}_label`)}
              </label>
              <textarea
                value={answers[key]}
                onChange={(e) => setAnswer(key, e.target.value)}
                rows={3}
                maxLength={5000}
                placeholder={t(`${key}_ph`)}
                className="w-full bg-zinc-950/70 border border-zinc-700 rounded-xl px-4 py-3 text-base text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/60 focus:border-indigo-500 resize-y"
              />
            </div>
          ))}

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
