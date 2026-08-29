"use client";

import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { Sparkles, ArrowRight, X } from "lucide-react";
import { localeHref } from "@/i18n/routing";

interface Props {
  /** 닫기(뒤로/X/오버레이) — 호스트가 dismiss 기록 후 모달을 내린다. */
  onDismiss: () => void;
}

/**
 * 선정 파운더(미회신)에게 "성실 설문 회신 시 운영자 검토 후 Pro 최대 총 5개월" 을
 * 안내하고 /beta-survey 로 유도하는 dismiss 가능한 팝업. 차단형이 아니라
 * 언제든 닫을 수 있다(PrivacyConsentModal 은 차단형이라 다르다).
 *
 * copy 는 진실되게: 제출만으로 자동 지급이 아니라 운영자 루브릭 심사를 거친다.
 */
export default function FounderSurveyPromptModal({ onDismiss }: Props) {
  const t = useTranslations("founderSurveyPrompt");
  const locale = useLocale();

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
      role="presentation"
      onClick={onDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="founder-survey-prompt-title"
        className="relative w-full max-w-md rounded-2xl border border-indigo-500/30 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("dismiss_aria")}
          className="absolute right-3 top-3 text-zinc-400 hover:text-white transition rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="px-6 pt-6 pb-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-200">
            <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
            {t("badge")}
          </div>
          <h2
            id="founder-survey-prompt-title"
            className="mt-4 text-xl font-bold text-white"
          >
            {t("title")}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-300">
            {t("body")}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-zinc-500">
            {t("note")}
          </p>
        </div>

        <div className="flex flex-col gap-2 px-6 py-5 sm:flex-row-reverse">
          <Link
            href={localeHref(locale, "/beta-survey")}
            onClick={onDismiss}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            {t("cta")}
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Link>
          <button
            type="button"
            onClick={onDismiss}
            className="flex-1 rounded-lg border border-zinc-700 px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
          >
            {t("later")}
          </button>
        </div>
      </div>
    </div>
  );
}
