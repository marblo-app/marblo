"use client";

import { useLocale } from "next-intl";
import Link from "next/link";
import { ArrowLeft, AlertCircle } from "lucide-react";

interface Props {
  title: string;
  lastUpdated: string;
  showDraftNotice?: boolean;
  children: React.ReactNode;
}

export default function LegalPageLayout({
  title,
  lastUpdated,
  showDraftNotice = true,
  children,
}: Props) {
  const locale = useLocale();

  const backLabel =
    locale === "ja" ? "← ホームへ" : locale === "en" ? "← Home" : "← 홈으로";
  const updatedLabel =
    locale === "ja"
      ? "最終更新"
      : locale === "en"
      ? "Last updated"
      : "최종 갱신";
  const localeNotice =
    locale === "ko"
      ? null
      : locale === "ja"
      ? "本ページは韓国の電子商取引法に基づき、韓国語が原本として作成されています。日本語要約版は順次提供予定です。"
      : "This page is authored in Korean as the original under Korean e-commerce law. An English summary will follow.";
  const draftNotice =
    locale === "ja"
      ? "本ページは弁護士検証進行中の標準ドラフトです。GAローンチ前に最終版へ差し替え予定です。"
      : locale === "en"
      ? "This page is a standard draft pending legal review. The final version will be published before GA."
      : "본 페이지는 변호사 검토 진행 중인 표준 초안입니다. GA 출시 전 최종판으로 교체될 예정입니다.";

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <section className="max-w-3xl mx-auto px-4 pt-20 pb-12">
        <Link
          href={`/${locale}`}
          className="inline-flex items-center gap-1.5 text-sm text-indigo-300 hover:text-indigo-200 transition mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          {backLabel.replace(/^← /, "")}
        </Link>

        <h1 className="text-3xl md:text-4xl font-bold leading-tight">
          {title}
        </h1>
        <p className="mt-3 text-sm text-zinc-500">
          {updatedLabel}: {lastUpdated}
        </p>

        {localeNotice && (
          <div className="mt-6 bg-zinc-900/60 border border-zinc-800 rounded-lg px-4 py-3 text-sm text-zinc-400 leading-relaxed">
            {localeNotice}
          </div>
        )}

        {showDraftNotice && (
          <div className="mt-4 bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 flex items-start gap-2 text-sm text-amber-200 leading-relaxed">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-amber-300" />
            <span>{draftNotice}</span>
          </div>
        )}

        <div className="mt-10 legal-doc text-zinc-300 leading-relaxed [&_h2]:text-xl [&_h2]:md:text-2xl [&_h2]:font-semibold [&_h2]:text-white [&_h2]:mt-10 [&_h2]:mb-3 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-zinc-100 [&_h3]:mt-6 [&_h3]:mb-2 [&_p]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-3 [&_ul]:space-y-1.5 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-3 [&_ol]:space-y-1.5 [&_strong]:text-zinc-100 [&_a]:text-indigo-300 [&_a:hover]:text-indigo-200 [&_a]:underline-offset-4 [&_a:hover]:underline">
          {children}
        </div>
      </section>
    </div>
  );
}
