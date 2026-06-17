"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import PrivacyConsentFields from "@/components/PrivacyConsentFields";
import {
  saveConsent,
  REQUIRED_FLAGS,
  type ConsentFlags,
  type ConsentLocale,
} from "@/lib/privacyConsent";

export default function SignupPage() {
  const t = useTranslations("auth");
  const tc = useTranslations("consent");
  const locale = useLocale();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [consent, setConsent] = useState<ConsentFlags>({
    collectionUse: false,
    overseasTransfer: false,
    marketing: false,
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const requiredOk = REQUIRED_FLAGS.every((f) => consent[f]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError(t("passwordMismatch"));
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
      router.push(`/${locale}`);
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
            href={`/${locale}/auth/login`}
            className="text-indigo-400 hover:underline"
          >
            {t("loginLink")}
          </Link>
        </p>
      </div>
    </div>
  );
}
