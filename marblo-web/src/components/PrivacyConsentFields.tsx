"use client";

import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import type { ConsentFlags } from "@/lib/privacyConsent";
import { localeHref } from "@/i18n/routing";

interface Props {
  value: ConsentFlags;
  onChange: (next: ConsentFlags) => void;
  disabled?: boolean;
}

/**
 * 재사용 가능한 PIPA 동의 체크박스 묶음. 가입 폼과 Gate 모달에서 공유한다.
 * 제어 컴포넌트 — 상태는 부모가 들고, 여기선 표시·토글만 담당.
 *
 *   - 개인정보 수집·이용 (필수)
 *   - 개인정보 국외 이전 별도 동의 (필수, PIPA 제15조 제2항) — amber 강조
 *   - 마케팅 정보 수신 (선택)
 */
export default function PrivacyConsentFields({
  value,
  onChange,
  disabled,
}: Props) {
  const t = useTranslations("consent");
  const locale = useLocale();

  const set = (patch: Partial<ConsentFlags>) =>
    onChange({ ...value, ...patch });

  const allChecked =
    value.collectionUse && value.overseasTransfer && value.marketing;
  const toggleAll = () => {
    const next = !allChecked;
    onChange({
      collectionUse: next,
      overseasTransfer: next,
      marketing: next,
    });
  };

  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-950/40 divide-y divide-zinc-800">
      {/* 전체 동의 */}
      <label className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={allChecked}
          onChange={toggleAll}
          disabled={disabled}
          className="w-4 h-4 rounded border-zinc-600 bg-zinc-900 text-indigo-500 focus:ring-indigo-500/40"
        />
        <span className="text-sm font-semibold text-white">
          {t("agreeAll")}
        </span>
      </label>

      {/* 개인정보 수집·이용 (필수) */}
      <label className="flex items-start gap-3 px-4 py-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={value.collectionUse}
          onChange={(e) => set({ collectionUse: e.target.checked })}
          disabled={disabled}
          className="mt-0.5 w-4 h-4 rounded border-zinc-600 bg-zinc-900 text-indigo-500 focus:ring-indigo-500/40"
        />
        <span className="flex-1 min-w-0 text-sm text-zinc-300 leading-snug">
          <span className="text-indigo-300 font-medium">
            {t("required_badge")}
          </span>{" "}
          {t("collectionUse_label")}
          <span className="block text-xs text-zinc-500 mt-0.5">
            {t("collectionUse_hint")}
          </span>
        </span>
        <Link
          href={localeHref(locale, "/legal/privacy")}
          target="_blank"
          className="text-xs text-zinc-400 hover:text-indigo-300 underline shrink-0"
        >
          {t("view")}
        </Link>
      </label>

      {/* 개인정보 국외 이전 별도 동의 (필수, PIPA 제15조 제2항) */}
      <label className="flex items-start gap-3 px-4 py-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={value.overseasTransfer}
          onChange={(e) => set({ overseasTransfer: e.target.checked })}
          disabled={disabled}
          className="mt-0.5 w-4 h-4 rounded border-zinc-600 bg-zinc-900 text-amber-500 focus:ring-amber-500/40"
        />
        <span className="flex-1 min-w-0 text-sm text-zinc-300 leading-snug">
          <span className="text-amber-300 font-medium">
            {t("required_badge")}
          </span>{" "}
          {t("overseasTransfer_label")}
          <span className="block text-xs text-zinc-500 mt-0.5">
            {t("overseasTransfer_hint")}
          </span>
        </span>
      </label>

      {/* 마케팅 정보 수신 (선택) */}
      <label className="flex items-start gap-3 px-4 py-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={value.marketing}
          onChange={(e) => set({ marketing: e.target.checked })}
          disabled={disabled}
          className="mt-0.5 w-4 h-4 rounded border-zinc-600 bg-zinc-900 text-indigo-500 focus:ring-indigo-500/40"
        />
        <span className="flex-1 min-w-0 text-sm text-zinc-300 leading-snug">
          {/* ★`optional_badge` 를 앞에 붙이지 않는다 — 확정 문구
              (docs/marketing-hashed-email-ads-targeting-2026-09-07.md §8-2)의
              `marketing_label` 이 "[선택]"/"[Optional]"/"[任意]" 를 이미 포함한다.
              둘 다 그리면 화면에 "[선택] [선택] …" 로 두 번 나온다.
              필수 항목 두 줄은 `required_badge` 를 계속 쓴다 — 그쪽 라벨에는
              접두사가 없다.
              ★`optional_badge` 키 자체는 지우지 않는다: 라벨이 접두사를 갖지
              않는 선택 항목이 생기면 다시 쓴다. */}
          {t("marketing_label")}
          <span className="block text-xs text-zinc-500 mt-0.5">
            {t("marketing_hint")}
          </span>
        </span>
      </label>
    </div>
  );
}
