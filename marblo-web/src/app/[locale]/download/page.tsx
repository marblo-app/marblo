"use client";

import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { Apple, Monitor, TerminalIcon, Sparkles } from "lucide-react";

export default function DownloadPage() {
  const t = useTranslations("download");
  const locale = useLocale();

  const platforms = [
    { id: "mac", label: t("macos"), icon: Apple },
    { id: "windows", label: t("windows"), icon: Monitor },
    { id: "linux", label: t("linux"), icon: TerminalIcon },
  ];

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

        <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {platforms.map((p) => (
            <div
              key={p.id}
              className="flex flex-col items-center justify-center gap-3 p-6 rounded-xl border border-zinc-800 bg-zinc-900/50 opacity-60"
            >
              <p.icon className="w-7 h-7 text-zinc-400" />
              <span className="text-sm font-medium text-zinc-300">
                {p.label}
              </span>
              <span className="text-xs text-zinc-500">{t("badge")}</span>
            </div>
          ))}
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
