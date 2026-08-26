import {
  type BillingCycle,
  type PriceCurrency,
  type PricePlan,
} from "./pricing";

export type PaddleCheckoutPlan = Extract<
  PricePlan,
  "pro" | "team" | "team_plus"
>;

export type PaddleCheckoutCurrency = Extract<PriceCurrency, "USD" | "JPY">;

export const PADDLE_CHECKOUT_PLANS: readonly PaddleCheckoutPlan[] = [
  "pro",
  "team",
  "team_plus",
] as const;

export const PADDLE_CHECKOUT_CURRENCIES: readonly PaddleCheckoutCurrency[] = [
  "USD",
  "JPY",
] as const;

export interface PaddlePriceIds {
  pro: Record<BillingCycle, Record<PaddleCheckoutCurrency, string>>;
  team: Record<BillingCycle, Record<PaddleCheckoutCurrency, string>>;
  team_plus: Record<BillingCycle, Record<PaddleCheckoutCurrency, string>>;
}

export interface PaddleCheckoutPrice {
  priceId: string;
  envKey: string;
}

export const PUBLIC_PADDLE_PRICE_IDS: PaddlePriceIds = {
  pro: {
    monthly: {
      USD: process.env.NEXT_PUBLIC_PADDLE_PRICE_ID_PRO_MONTHLY_USD || "",
      JPY: process.env.NEXT_PUBLIC_PADDLE_PRICE_ID_PRO_MONTHLY_JPY || "",
    },
    annual: {
      USD: process.env.NEXT_PUBLIC_PADDLE_PRICE_ID_PRO_ANNUAL_USD || "",
      JPY: process.env.NEXT_PUBLIC_PADDLE_PRICE_ID_PRO_ANNUAL_JPY || "",
    },
  },
  team: {
    monthly: {
      USD: process.env.NEXT_PUBLIC_PADDLE_PRICE_ID_TEAM_MONTHLY_USD || "",
      JPY: process.env.NEXT_PUBLIC_PADDLE_PRICE_ID_TEAM_MONTHLY_JPY || "",
    },
    annual: {
      USD: process.env.NEXT_PUBLIC_PADDLE_PRICE_ID_TEAM_ANNUAL_USD || "",
      JPY: process.env.NEXT_PUBLIC_PADDLE_PRICE_ID_TEAM_ANNUAL_JPY || "",
    },
  },
  team_plus: {
    monthly: {
      USD: process.env.NEXT_PUBLIC_PADDLE_PRICE_ID_TEAM_PLUS_MONTHLY_USD || "",
      JPY: process.env.NEXT_PUBLIC_PADDLE_PRICE_ID_TEAM_PLUS_MONTHLY_JPY || "",
    },
    annual: {
      USD: process.env.NEXT_PUBLIC_PADDLE_PRICE_ID_TEAM_PLUS_ANNUAL_USD || "",
      JPY: process.env.NEXT_PUBLIC_PADDLE_PRICE_ID_TEAM_PLUS_ANNUAL_JPY || "",
    },
  },
};

export function isPaddleCheckoutCurrency(
  currency: PriceCurrency,
): currency is PaddleCheckoutCurrency {
  return currency === "USD" || currency === "JPY";
}

export function isPaddleCheckoutPlan(
  plan: string | null | undefined,
): plan is PaddleCheckoutPlan {
  return plan === "pro" || plan === "team" || plan === "team_plus";
}

export function paddlePriceIdEnvKey(
  plan: PaddleCheckoutPlan,
  billing: BillingCycle,
  currency: PaddleCheckoutCurrency,
  prefix = "NEXT_PUBLIC_",
): string {
  return `${prefix}PADDLE_PRICE_ID_${plan.toUpperCase()}_${billing.toUpperCase()}_${currency}`;
}

export function resolvePaddleCheckoutPrice(input: {
  plan: string | null | undefined;
  billing: BillingCycle;
  currency: PriceCurrency;
  priceIds?: PaddlePriceIds;
}): PaddleCheckoutPrice | null {
  const { plan, billing, currency, priceIds = PUBLIC_PADDLE_PRICE_IDS } = input;
  if (!isPaddleCheckoutPlan(plan) || !isPaddleCheckoutCurrency(currency)) {
    return null;
  }
  const priceId = priceIds[plan][billing][currency].trim();
  if (!priceId) return null;
  return {
    priceId,
    envKey: paddlePriceIdEnvKey(plan, billing, currency),
  };
}
