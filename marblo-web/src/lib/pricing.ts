export const PRICE_PLANS = [
  "free",
  "pro",
  "team",
  "team_plus",
  "enterprise",
] as const;

export type PricePlan = typeof PRICE_PLANS[number];
export type BillingCycle = "monthly" | "annual";
export type PriceCurrency = "KRW" | "USD" | "JPY";

type PriceAmount = number | null;
type PriceMatrix = Record<
  PricePlan,
  Record<BillingCycle, Record<PriceCurrency, PriceAmount>>
>;

export const PRICE_CURRENCIES: readonly PriceCurrency[] = ["KRW", "USD", "JPY"];

export const PRICE_MATRIX: PriceMatrix = {
  free: {
    monthly: { KRW: 0, USD: 0, JPY: 0 },
    annual: { KRW: 0, USD: 0, JPY: 0 },
  },
  pro: {
    monthly: { KRW: 19_000, USD: 19, JPY: 2_900 },
    annual: { KRW: 190_000, USD: 190, JPY: null },
  },
  team: {
    monthly: { KRW: 29_000, USD: 25, JPY: null },
    annual: { KRW: 290_000, USD: 250, JPY: null },
  },
  team_plus: {
    monthly: { KRW: 290_000, USD: 245, JPY: null },
    annual: { KRW: 2_900_000, USD: 2_450, JPY: null },
  },
  enterprise: {
    monthly: { KRW: 0, USD: 0, JPY: null },
    annual: { KRW: 0, USD: 0, JPY: null },
  },
};

export function currencyForLocale(locale: string): PriceCurrency {
  if (locale === "ko") return "KRW";
  if (locale === "ja") return "JPY";
  return "USD";
}

export function getPlanAmount(
  plan: PricePlan,
  billing: BillingCycle,
  currency: PriceCurrency
): PriceAmount {
  return PRICE_MATRIX[plan][billing][currency];
}

export function getMonthlyPlanAmount(
  plan: PricePlan,
  currency: PriceCurrency
): PriceAmount {
  return getPlanAmount(plan, "monthly", currency);
}

export function formatCurrencyAmount(
  amount: number,
  currency: PriceCurrency
): string {
  const locale =
    currency === "KRW" ? "ko-KR" : currency === "JPY" ? "ja-JP" : "en-US";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatPlanPrice(
  plan: PricePlan,
  billing: BillingCycle,
  currency: PriceCurrency
): string | null {
  const amount = getPlanAmount(plan, billing, currency);
  return amount == null ? null : formatCurrencyAmount(amount, currency);
}

export function getSchemaOfferPrice(
  plan: PricePlan,
  locale: string
): { price: string; priceCurrency: PriceCurrency } | null {
  const priceCurrency = currencyForLocale(locale);
  const amount = getMonthlyPlanAmount(plan, priceCurrency);
  if (amount == null) return null;
  return { price: String(amount), priceCurrency };
}
