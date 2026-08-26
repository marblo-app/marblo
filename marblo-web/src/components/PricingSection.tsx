"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { Check } from "lucide-react";
import { localeHref } from "@/i18n/routing";
import {
  PRICE_PLANS,
  currencyForLocale,
  formatPlanPrice,
  getPlanAmount,
  type BillingCycle,
  type PricePlan,
} from "@/lib/pricing";

const plans = PRICE_PLANS;

export default function PricingSection() {
  const t = useTranslations("pricing");
  const locale = useLocale();
  const [isAnnual, setIsAnnual] = useState(false);
  const billing: BillingCycle = isAnnual ? "annual" : "monthly";
  const currency = currencyForLocale(locale);

  const getDisplayPrice = (plan: PricePlan) => {
    if (plan === "enterprise") return null;
    return formatPlanPrice(plan, billing, currency) ?? t("pricePending");
  };

  // Team is billed per-seat; Team Plus is a per-team floor (5 seats incl.).
  const isPerSeat = (plan: PricePlan) => plan === "team";

  const getPeriod = (plan: PricePlan) => {
    if (plan === "free")
      return locale === "ko"
        ? "\uC601\uAD6C \uBB34\uB8CC"
        : locale === "ja"
        ? "\u6C38\u4E45\u7121\u6599"
        : "forever free";
    if (plan === "enterprise") return "";
    const seat = isPerSeat(plan);
    if (isAnnual)
      return locale === "ko"
        ? seat
          ? "/\uC778/\uB144"
          : "/\uB144"
        : locale === "ja"
        ? seat
          ? "/\u4EBA/\u5E74"
          : "/\u5E74"
        : seat
        ? "/seat/yr"
        : "/year";
    return locale === "ko"
      ? seat
        ? "/\uC778/\uC6D4"
        : "/\uC6D4"
      : locale === "ja"
      ? seat
        ? "/\u4EBA/\u6708"
        : "/\u6708"
      : seat
      ? "/seat/mo"
      : "/mo";
  };

  return (
    <div>
      {/* Billing Toggle */}
      <div className="flex items-center justify-center gap-4 mb-12">
        <span
          className={`text-sm font-medium ${
            !isAnnual ? "text-white" : "text-zinc-500"
          }`}
        >
          {t("billing.monthly")}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={isAnnual}
          aria-label={t("billing.toggleAria")}
          onClick={() => setIsAnnual(!isAnnual)}
          className={`relative w-14 h-7 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${
            isAnnual ? "bg-indigo-600" : "bg-zinc-700"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow-sm transition-transform ${
              isAnnual ? "translate-x-7" : "translate-x-0"
            }`}
          />
        </button>
        <span
          className={`text-sm font-medium ${
            isAnnual ? "text-white" : "text-zinc-500"
          }`}
        >
          {t("billing.annual")}
        </span>
        {isAnnual && (
          <span className="text-xs bg-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded-full font-medium">
            {t("billing.monthsFree")}
          </span>
        )}
      </div>

      {/* Plan Cards Grid — 3 cols at lg, 5 only at xl to avoid cramping */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-5 max-w-7xl mx-auto">
        {plans.map((plan) => {
          const highlighted = plan === "pro";
          const isEnterprise = plan === "enterprise";
          const features = t.raw(`${plan}.features`) as string[];

          return (
            <div
              key={plan}
              className={`rounded-2xl p-6 flex flex-col relative ${
                highlighted
                  ? "bg-indigo-600/10 border-2 border-indigo-500 ring-1 ring-indigo-500/50"
                  : "bg-zinc-900 border border-zinc-700/50"
              }`}
            >
              {highlighted && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-xs font-semibold px-3 py-1 rounded-full">
                  {t("most_popular")}
                </span>
              )}
              <h3 className="text-xl font-bold text-white">
                {t(`${plan}.name`)}
              </h3>
              <p className="text-zinc-500 text-sm mt-1 mb-4">
                {t(`${plan}.description`)}
              </p>

              {isEnterprise ? (
                <div className="mt-2 mb-6">
                  <span className="text-2xl font-bold text-white">
                    {t(`${plan}.cta`)}
                  </span>
                </div>
              ) : (
                <div className="mt-2 mb-6">
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-bold text-white">
                      {getDisplayPrice(plan)}
                    </span>
                    <span className="text-zinc-400">{getPeriod(plan)}</span>
                  </div>
                  {plan === "team_plus" && (
                    <p className="text-xs text-zinc-500 mt-2">
                      {t("team_plus.note")}
                    </p>
                  )}
                  {plan !== "free" &&
                    getPlanAmount(plan, billing, currency) != null && (
                      <div className="text-xs text-zinc-300 mt-3 rounded-lg border border-zinc-700/70 bg-zinc-800/40 px-3 py-2 leading-relaxed">
                        <p>
                          {isAnnual
                            ? t("autoRenew.annual")
                            : t("autoRenew.monthly")}
                        </p>
                        {/* 토스 계약과정 FAQ §3(무형재화): 서비스 제공기간이 상품
                          설명에서 명확히 확인되어야 한다. 근거는
                          v3/functions/src/billing.ts 의 nextPeriodEnd() =
                          월간 +1개월 / 연간 +12개월, 그리고
                          selectDueForCharge 가 만료 전 선청구를 막으므로
                          사전결제 예약기간은 0 이다. */}
                        <p className="mt-1 text-zinc-400">
                          {isAnnual
                            ? t("servicePeriod.annual")
                            : t("servicePeriod.monthly")}
                        </p>
                        <p className="mt-1 text-zinc-400">
                          {t("serviceDelivery")}
                        </p>
                      </div>
                    )}
                </div>
              )}

              <ul className="space-y-3 flex-1">
                {features.map((feature: string, i: number) => (
                  <li
                    key={i}
                    className="flex items-center gap-3 text-zinc-300 text-sm"
                  >
                    <Check className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>

              <div className="mt-8">
                {isEnterprise ? (
                  <a
                    href="mailto:team@marblo.app"
                    className="block w-full text-center py-3 rounded-lg border border-zinc-600 text-zinc-300 hover:bg-zinc-800 transition font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                  >
                    {t(`${plan}.cta`)}
                  </a>
                ) : plan === "free" ? (
                  <Link
                    href={localeHref(locale, "/download")}
                    className="block w-full text-center py-3 rounded-lg border border-zinc-600 text-zinc-300 hover:bg-zinc-800 transition font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                  >
                    {t("free_cta")}
                  </Link>
                ) : (
                  <Link
                    href={localeHref(
                      locale,
                      `/checkout?plan=${plan}${
                        isAnnual ? "&billing=annual" : ""
                      }`
                    )}
                    className={`block w-full text-center py-3 rounded-lg transition font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${
                      highlighted
                        ? "bg-indigo-600 hover:bg-indigo-500 text-white"
                        : "border border-indigo-500/60 text-indigo-300 hover:bg-indigo-500/10 hover:border-indigo-400"
                    }`}
                  >
                    {t("subscribe")}
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
