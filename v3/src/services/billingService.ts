import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import type { PlanType, PlanLimits, Subscription } from '../types/subscription';
import { subscribeToDocument, getDocument, convertTimestamps } from './firestore';

const COLLECTION = 'subscriptions';
const DATE_FIELDS = ['currentPeriodStart', 'currentPeriodEnd', 'createdAt'];

function toSubscription(raw: Record<string, unknown>): Subscription {
  return convertTimestamps<Subscription>(raw, DATE_FIELDS);
}

// ─── Plan Limits ─────────────────────────────────────────────────
const PLAN_LIMITS: Record<PlanType, PlanLimits> = {
  free: {
    maxProjects: 1,
    maxAgents: 2,
    hasFlowEditor: false,
    hasTeamCollab: false,
    hasOrchestrator: false,
    hasPrioritySupport: false,
  },
  pro: {
    maxProjects: 5,
    maxAgents: 5,
    hasFlowEditor: true,
    hasTeamCollab: false,
    hasOrchestrator: true,
    hasPrioritySupport: false,
  },
  team: {
    maxProjects: Infinity,
    maxAgents: Infinity,
    hasFlowEditor: true,
    hasTeamCollab: true,
    hasOrchestrator: true,
    hasPrioritySupport: true,
  },
};

export function getPlanLimits(planType: PlanType): PlanLimits {
  return PLAN_LIMITS[planType];
}

// ─── Feature Gating ──────────────────────────────────────────────
export function canUseFeature(
  subscription: Subscription | null,
  feature: string,
): boolean {
  const plan = subscription?.planType ?? 'free';
  const limits = PLAN_LIMITS[plan];

  switch (feature) {
    case 'flowEditor':
      return limits.hasFlowEditor;
    case 'teamCollab':
      return limits.hasTeamCollab;
    case 'orchestrator':
      return limits.hasOrchestrator;
    case 'prioritySupport':
      return limits.hasPrioritySupport;
    default:
      return true;
  }
}

// ─── Plan Pricing (KRW) ─────────────────────────────────────────
export const PLAN_PRICES_KRW: Record<Exclude<PlanType, 'free'>, number> = {
  pro: 19000,
  team: 49000,
};

// ─── Subscription CRUD ───────────────────────────────────────────
export async function getSubscription(
  userId: string,
): Promise<Subscription | null> {
  const raw = await getDocument<Record<string, unknown>>(COLLECTION, userId);
  return raw ? toSubscription(raw) : null;
}

export function subscribeToSubscription(
  userId: string,
  callback: (sub: Subscription | null) => void,
): () => void {
  return subscribeToDocument<Record<string, unknown>>(
    COLLECTION,
    userId,
    (raw) => {
      callback(raw ? toSubscription(raw) : null);
    },
  );
}

// ─── Paddle (해외 결제) ──────────────────────────────────────────
let paddleLoaded = false;

export function loadPaddleSDK(): Promise<void> {
  if (paddleLoaded || (window as any).Paddle) {
    paddleLoaded = true;
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.paddle.com/paddle/v2/paddle.js';
    script.onload = () => {
      paddleLoaded = true;
      const clientToken = import.meta.env.VITE_PADDLE_CLIENT_TOKEN;
      const environment = import.meta.env.VITE_PADDLE_ENVIRONMENT || 'sandbox';
      if (clientToken) {
        (window as any).Paddle.Initialize({
          token: clientToken,
          environment,
        });
      }
      resolve();
    };
    script.onerror = () => reject(new Error('Paddle SDK 로드 실패'));
    document.head.appendChild(script);
  });
}

export async function openPaddleCheckout(
  userId: string,
  priceId: string,
  email?: string,
): Promise<void> {
  await loadPaddleSDK();

  return new Promise((resolve, reject) => {
    (window as any).Paddle.Checkout.open({
      items: [{ priceId, quantity: 1 }],
      customData: { userId },
      customer: email ? { email } : undefined,
      settings: {
        theme: 'dark',
        locale: 'ko',
        successUrl: `${window.location.origin}/settings/billing?paddle_success=true`,
      },
      success: () => resolve(),
      closed: () => reject(new Error('결제 취소')),
    });
  });
}

export async function cancelPaddleSubscription(userId: string): Promise<void> {
  const fn = httpsCallable<{ userId: string }, { success: boolean }>(
    functions,
    'cancelPaddleSubscription',
  );
  await fn({ userId });
}

// ─── TossPayments (국내 결제) ────────────────────────────────────
export async function createTossCheckout(
  userId: string,
  planType: PlanType,
): Promise<{ paymentKey: string; orderId: string; amount: number }> {
  const fn = httpsCallable<
    { userId: string; planType: PlanType },
    { paymentKey: string; orderId: string; amount: number }
  >(functions, 'createTossCheckout');

  const result = await fn({ userId, planType });
  return result.data;
}

export async function confirmTossPayment(
  orderId: string,
  paymentKey: string,
  amount: number,
): Promise<void> {
  const fn = httpsCallable<
    { orderId: string; paymentKey: string; amount: number },
    { success: boolean }
  >(functions, 'confirmTossPayment');

  await fn({ orderId, paymentKey, amount });
}
