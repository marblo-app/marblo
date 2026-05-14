import { create } from "zustand";
import type { Subscription, PlanType } from "../types/subscription";
import { subscribeToDocument, convertTimestamps } from "../services/firestore";

const COLLECTION = "subscriptions";
const DATE_FIELDS = ["currentPeriodStart", "currentPeriodEnd", "createdAt"];

function toSubscription(raw: Record<string, unknown>): Subscription {
  return convertTimestamps<Subscription>(raw, DATE_FIELDS);
}

// Feature gates by plan. 마스터플랜 §2.2 SKU 기능 매트릭스 기준.
// 신규 feature 추가 시 5개 tier 전부 명시 (TS Record가 누락 컴파일 에러).
const PLAN_FEATURES: Record<PlanType, Set<string>> = {
  free: new Set(["board", "terminal", "editor"]),
  pro: new Set([
    "board",
    "terminal",
    "editor",
    "agents",
    "flows",
    "missions",
    "unlimited_projects",
  ]),
  team: new Set([
    "board",
    "terminal",
    "editor",
    "agents",
    "flows",
    "missions",
    "unlimited_projects",
    "team_members",
    "priority_support",
  ]),
  team_plus: new Set([
    "board",
    "terminal",
    "editor",
    "agents",
    "flows",
    "missions",
    "unlimited_projects",
    "team_members",
    "priority_support",
    "sso",
    "audit_logs",
    "slack_support",
  ]),
  enterprise: new Set([
    "board",
    "terminal",
    "editor",
    "agents",
    "flows",
    "missions",
    "unlimited_projects",
    "team_members",
    "priority_support",
    "sso",
    "audit_logs",
    "slack_support",
    "saml",
    "on_prem",
    "sla",
    "dedicated_manager",
  ]),
};

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
      }
    );
  },

  getPlan: () => {
    const { subscription } = get();
    if (!subscription || subscription.status !== "active") return "free";
    return subscription.planType;
  },

  canUse: (feature: string) => {
    const plan = get().getPlan();
    return PLAN_FEATURES[plan]?.has(feature) ?? false;
  },
}));
