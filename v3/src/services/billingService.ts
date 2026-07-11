import { httpsCallable } from "firebase/functions";
import { functions } from "../lib/firebase";
import type { PlanType, Subscription } from "../types/subscription";
import {
  subscribeToDocument,
  getDocument,
  convertTimestamps,
} from "./firestore";
import { getPlanLimits } from "../lib/planLimits";
import { t } from "../lib/i18n";

const COLLECTION = "subscriptions";
const DATE_FIELDS = ["currentPeriodStart", "currentPeriodEnd", "createdAt"];

function toSubscription(raw: Record<string, unknown>): Subscription {
  return convertTimestamps<Subscription>(raw, DATE_FIELDS);
}

// ─── Plan Limits ─────────────────────────────────────────────────
// 값 단일소스는 lib/planLimits.ts. 여기서는 재수출만 한다 (drift 방지).
// 프로젝트/에이전트 수 한도와 feature 매트릭스가 전부 그쪽에 있다.
export { getPlanLimits } from "../lib/planLimits";

// ─── Feature Gating ──────────────────────────────────────────────
export function canUseFeature(
  subscription: Subscription | null,
  feature: string,
): boolean {
  const plan = subscription?.planType ?? "free";
  const limits = getPlanLimits(plan);

  switch (feature) {
    case "flowEditor":
      return limits.hasFlowEditor;
    case "teamCollab":
      return limits.hasTeamCollab;
    case "orchestrator":
      return limits.hasOrchestrator;
    case "prioritySupport":
      return limits.hasPrioritySupport;
    default:
      return true;
  }
}

// ─── Plan Pricing (KRW) ─────────────────────────────────────────
// 마스터플랜 §2.1 한국 가격. Pro 정액, Team은 per-seat,
// Team Plus는 팀 플로어(₩290,000 = 5시트 포함, 추가 시트당 ₩59,000).
// Enterprise는 별도 협의 (0 = "Contact Sales" sentinel).
export const PLAN_PRICES_KRW: Record<Exclude<PlanType, "free">, number> = {
  pro: 19000,
  team: 29000,
  team_plus: 290000,
  enterprise: 0,
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
interface PaddleSDK {
  Initialize(options: { token: string; environment: string }): void;
  Checkout: {
    open(options: {
      items: { priceId: string; quantity: number }[];
      customData?: Record<string, unknown>;
      customer?: { email: string };
      settings?: { theme?: string; locale?: string; successUrl?: string };
      success?: () => void;
      closed?: () => void;
    }): void;
  };
}

declare global {
  interface Window {
    Paddle?: PaddleSDK;
  }
}

let paddleLoaded = false;

export function loadPaddleSDK(): Promise<void> {
  if (paddleLoaded || window.Paddle) {
    paddleLoaded = true;
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    script.onload = () => {
      paddleLoaded = true;
      const clientToken = import.meta.env.VITE_PADDLE_CLIENT_TOKEN;
      const environment = import.meta.env.VITE_PADDLE_ENVIRONMENT || "sandbox";
      if (clientToken) {
        window.Paddle!.Initialize({
          token: clientToken,
          environment,
        });
      }
      resolve();
    };
    script.onerror = () => reject(new Error(t("common.payment.sdkLoadFailed")));
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
    window.Paddle!.Checkout.open({
      items: [{ priceId, quantity: 1 }],
      customData: { userId },
      customer: email ? { email } : undefined,
      settings: {
        theme: "dark",
        locale: "ko",
        successUrl: `${window.location.origin}/settings/billing?paddle_success=true`,
      },
      success: () => resolve(),
      closed: () => reject(new Error(t("common.payment.checkoutCanceled"))),
    });
  });
}

export async function cancelPaddleSubscription(userId: string): Promise<void> {
  const fn = httpsCallable<{ userId: string }, { success: boolean }>(
    functions,
    "cancelPaddleSubscription",
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
  >(functions, "createTossCheckout");

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
  >(functions, "confirmTossPayment");

  await fn({ orderId, paymentKey, amount });
}
