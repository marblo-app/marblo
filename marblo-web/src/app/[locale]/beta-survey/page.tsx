"use client";

import { useCallback, useEffect, useState } from "react";
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
import { refreshEmailVerified } from "@/lib/emailVerification";
import EmailVerificationActions from "@/components/EmailVerificationActions";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  MailWarning,
  Sparkles,
} from "lucide-react";
import { localeHref } from "@/i18n/routing";

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
  // null = 아직 판정 전. 서버는 email_verified 토큰 클레임을 요구하므로
  // 캐시된 로컬 플래그가 아니라 reload+토큰 갱신 결과를 신뢰한다.
  const [emailVerified, setEmailVerified] = useState<boolean | null>(null);

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
    const unsub = onAuthStateChanged(auth, async (u) => {
      setAuthLoading(false);
      if (!u) {
        const redirectPath = localeHref(locale, "/beta-survey");
        router.push(
          localeHref(locale, `/auth/login?redirect=${encodeURIComponent(redirectPath)}`)
        );
        return;
      }
      setUser(u);
      try {
        setEmailVerified(await refreshEmailVerified(u));
      } catch {
        // 조회 실패 시 캐시값으로 폴백 — 게이트 자체는 서버가 강제하므로
        // 여기서 잘못 열려도 제출은 failed-precondition 으로 막힌다.
        setEmailVerified(u.emailVerified);
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

    // 미인증이면 콜러블을 때리지 않는다 — 어차피 failed-precondition 으로
    // 튕기고, 사용자에겐 원인 모를 에러로만 보인다. 배너로 유도한다.
    if (emailVerified === false) {
      setErrorMsg(null);
      return;
    }

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
      // 서버가 인증 미완료로 거절 → 배너를 띄워 인증 경로로 유도한다.
      // (인증 직후 토큰이 아직 갱신 안 된 경계 케이스도 여기로 들어온다.)
      if (code === "failed-precondition") setEmailVerified(false);
      const key = code && ERROR_KEY[code];
      setErrorMsg(key ? t(key) : t("error_network"));
      setStatus("idle");
    }
  }

  // 인증 완료 → 이 자리에서 잠금 해제. 작성 중인 답변은 그대로 둔다.
  const handleVerified = useCallback(() => {
    setEmailVerified(true);
    setErrorMsg(null);
  }, []);

  // 판정 전(null)에는 잠그지 않는다 — 이미 인증된 사용자(Google 로그인 포함)에게
  // 배너가 한 번 깜빡였다 사라지는 걸 막기 위함. 판정은 수백 ms 안에 끝난다.
  const needsVerification = emailVerified === false;

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
            href={localeHref(locale, "/download")}
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
            href={localeHref(locale, "/founders")}
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
        {needsVerification && user && (
          <div className="mb-8 bg-amber-500/10 border border-amber-500/40 rounded-2xl p-6">
            <div className="flex items-start gap-3">
              <MailWarning className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-amber-100">
                  {t("verify_title")}
                </h2>
                <p className="text-sm text-amber-200/80 mt-2 leading-relaxed">
                  {t("verify_body")}
                </p>
              </div>
            </div>
            <EmailVerificationActions
              className="mt-5"
              user={user}
              locale={locale}
              redirect={localeHref(locale, "/beta-survey")}
              onVerified={handleVerified}
            />
          </div>
        )}

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
            disabled={status === "submitting" || needsVerification}
            className="inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-400 text-white px-7 py-4 rounded-xl text-base font-semibold transition shadow-lg shadow-indigo-600/30"
          >
            {status === "submitting" && (
              <Loader2 className="w-4 h-4 animate-spin" />
            )}
            {status === "submitting"
              ? t("submitting")
              : needsVerification
              ? t("submit_locked")
              : t("submit")}
          </button>
          <p className="text-xs text-zinc-500 leading-relaxed">
            {t("foot_note")}
          </p>
        </form>
      </section>
    </div>
  );
}
