import { type BillingCycle } from "./billing";

export type PaddlePlanType = "pro" | "team" | "team_plus";
export type PaddlePriceCurrency = "USD" | "JPY";

export interface PaddlePriceEntry {
  planType: PaddlePlanType;
  billingCycle: BillingCycle;
  currency: PaddlePriceCurrency;
  priceId: string;
  envKey: string;
}

export const PADDLE_PLAN_TYPES: readonly PaddlePlanType[] = [
  "pro",
  "team",
  "team_plus",
] as const;

export const PADDLE_PRICE_CURRENCIES: readonly PaddlePriceCurrency[] = [
  "USD",
  "JPY",
] as const;

export function isPaddlePlanType(raw: unknown): raw is PaddlePlanType {
  return raw === "pro" || raw === "team" || raw === "team_plus";
}

export function normalizePaddleCurrency(
  raw: unknown,
): PaddlePriceCurrency | null {
  return raw === "USD" || raw === "JPY" ? raw : null;
}

export function paddlePriceIdEnvKey(
  planType: PaddlePlanType,
  billingCycle: BillingCycle,
  currency: PaddlePriceCurrency,
): string {
  return `PADDLE_PRICE_ID_${planType.toUpperCase()}_${billingCycle.toUpperCase()}_${currency}`;
}

export function buildPaddlePriceCatalog(
  env: Record<string, string | undefined>,
): PaddlePriceEntry[] {
  const entries: PaddlePriceEntry[] = [];
  for (const planType of PADDLE_PLAN_TYPES) {
    for (const billingCycle of ["monthly", "annual"] as const) {
      for (const currency of PADDLE_PRICE_CURRENCIES) {
        const envKey = paddlePriceIdEnvKey(planType, billingCycle, currency);
        const priceId = (env[envKey] || "").trim();
        entries.push({ planType, billingCycle, currency, priceId, envKey });
      }
    }
  }

  const legacy: Array<{
    planType: PaddlePlanType;
    envKey: string;
  }> = [
    { planType: "pro", envKey: "PADDLE_PRO_PRICE_ID" },
    { planType: "team", envKey: "PADDLE_TEAM_PRICE_ID" },
    { planType: "team_plus", envKey: "PADDLE_TEAM_PLUS_PRICE_ID" },
  ];
  for (const item of legacy) {
    const priceId = (env[item.envKey] || "").trim();
    if (!priceId) continue;
    entries.push({
      planType: item.planType,
      billingCycle: "monthly",
      currency: "USD",
      priceId,
      envKey: item.envKey,
    });
  }
  return entries;
}

export function resolvePaddlePriceEntry(
  env: Record<string, string | undefined>,
  input: {
    planType: unknown;
    billingCycle: BillingCycle;
    currency: unknown;
  },
): PaddlePriceEntry | null {
  const currency = normalizePaddleCurrency(input.currency);
  if (!isPaddlePlanType(input.planType) || !currency) return null;
  const entry = buildPaddlePriceCatalog(env).find(
    (candidate) =>
      candidate.planType === input.planType &&
      candidate.billingCycle === input.billingCycle &&
      candidate.currency === currency &&
      candidate.priceId.length > 0,
  );
  return entry ?? null;
}

export function paddlePriceCatalogByPriceId(
  entries: readonly PaddlePriceEntry[],
): Record<string, PaddlePriceEntry> {
  const byPriceId: Record<string, PaddlePriceEntry> = {};
  for (const entry of entries) {
    if (entry.priceId) byPriceId[entry.priceId] = entry;
  }
  return byPriceId;
}
