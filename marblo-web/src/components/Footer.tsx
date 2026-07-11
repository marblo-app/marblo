"use client";

import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";

export default function Footer() {
  const t = useTranslations("footer");
  const locale = useLocale();

  const productLabel =
    locale === "ko" ? "제품" : locale === "ja" ? "プロダクト" : "Product";
  const lecturesLabel =
    locale === "ko" ? "강의" : locale === "ja" ? "講座" : "Lectures";
  const legalLabel =
    locale === "ko" ? "법적 고지" : locale === "ja" ? "法的情報" : "Legal";

  const businessRows: Array<[string, string]> = [
    [t("biz_ceo_label"), t("biz_ceo_value")],
    [t("biz_reg_no_label"), t("biz_reg_no_value")],
    [t("biz_tp_no_label"), t("biz_tp_no_value")],
    [t("biz_address_label"), t("biz_address_value")],
    [t("biz_email_label"), t("biz_email_value")],
    [t("biz_phone_label"), t("biz_phone_value")],
  ];

  return (
    <footer className="border-t border-zinc-800/50 bg-zinc-950 py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
          {/* Brand */}
          <div>
            <h3 className="text-lg font-bold text-white mb-2">Marblo</h3>
            <p className="text-zinc-500 text-sm">{t("description")}</p>
          </div>

          {/* Product */}
          <div>
            <h4 className="text-sm font-semibold text-zinc-300 mb-3">
              {productLabel}
            </h4>
            <ul>
              <li>
                <Link
                  href={`/${locale}/#features`}
                  className="text-zinc-500 hover:text-zinc-300 text-sm block mb-2"
                >
                  {locale === "ko"
                    ? "기능"
                    : locale === "ja"
                    ? "機能"
                    : "Features"}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${locale}/pricing`}
                  className="text-zinc-500 hover:text-zinc-300 text-sm block mb-2"
                >
                  {locale === "ko"
                    ? "가격"
                    : locale === "ja"
                    ? "料金"
                    : "Pricing"}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${locale}/download`}
                  className="text-zinc-500 hover:text-zinc-300 text-sm block mb-2"
                >
                  {locale === "ko"
                    ? "다운로드"
                    : locale === "ja"
                    ? "ダウンロード"
                    : "Download"}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${locale}/guide`}
                  className="text-zinc-500 hover:text-zinc-300 text-sm block mb-2"
                >
                  {locale === "ko"
                    ? "시작 가이드"
                    : locale === "ja"
                    ? "スタートガイド"
                    : "Getting Started"}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${locale}/bugs`}
                  className="text-zinc-500 hover:text-zinc-300 text-sm block mb-2"
                >
                  {locale === "ko"
                    ? "버그 신고"
                    : locale === "ja"
                    ? "バグを報告"
                    : "Report a bug"}
                </Link>
              </li>
            </ul>
          </div>

          {/* Lectures */}
          <div>
            <h4 className="text-sm font-semibold text-zinc-300 mb-3">
              {lecturesLabel}
            </h4>
            <ul>
              <li>
                <Link
                  href={`/${locale}/lectures`}
                  className="text-zinc-500 hover:text-zinc-300 text-sm block mb-2"
                >
                  {locale === "ko"
                    ? "전체 강의"
                    : locale === "ja"
                    ? "全講座"
                    : "All Lectures"}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${locale}/lectures/marblo-v3-masterclass`}
                  className="text-zinc-500 hover:text-zinc-300 text-sm block mb-2"
                >
                  {locale === "ko"
                    ? "마블로 v3 마스터클래스"
                    : locale === "ja"
                    ? "Marblo v3 マスタークラス"
                    : "Marblo v3 Masterclass"}
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="text-sm font-semibold text-zinc-300 mb-3">
              {legalLabel}
            </h4>
            <ul>
              <li>
                <Link
                  href={`/${locale}/legal/terms`}
                  className="text-zinc-500 hover:text-zinc-300 text-sm block mb-2"
                >
                  {t("terms")}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${locale}/legal/privacy`}
                  className="text-zinc-500 hover:text-zinc-300 text-sm block mb-2"
                >
                  {t("privacy")}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${locale}/legal/refund`}
                  className="text-zinc-500 hover:text-zinc-300 text-sm block mb-2"
                >
                  {t("refund")}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${locale}/legal/business`}
                  className="text-zinc-500 hover:text-zinc-300 text-sm block mb-2"
                >
                  {t("business_info")}
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Business Info Block (Korean e-commerce law mandatory disclosure) */}
        <div className="border-t border-zinc-800/50 pt-8 mb-8">
          <p className="text-zinc-300 text-sm font-semibold mb-3">
            {t("biz_company_name")}
          </p>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5 text-xs text-zinc-500">
            {businessRows.map(([label, value]) => (
              <div key={label} className="flex gap-2">
                <dt className="text-zinc-600 shrink-0">{label}:</dt>
                <dd className="text-zinc-400">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="border-t border-zinc-800/50 pt-8 text-center">
          <p className="text-zinc-600 text-sm">{t("copyright")}</p>
        </div>
      </div>
    </footer>
  );
}
