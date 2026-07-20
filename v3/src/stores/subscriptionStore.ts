import { create } from "zustand";
import type { Subscription, PlanType } from "../types/subscription";
import { subscribeToDocument, convertTimestamps } from "../services/firestore";
import { planCanUse } from "../lib/planLimits";
import { resolveEntitledPlan } from "../lib/entitlement";

const COLLECTION = "subscriptions";
const DATE_FIELDS = ["currentPeriodStart", "currentPeriodEnd", "createdAt"];

// convertTimestamps 가 Date 로 바꿔주지만, 레거시 문서는 필드가 아예 없거나
// Firestore Timestamp 가 그대로 남아 있을 수 있다. 판정 함수에 넘기기 전에 ms 로
// 정규화하고, 해석 불가한 값은 null(=기간 미상)로 떨어뜨린다.
function toMillis(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const ts = value as { toMillis?: () => number; seconds?: number };
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.seconds === "number") return ts.seconds * 1000;
  return null;
}

function toSubscription(raw: Record<string, unknown>): Subscription {
  return convertTimestamps<Subscription>(raw, DATE_FIELDS);
}

// Feature gating is single-sourced in lib/planLimits.ts (PLAN_FEATURES). This
// store just resolves the current plan and defers the lookup to `planCanUse`,
// so numbers (planLimits) and features stay in one place — no drift.

interface SubscriptionState {
  subscription: Subscription | null;
  loading: boolean;

  fetchSubscription: (userId: string) => Promise<void>;
  subscribeToSubscription: (userId: string) => () => void;
  getPlan: () => PlanType;
  canUse: (feature: string) => boolean;
}

export const useSubscriptionStore = create<SubscriptionState>((set, get) => ({
  subscription: null,
  loading: false,

  fetchSubscription: async (_userId: string) => {
    // Subscription is typically loaded via real-time listener
    set({ loading: true });
    // Will be populated by subscribeToSubscription
    set({ loading: false });
  },

  subscribeToSubscription: (userId: string) => {
    set({ loading: true });
    return subscribeToDocument<Record<string, unknown>>(
      COLLECTION,
      userId,
      (doc) => {
        const subscription = doc ? toSubscription(doc) : null;
        set({ subscription, loading: false });
      },
    );
  },

  getPlan: () => {
    const { subscription } = get();
    // 판정은 lib/entitlement.ts 단일 규칙에 위임한다. status 단독으로 보면
    // 해지 즉시 free 로 떨어져 이미 결제한 잔여 기간이 소멸한다(P0). functions
    // 측 동일 규칙과의 일치는 tests/unit/subscription-entitlement.test.ts 가
    // 강제한다.
    return resolveEntitledPlan(
      {
        status: subscription?.status,
        planType: subscription?.planType,
        currentPeriodEndMs: toMillis(subscription?.currentPeriodEnd),
      },
      Date.now(),
    ) as PlanType;
  },

  canUse: (feature: string) => {
    return planCanUse(get().getPlan(), feature);
  },
}));
