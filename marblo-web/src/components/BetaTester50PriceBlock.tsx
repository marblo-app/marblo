"use client";

import { useTranslations } from "next-intl";

interface Props {
  align?: "left" | "center";
}

export default function BetaTester50PriceBlock({ align = "left" }: Props) {
  const t = useTranslations("betatester50");
  const wrapperAlign =
    align === "center" ? "mx-auto items-center text-center" : "items-start";
  const rowAlign = align === "center" ? "justify-center" : "justify-start";

  return (
    <div
      className={`inline-flex flex-col gap-2 rounded-2xl border border-zinc-700/70 bg-zinc-950/60 px-5 py-4 ${wrapperAlign}`}
    >
      <div
        className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 ${rowAlign}`}
      >
        <span className="text-xs text-zinc-500 uppercase tracking-wider">
          {t("price_original_label")}
        </span>
        <span className="text-base text-zinc-500 line-through">
          {t("price_original")}
        </span>
        <span className="text-3xl md:text-4xl font-bold text-white">
          {t("price_discount")}
        </span>
        <span className="inline-flex items-center bg-indigo-500/20 text-indigo-200 border border-indigo-400/40 px-2.5 py-0.5 rounded-md text-xs font-semibold">
          {t("price_discount_badge")}
        </span>
      </div>
      <p className="text-sm text-emerald-300/90 font-medium">
        {t("price_bonus")}
      </p>
      <p className="text-xs text-zinc-500 leading-relaxed">
        {t("price_tier_compare")}
      </p>
    </div>
  );
}
