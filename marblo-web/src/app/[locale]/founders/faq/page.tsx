"use client";

import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

const QUESTIONS = ["q1", "q2", "q3", "q4", "q5"] as const;

export default function Foundation50FaqPage() {
  const t = useTranslations("foundation50Faq");
  const locale = useLocale();

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-950/40 via-zinc-950 to-zinc-950" />

        <div className="relative max-w-3xl mx-auto px-4 pt-20 pb-10">
          <Link
            href={`/${locale}/founders`}
            className="inline-flex items-center gap-1.5 text-sm text-indigo-300 hover:text-indigo-200 transition mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            {t("back_link")}
          </Link>

          <h1 className="text-3xl md:text-4xl font-bold leading-tight">
            {t("title")}
          </h1>
          <p className="mt-4 text-base text-zinc-300 leading-relaxed">
            {t("subtitle")}
          </p>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 pb-20 space-y-4">
        {QUESTIONS.map((q) => (
          <details
            key={q}
            className="group bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 open:border-indigo-500/40 transition"
          >
            <summary className="cursor-pointer list-none flex items-start justify-between gap-4">
              <h2 className="text-lg md:text-xl font-semibold leading-snug">
                {t(`${q}_title`)}
              </h2>
              <span className="text-zinc-500 group-open:rotate-45 transition-transform select-none text-2xl leading-none mt-0.5">
                +
              </span>
            </summary>
            <p className="mt-4 text-sm text-zinc-300 whitespace-pre-line leading-relaxed">
              {t(`${q}_body`)}
            </p>
          </details>
        ))}
      </section>
    </div>
  );
}
