"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { sanitizeRedirect } from "@/lib/sanitizeRedirect";
import { isPlausibleEmail } from "@/lib/orgOnboarding";
import { sendVerification } from "@/lib/emailVerification";
import PrivacyConsentFields from "@/components/PrivacyConsentFields";
import {
  saveConsent,
  REQUIRED_FLAGS,
  type ConsentFlags,
  type ConsentLocale,
} from "@/lib/privacyConsent";
import { localeHref } from "@/i18n/routing";

export default function SignupPage() {
  const t = useTranslations("auth");
  const tc = useTranslations("consent");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  // 초대 흐름(#1338 (f)): 가입 후 인증 페이지를 거쳐 원래 화면(초대 수락)으로
  // 돌아가게 redirect 를 관통시키고, 초대 이메일을 프리필한다 — "초대받은
  // 이메일로 가입해야 수락됩니다" 를 실수하기 어렵게 만드는 쪽이 문구보다 세다.
  const redirect = sanitizeRedirect(searchParams.get("redirect"), "");
  const emailParam = searchParams.get("email");
  const [email, setEmail] = useState(
    emailParam && isPlausibleEmail(emailParam) ? emailParam : ""
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [consent, setConsent] = useState<ConsentFlags>({
    collectionUse: false,
    overseasTransfer: false,
    marketing: false,
  });
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const requiredOk = REQUIRED_FLAGS.every((f) => consent[f]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError(t("passwordMismatch"));
      return;
    }
    if (!ageConfirmed) {
      setError(t("ageRequired"));
      return;
    }
    if (!requiredOk) {
      setError(tc("error_required"));
      return;
    }
    setSubmitting(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      // 계정 생성 직후 동의를 저장 — Gate 모달이 다시 뜨지 않도록.
      await saveConsent(cred.user.uid, consent, locale as ConsentLocale);
      // 인증 메일 발송 — email/password 계정은 이 경로가 없으면 email_verified 를
      // 영원히 못 얻고, 파운더 설문(submitFounderFeedback)이 계속 거절된다.
      // 발송 실패는 가입 자체를 되돌릴 이유가 아니다(계정은 이미 생성됨).
      // /auth/verify 에 재발송 버튼이 있으니 그쪽으로 보내고 거기서 복구시킨다.
      let sent = false;
      try {
        await sendVerification(cred.user, { locale });
        sent = true;
      } catch {
        // 무시 — verify 페이지가 '보내기' 상태로 열린다.
      }
      // redirect 가 있으면 verify 의 [계속] 버튼이 원래 화면으로 데려간다
      // (verify 페이지는 이미 ?redirect= 를 sanitize 해서 받는다).
      const verifyQuery = new URLSearchParams();
      if (sent) verifyQuery.set("sent", "1");
      if (redirect) verifyQuery.set("redirect", redirect);
      const qs = verifyQuery.toString();
      router.push(localeHref(locale, `/auth/verify${qs ? `?${qs}` : ""}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="py-24 px-4">
      <div className="max-w-md mx-auto bg-zinc-900 border border-zinc-800 rounded-2xl p-8">
        <h1 className="text-2xl font-bold text-center mb-8">{t("signup")}</h1>
        <form onSubmit={handleSignup} className="space-y-4">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("email")}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("password")}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
          />
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={t("confirmPassword")}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
          />
          <PrivacyConsentFields
            value={consent}
            onChange={setConsent}
            disabled={submitting}
          />
          <label className="flex items-start gap-2 text-sm text-zinc-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={ageConfirmed}
              onChange={(e) => setAgeConfirmed(e.target.checked)}
              disabled={submitting}
              className="mt-0.5 w-4 h-4 rounded border-zinc-600 bg-zinc-900 text-indigo-500 focus:ring-indigo-500/40 shrink-0"
            />
            <span className="leading-snug">{t("ageConfirm")}</span>
          </label>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-3 rounded-lg font-medium transition"
          >
            {submitting ? tc("saving") : t("signup")}
          </button>
        </form>
        <p className="text-center text-zinc-400 text-sm mt-6">
          {t("hasAccount")}{" "}
          <Link
            href={localeHref(locale, "/auth/login")}
            className="text-indigo-400 hover:underline"
          >
            {t("loginLink")}
          </Link>
        </p>
      </div>
    </div>
  );
}
