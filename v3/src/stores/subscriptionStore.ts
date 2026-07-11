import { create } from "zustand";
import type { Subscription, PlanType } from "../types/subscription";
import { subscribeToDocument, convertTimestamps } from "../services/firestore";
import { planCanUse } from "../lib/planLimits";

const COLLECTION = "subscriptions";
const DATE_FIELDS = ["currentPeriodStart", "currentPeriodEnd", "createdAt"];

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
    if (!subscription || subscription.status !== "active") return "free";
    return subscription.planType;
  },

  canUse: (feature: string) => {
    return planCanUse(get().getPlan(), feature);
  },
}));
