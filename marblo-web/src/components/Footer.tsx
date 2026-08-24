"use client";

import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { comingSoonLabel } from "@/data/lectures";
import { localeHref } from "@/i18n/routing";
import { featuredPostsFor, featuredLabel } from "@/data/featuredPosts";

export default function Footer() {
  const t = useTranslations("footer");
  const locale = useLocale();

  // 추천 글은 푸터를 통해 **모든 페이지**에서 링크된다. 이게 이 PR 의 링크
  // 구조 변경 중 가장 큰 한 방이다: 이미 색인·크롤되고 있는 페이지들에서
  // 링크가 나가야 구글이 그 URL 을 읽으러 올 이유가 생긴다. 블로그 인덱스
  // 하나에서만 링크되던 글이 사이트 전역 링크를 받는다.
  // 선정 근거·개수 제한은 src/data/featuredPosts.ts 주석 참조.
  const featured = featuredPostsFor(locale);

  const productLabel =
    locale === "ko" ? "제품" : locale === "ja" ? "プロダクト" : "Product";
  const blogLabel =
    locale === "ko" ? "블로그" : locale === "ja" ? "ブログ" : "Blog";
  const allPostsLabel =
    locale === "ko" ? "전체 글" : locale === "ja" ? "記事一覧" : "All posts";
  const lecturesLabel =
    locale === "ko" ? "강의" : locale === "ja" ? "講座" : "Lectures";
  const legalLabel =
    locale === "ko" ? "법적 고지" : locale === "ja" ? "法的情報" : "Legal";
  const noticeLabel =
    locale === "ko" ? "공지사항" : locale === "ja" ? "お知らせ" : "Notices";

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
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-8 mb-12">
          {/* Brand */}
          <div>
            <h3 className="text-lg font-bold text-white mb-2">Marblo</h3>
            <p className="text-zinc-400 text-sm">{t("description")}</p>
          </div>

          {/* Product */}
          <div>
            <h4 className="text-sm font-semibold text-zinc-300 mb-3">
              {productLabel}
            </h4>
            <ul>
              <li>
                <Link
                  href={localeHref(locale, "/#features")}
                  className="text-zinc-400 hover:text-white text-sm block mb-2"
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
                  href={localeHref(locale, "/pricing")}
                  className="text-zinc-400 hover:text-white text-sm block mb-2"
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
                  href={localeHref(locale, "/download")}
                  className="text-zinc-400 hover:text-white text-sm block mb-2"
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
                  href={localeHref(locale, "/guide")}
                  className="text-zinc-400 hover:text-white text-sm block mb-2"
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
                  href={localeHref(locale, "/bugs")}
                  className="text-zinc-400 hover:text-white text-sm block mb-2"
                >
                  {locale === "ko"
                    ? "버그 신고"
                    : locale === "ja"
                    ? "バグを報告"
                    : "Report a bug"}
                </Link>
              </li>
              <li>
                <a
                  href="https://github.com/marblo-app/marblo"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-400 hover:text-white text-sm block mb-2"
                >
                  {t("github")}
                </a>
              </li>
            </ul>
          </div>

          {/* Blog — 사이트 전역에서 나가는 블로그 링크. 이전에는 푸터에
              블로그 링크가 단 하나도 없었다(2026-08-21 실측). */}
          <div>
            <h4 className="text-sm font-semibold text-zinc-300 mb-3">
              {blogLabel}
            </h4>
            <ul>
              <li>
                <Link
                  href={localeHref(locale, "/blog")}
                  className="text-zinc-400 hover:text-white text-sm block mb-2"
                >
                  {allPostsLabel}
                </Link>
              </li>
              {featured.map((post) => (
                <li key={post.slug}>
                  <Link
                    href={localeHref(locale, `/blog/${post.slug}`)}
                    className="text-zinc-400 hover:text-white text-sm block mb-2"
                  >
                    {featuredLabel(post, locale)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Lectures — 강의는 아직 판매 전(출시 예정)이라 섹션 제목 옆에
              상태를 명시한다. 링크·라우트는 그대로 유지.
              되돌리기: src/data/lectures.ts 상단 "출시 예정 전환" 블록 참조 */}
          <div>
            <h4 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-1.5">
              {lecturesLabel}
              <span className="text-[10px] leading-none font-medium text-zinc-500 border border-zinc-700 rounded-full px-1.5 py-0.5">
                {comingSoonLabel(locale)}
              </span>
            </h4>
            <ul>
              <li>
                <Link
                  href={localeHref(locale, "/lectures")}
                  className="text-zinc-400 hover:text-white text-sm block mb-2"
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
                  href={localeHref(locale, "/lectures/marblo-v3-masterclass")}
                  className="text-zinc-400 hover:text-white text-sm block mb-2"
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
                  href={localeHref(locale, "/notice")}
                  className="text-zinc-400 hover:text-white text-sm block mb-2"
                >
                  {noticeLabel}
                </Link>
              </li>
              <li>
                <Link
                  href={localeHref(locale, "/legal/terms")}
                  className="text-zinc-400 hover:text-white text-sm block mb-2"
                >
                  {t("terms")}
                </Link>
              </li>
              <li>
                <Link
                  href={localeHref(locale, "/legal/privacy")}
                  className="text-zinc-400 hover:text-white text-sm block mb-2"
                >
                  {t("privacy")}
                </Link>
              </li>
              <li>
                <Link
                  href={localeHref(locale, "/legal/refund")}
                  className="text-zinc-400 hover:text-white text-sm block mb-2"
                >
                  {t("refund")}
                </Link>
              </li>
              <li>
                <Link
                  href={localeHref(locale, "/legal/business")}
                  className="text-zinc-400 hover:text-white text-sm block mb-2"
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
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5 text-xs text-zinc-400">
            {businessRows.map(([label, value]) => (
              <div key={label} className="flex gap-2">
                <dt className="text-zinc-400 shrink-0">{label}:</dt>
                <dd className="text-zinc-200">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="border-t border-zinc-800/50 pt-8 text-center">
          <p className="text-zinc-400 text-sm">{t("copyright")}</p>
        </div>
      </div>
    </footer>
  );
}
