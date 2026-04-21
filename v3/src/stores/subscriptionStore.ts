import { create } from 'zustand';
import type { Subscription, PlanType } from '../types/subscription';
import { subscribeToDocument, convertTimestamps } from '../services/firestore';

const COLLECTION = 'subscriptions';
const DATE_FIELDS = ['currentPeriodStart', 'currentPeriodEnd', 'createdAt'];

function toSubscription(raw: Record<string, unknown>): Subscription {
  return convertTimestamps<Subscription>(raw, DATE_FIELDS);
}

// Feature gates by plan
const PLAN_FEATURES: Record<PlanType, Set<string>> = {
  free: new Set(['board', 'terminal', 'editor']),
  pro: new Set(['board', 'terminal', 'editor', 'agents', 'flows', 'unlimited_projects']),
  team: new Set(['board', 'terminal', 'editor', 'agents', 'flows', 'unlimited_projects', 'team_members', 'priority_support']),
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
      },
    );
  },

  getPlan: () => {
    const { subscription } = get();
    if (!subscription || subscription.status !== 'active') return 'free';
    return subscription.planType;
  },

  canUse: (feature: string) => {
    const plan = get().getPlan();
    return PLAN_FEATURES[plan]?.has(feature) ?? false;
  },
}));
