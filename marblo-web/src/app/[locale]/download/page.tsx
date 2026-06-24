"use client";

import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { Apple, Monitor, Sparkles, Download } from "lucide-react";

// 버전 고정 다운로드 링크 — 새 빌드 릴리스 시 이 두 값만 갱신.
const APP_VERSION = "v3.0.0";
const MAC_DMG_URL =
  "https://github.com/melocream/marblo-releases/releases/download/v3.0.0/Marblo-3.0.0-arm64.dmg";

export default function DownloadPage() {
  const t = useTranslations("download");
  const locale = useLocale();

  return (
    <div className="py-24 px-4">
      <div className="max-w-3xl mx-auto text-center">
        <span className="inline-flex items-center gap-2 bg-indigo-600/15 text-indigo-300 border border-indigo-500/40 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider">
          <Sparkles className="w-3.5 h-3.5" />
          {t("badge")}
        </span>
        <h1 className="text-4xl md:text-5xl font-bold mt-6 whitespace-pre-line">
          {t("title")}
        </h1>
        <p className="text-zinc-400 mt-4 whitespace-pre-line leading-relaxed">
          {t("subtitle")}
        </p>

        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* macOS — 다운로드 가능 */}
          <a
            href={MAC_DMG_URL}
            className="group flex flex-col items-center justify-center gap-3 p-6 rounded-xl border border-indigo-500/50 bg-indigo-600/10 hover:bg-indigo-600/20 hover:border-indigo-400 transition"
          >
            <Apple className="w-7 h-7 text-zinc-200" />
            <span className="text-sm font-medium text-zinc-100">
              {t("macos")}
            </span>
            <span className="text-xs text-zinc-400">
              {t("mac_sub")} · {APP_VERSION}
            </span>
            <span className="mt-1 inline-flex items-center gap-2 bg-indigo-600 group-hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition">
              <Download className="w-4 h-4" />
              {t("download_now")}
            </span>
          </a>

          {/* Windows — 준비 중 */}
          <div className="flex flex-col items-center justify-center gap-3 p-6 rounded-xl border border-zinc-800 bg-zinc-900/50 opacity-60">
            <Monitor className="w-7 h-7 text-zinc-400" />
            <span className="text-sm font-medium text-zinc-300">
              {t("windows")}
            </span>
            <span className="text-xs text-zinc-500">{t("preparing")}</span>
          </div>
        </div>

        <div className="mt-12 p-8 rounded-2xl border border-zinc-800 bg-zinc-900/40">
          <h2 className="text-xl font-semibold">{t("notify_title")}</h2>
          <p className="text-zinc-400 text-sm mt-2 mb-6">
            {t("notify_subtitle")}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href={`/${locale}/auth/signup`}
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-lg font-medium transition"
            >
              {t("notify_cta")}
            </Link>
            <Link
              href={`/${locale}/pricing`}
              className="border border-zinc-700 hover:bg-zinc-800 text-zinc-200 px-6 py-3 rounded-lg font-medium transition"
            >
              {t("pricing_cta")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
