"use client";

import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import BetaTester50SignupForm from "./BetaTester50SignupForm";

export default function BetaTester50Section() {
  const t = useTranslations("betatester50");
  const locale = useLocale();

  return (
    <section className="px-4 pt-4 pb-12 md:pb-16">
      <div className="max-w-4xl mx-auto">
        <div className="relative overflow-hidden rounded-2xl border border-indigo-500/25 bg-zinc-900/80 p-8 md:p-12 shadow-2xl shadow-black/20">
          <div className="relative">
            <div className="flex flex-wrap items-center gap-3 mb-6">
              <span className="inline-flex items-center gap-2 bg-indigo-500/20 text-indigo-200 border border-indigo-400/40 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider">
                <Sparkles className="w-3.5 h-3.5" />
                {t("badge")}
              </span>
            </div>

            <h2 className="text-3xl md:text-5xl font-bold leading-tight tracking-tight">
              {t("title")}
            </h2>
            <p className="mt-4 text-lg md:text-xl text-zinc-300 leading-relaxed max-w-2xl">
              {t("subtitle")}
            </p>

            <div className="mt-8">
              <BetaTester50SignupForm source="home" />
            </div>

            <div className="mt-8 pt-6 border-t border-zinc-800/80 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <p className="text-sm font-semibold text-indigo-200 mb-3">
                  {t("receive_heading")}
                </p>
                <ul className="space-y-2 text-sm text-zinc-200 leading-relaxed">
                  <li>{t("receive_item1")}</li>
                  <li>{t("receive_item2")}</li>
                  <li>{t("receive_item3")}</li>
                  <li>{t("receive_item4")}</li>
                </ul>
              </div>
              <div>
                <p className="text-sm font-semibold text-indigo-200 mb-3">
                  {t("role_heading")}
                </p>
                <ul className="space-y-2 text-sm text-zinc-200 leading-relaxed">
                  <li>{t("role_required")}</li>
                  <li className="text-amber-200/90">{t("role_optional")}</li>
                </ul>
              </div>
            </div>

            <p className="mt-6 text-xs text-zinc-500 leading-relaxed">
              {t("byok_note")}
            </p>

            <Link
              href={`/${locale}/founders`}
              className="inline-flex items-center gap-1 mt-4 text-sm text-indigo-300 hover:text-indigo-200 transition"
            >
              {t("details_link")}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
