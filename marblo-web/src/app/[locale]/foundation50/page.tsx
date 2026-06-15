"use client";

import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import {
  Sparkles,
  Rocket,
  Gift,
  Crown,
  FileText,
  MessageCircle,
  Key,
  Calendar,
} from "lucide-react";
import BetaTester50SignupForm from "@/components/BetaTester50SignupForm";

export default function Foundation50Page() {
  const t = useTranslations("foundation50");
  const locale = useLocale();

  const benefits = [
    {
      icon: Rocket,
      titleKey: "benefit1_title",
      bodyKey: "benefit1_body",
    },
    {
      icon: Gift,
      titleKey: "benefit2_title",
      bodyKey: "benefit2_body",
    },
    {
      icon: Crown,
      titleKey: "benefit3_title",
      bodyKey: "benefit3_body",
    },
  ] as const;

  const obligations = [
    {
      icon: FileText,
      titleKey: "ob1_title",
      bodyKey: "ob1_body",
    },
    {
      icon: MessageCircle,
      titleKey: "ob2_title",
      bodyKey: "ob2_body",
    },
  ] as const;

  const byokItems = [
    "byok_item_claude",
    "byok_item_gpt",
    "byok_item_gemini",
    "byok_item_local",
  ] as const;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* ===================== HERO ===================== */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-950/40 via-zinc-950 to-zinc-950" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[450px] bg-indigo-600/10 rounded-full blur-3xl" />

        <div className="relative max-w-4xl mx-auto px-4 pt-24 pb-12 text-center">
          <span className="inline-flex items-center gap-2 bg-indigo-600/15 text-indigo-300 border border-indigo-500/40 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5" />
            {t("badge")}
          </span>
          <h1 className="text-4xl md:text-5xl font-bold mt-6 leading-tight">
            {t("title")}
          </h1>
          <p className="text-lg text-zinc-300 mt-5 whitespace-pre-line leading-relaxed">
            {t("subtitle")}
          </p>
          <p className="text-sm text-zinc-500 mt-4">{t("limit_note")}</p>

          <div className="mt-8 max-w-xl mx-auto text-left">
            <BetaTester50SignupForm source="foundation50_page" />
          </div>
        </div>
      </section>

      {/* ===================== BENEFITS ===================== */}
      <section className="max-w-5xl mx-auto px-4 py-16">
        <h2 className="text-2xl md:text-3xl font-bold text-center mb-10">
          {t("benefits_heading")}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {benefits.map((b) => {
            const Icon = b.icon;
            return (
              <div
                key={b.titleKey}
                className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 hover:border-indigo-500/40 transition"
              >
                <div className="w-11 h-11 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5 text-indigo-300" />
                </div>
                <h3 className="text-lg font-semibold mb-2">{t(b.titleKey)}</h3>
                <p className="text-sm text-zinc-400 whitespace-pre-line leading-relaxed">
                  {t(b.bodyKey)}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ===================== OBLIGATIONS ===================== */}
      <section className="max-w-5xl mx-auto px-4 py-10">
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-8">
          <h2 className="text-xl md:text-2xl font-bold mb-3">
            {t("obligations_heading")}
          </h2>
          <p className="text-sm text-zinc-400 mb-8">{t("obligations_intro")}</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {obligations.map((o) => {
              const Icon = o.icon;
              return (
                <div
                  key={o.titleKey}
                  className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5"
                >
                  <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-3">
                    <Icon className="w-4 h-4 text-amber-300" />
                  </div>
                  <h3 className="text-base font-semibold mb-1.5">
                    {t(o.titleKey)}
                  </h3>
                  <p className="text-xs text-zinc-400 whitespace-pre-line leading-relaxed">
                    {t(o.bodyKey)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ===================== BYOK ===================== */}
      <section className="max-w-5xl mx-auto px-4 py-10">
        <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-2xl p-8">
          <div className="flex items-start gap-3 mb-4">
            <Key className="w-6 h-6 text-indigo-300 flex-shrink-0 mt-1" />
            <h2 className="text-xl md:text-2xl font-bold leading-snug">
              {t("byok_heading")}
            </h2>
          </div>
          <p className="text-sm text-zinc-300 mb-5">{t("byok_intro")}</p>
          <ul className="space-y-2 text-sm text-zinc-200 mb-5 pl-1">
            {byokItems.map((key) => (
              <li key={key} className="leading-relaxed">
                · {t(key)}
              </li>
            ))}
          </ul>
          <p className="text-sm text-zinc-400 whitespace-pre-line leading-relaxed border-t border-zinc-800/60 pt-4">
            {t("byok_outro")}
          </p>
        </div>
      </section>

      {/* ===================== CTA ===================== */}
      <section className="max-w-3xl mx-auto px-4 py-16">
        <div className="bg-gradient-to-br from-indigo-900/40 via-zinc-900 to-zinc-900 border border-indigo-500/30 rounded-2xl p-10 text-center">
          <h2 className="text-2xl md:text-3xl font-bold mb-3">
            {t("cta_heading")}
          </h2>
          <p className="text-zinc-300 mb-7 whitespace-pre-line leading-relaxed">
            {t("cta_body")}
          </p>
          <div className="max-w-xl mx-auto text-left">
            <BetaTester50SignupForm source="foundation50_page" />
          </div>
          <p className="text-xs text-zinc-500 mt-5 leading-relaxed">
            {t("cta_note")}
          </p>
        </div>
      </section>

      {/* ===================== SCHEDULE ===================== */}
      <section className="max-w-3xl mx-auto px-4 py-10">
        <div className="bg-zinc-900/40 border border-zinc-800 rounded-2xl p-7">
          <div className="flex items-center gap-2 mb-5">
            <Calendar className="w-5 h-5 text-zinc-400" />
            <h2 className="text-lg font-semibold">{t("schedule_heading")}</h2>
          </div>
          <ul className="space-y-2 text-sm text-zinc-300">
            <li>· {t("schedule_kr")}</li>
            <li>· {t("schedule_us")}</li>
            <li>· {t("schedule_jp")}</li>
          </ul>
          <p className="text-xs text-zinc-500 mt-5 leading-relaxed">
            {t("schedule_note")}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center mt-8">
          <Link
            href={`/${locale}/foundation50/faq`}
            className="bg-indigo-600/20 border border-indigo-500/50 hover:bg-indigo-600/30 text-indigo-100 px-6 py-3 rounded-lg font-medium transition text-center"
          >
            {t("faq_link")}
          </Link>
          <Link
            href={`/${locale}/pricing`}
            className="border border-zinc-700 hover:bg-zinc-800 text-zinc-200 px-6 py-3 rounded-lg font-medium transition text-center"
          >
            {t("footer_pricing_cta")}
          </Link>
          <Link
            href={`/${locale}/lectures`}
            className="border border-zinc-700 hover:bg-zinc-800 text-zinc-200 px-6 py-3 rounded-lg font-medium transition text-center"
          >
            {t("footer_lectures_cta")}
          </Link>
        </div>
      </section>
    </div>
  );
}
