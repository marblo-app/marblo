"use client";

import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { localeHref } from "@/i18n/routing";

export default function LocaleNotFound() {
  const t = useTranslations("notFound");
  const locale = useLocale();

  return (
    <section className="relative flex flex-col items-center justify-center px-4 py-28 text-center overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-indigo-600/5 to-transparent pointer-events-none" />
      <div className="relative max-w-md mx-auto">
        <p
          className="text-7xl md:text-8xl font-bold tracking-tight bg-gradient-to-r from-white to-zinc-500 bg-clip-text text-transparent"
          style={{
            fontFamily:
              'var(--font-space-grotesk, "Space Grotesk", sans-serif)',
          }}
        >
          404
        </p>
        <h1 className="mt-6 text-2xl md:text-3xl font-bold text-white">
          {t("title")}
        </h1>
        <p className="mt-4 text-zinc-400 leading-relaxed">{t("description")}</p>
        <div className="mt-10">
          <Link
            href={localeHref(locale)}
            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-7 py-3.5 rounded-xl text-base font-semibold transition shadow-lg shadow-indigo-600/25"
          >
            <ArrowLeft className="w-4 h-4" />
            {t("home_cta")}
          </Link>
        </div>
      </div>
    </section>
  );
}
