"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import PrivacyConsentFields from "./PrivacyConsentFields";
import {
  saveConsent,
  REQUIRED_FLAGS,
  type ConsentFlags,
  type ConsentLocale,
} from "@/lib/privacyConsent";

interface Props {
  uid: string;
  /** 동의 저장 완료 또는 로그아웃 후 호출 — 호스트가 모달을 내린다. */
  onDone: () => void;
}

/**
 * 필수 동의를 받지 못한 로그인 사용자에게 표시되는 차단 모달. v3
 * PrivacyConsentGate/Modal 패턴의 웹 이식판. 필수 항목에 동의하기 전엔
 * 닫을 수 없고(로그아웃만 가능), 동의 시 Firestore 에 저장한다.
 */
export default function PrivacyConsentModal({ uid, onDone }: Props) {
  const t = useTranslations("consent");
  const locale = useLocale() as ConsentLocale;
  const [flags, setFlags] = useState<ConsentFlags>({
    collectionUse: false,
    overseasTransfer: false,
    marketing: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requiredOk = REQUIRED_FLAGS.every((f) => flags[f]);

  const handleContinue = async () => {
    if (!requiredOk) {
      setError(t("error_required"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await saveConsent(uid, flags, locale);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("save_error"));
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } finally {
      onDone();
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl">
        <div className="px-6 py-5 border-b border-zinc-800">
          <h2 className="text-lg font-bold text-white">{t("gate_title")}</h2>
          <p className="mt-1 text-sm text-zinc-400 leading-relaxed">
            {t("gate_intro")}
          </p>
        </div>
        <div className="px-6 py-4">
          <PrivacyConsentFields
            value={flags}
            onChange={setFlags}
            disabled={submitting}
          />
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        </div>
        <div className="flex gap-2 px-6 py-4 border-t border-zinc-800">
          <button
            type="button"
            onClick={handleLogout}
            disabled={submitting}
            className="flex-1 rounded-lg border border-zinc-700 px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            {t("gate_logout")}
          </button>
          <button
            type="button"
            onClick={handleContinue}
            disabled={submitting || !requiredOk}
            className="flex-1 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? t("saving") : t("gate_continue")}
          </button>
        </div>
      </div>
    </div>
  );
}
