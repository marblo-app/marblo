"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
  getConsent,
  saveConsent,
  DEFAULT_CONSENT,
  type PrivacyConsent,
  type ConsentLocale,
} from "@/lib/privacyConsent";
import { ShieldCheck, Loader2, Mail, ExternalLink } from "lucide-react";
import { localeHref } from "@/i18n/routing";

/** PIPA 제36조 — 보유 개인정보 삭제 요청 메일 템플릿. */
function buildDeletionMailto(uid: string, email: string | null): string {
  const subject = encodeURIComponent(
    "[Marblo] 개인정보 삭제 요청 (PIPA 제36조)"
  );
  const body = encodeURIComponent(
    `안녕하세요.\n\n` +
      `아래 계정의 개인정보 삭제를 요청합니다 (개인정보 보호법 제36조).\n\n` +
      `사용자 UID: ${uid}\n` +
      `이메일: ${email ?? "(미확인)"}\n\n` +
      `삭제 대상: 계정 및 관련 개인정보 전체\n\n` +
      `30일 이내 처리 결과 회신 부탁드립니다.\n`
  );
  return `mailto:team@marblo.app?subject=${subject}&body=${body}`;
}

/** 필수 동의 철회 = 서비스 이용 종료 → 계정/데이터 삭제 요청 메일. */
function buildWithdrawMailto(uid: string, email: string | null): string {
  const subject = encodeURIComponent(
    "[Marblo] 필수 동의 철회 및 계정 삭제 요청"
  );
  const body = encodeURIComponent(
    `안녕하세요.\n\n` +
      `개인정보 수집·이용 및 국외 이전에 대한 필수 동의를 철회하고,\n` +
      `이에 따른 계정 해지 및 개인정보 삭제를 요청합니다.\n\n` +
      `사용자 UID: ${uid}\n` +
      `이메일: ${email ?? "(미확인)"}\n\n` +
      `필수 동의 철회 시 서비스 이용이 종료됨을 확인하였습니다.\n`
  );
  return `mailto:team@marblo.app?subject=${subject}&body=${body}`;
}

export default function PrivacySettingsPage() {
  const t = useTranslations("consent");
  const locale = useLocale() as ConsentLocale;
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [consent, setConsent] = useState<PrivacyConsent>(DEFAULT_CONSENT);
  const [loading, setLoading] = useState(true);
  const [marketingBusy, setMarketingBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.push(
          localeHref(locale, `/auth/login?redirect=${encodeURIComponent(
            localeHref(locale, "/my/privacy")
          )}`)
        );
        return;
      }
      setUser(u);
      setConsent(await getConsent(u.uid));
      setLoading(false);
    });
    return () => unsub();
  }, [locale, router]);

  const toggleMarketing = async () => {
    if (!user) return;
    const next = !consent.marketing;
    setError(null);
    setMarketingBusy(true);
    // 낙관적 UI
    setConsent((c) => ({ ...c, marketing: next }));
    try {
      await saveConsent(
        user.uid,
        {
          collectionUse: consent.collectionUse,
          overseasTransfer: consent.overseasTransfer,
          marketing: next,
        },
        consent.locale || locale
      );
    } catch (err) {
      setConsent((c) => ({ ...c, marketing: !next }));
      setError(err instanceof Error ? err.message : t("save_error"));
    } finally {
      setMarketingBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="py-24 px-4 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  const hasRecord = !!consent.acceptedAt;
  const statusBadge = (ok: boolean) =>
    ok ? (
      <span className="text-xs text-emerald-300">
        {t("settings_status_agreed")}
      </span>
    ) : (
      <span className="text-xs text-zinc-500">{t("settings_status_none")}</span>
    );

  return (
    <div className="py-24 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-2">
          <ShieldCheck className="w-6 h-6 text-indigo-400" />
          <h1 className="text-2xl font-bold">{t("settings_title")}</h1>
        </div>
        <p className="text-sm text-zinc-400 mb-8">{t("settings_subtitle")}</p>

        {/* 필수 동의 현황 */}
        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mb-6">
          <h2 className="text-sm font-semibold text-zinc-200 mb-4">
            {t("settings_required_section")}
          </h2>
          <div className="divide-y divide-zinc-800">
            <div className="flex items-center justify-between py-3">
              <span className="text-sm text-zinc-300">
                {t("collectionUse_label")}
              </span>
              {statusBadge(consent.collectionUse)}
            </div>
            <div className="flex items-center justify-between py-3">
              <span className="text-sm text-zinc-300">
                {t("overseasTransfer_label")}
              </span>
              {statusBadge(consent.overseasTransfer)}
            </div>
          </div>
          {hasRecord && (
            <p className="text-xs text-zinc-500 mt-4">
              {t("settings_version")}: {consent.version || "-"} ·{" "}
              {t("settings_acceptedAt")}:{" "}
              {consent.acceptedAt?.toLocaleString() ?? "-"}
            </p>
          )}
        </section>

        {/* 마케팅 수신 (선택) — 자유 철회 */}
        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mb-6">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-zinc-200">
                {t("settings_marketing_section")}
              </h2>
              <p className="text-xs text-zinc-500 mt-1">
                {t("settings_marketing_desc")}
              </p>
            </div>
            <button
              type="button"
              onClick={toggleMarketing}
              disabled={marketingBusy}
              aria-pressed={consent.marketing}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                consent.marketing ? "bg-indigo-500" : "bg-zinc-700"
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  consent.marketing ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
          {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
        </section>

        {/* 필수 동의 철회 */}
        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mb-6">
          <h2 className="text-sm font-semibold text-zinc-200">
            {t("settings_withdraw_title")}
          </h2>
          <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
            {t("settings_withdraw_desc")}
          </p>
          <a
            href={buildWithdrawMailto(user?.uid ?? "", user?.email ?? null)}
            className="inline-flex items-center gap-2 mt-4 text-sm text-amber-300 hover:text-amber-200"
          >
            <Mail className="w-4 h-4" />
            {t("settings_withdraw_button")}
          </a>
        </section>

        {/* 삭제 요청 (PIPA §36) */}
        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mb-6">
          <h2 className="text-sm font-semibold text-zinc-200">
            {t("settings_deletion_title")}
          </h2>
          <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
            {t("settings_deletion_desc")}
          </p>
          <a
            href={buildDeletionMailto(user?.uid ?? "", user?.email ?? null)}
            className="inline-flex items-center gap-2 mt-4 text-sm text-red-300 hover:text-red-200"
          >
            <Mail className="w-4 h-4" />
            {t("settings_deletion_button")}
          </a>
        </section>

        <Link
          href={localeHref(locale, "/legal/privacy")}
          className="inline-flex items-center gap-1.5 text-sm text-indigo-300 hover:text-indigo-200"
        >
          {t("settings_view_policy")}
          <ExternalLink className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}
