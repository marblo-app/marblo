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

/** provider 무관 단일 해지 진입점 (toss/portone/paddle). 환불 없음·기간말 entitlement 유지. */
export async function cancelSubscription(): Promise<{
  success: boolean;
  alreadyCanceled?: boolean;
  provider?: string | null;
  accessUntil?: string | null;
}> {
  const fn = httpsCallable<
    Record<string, never>,
    {
      success: boolean;
      alreadyCanceled?: boolean;
      provider?: string | null;
      accessUntil?: string | null;
    }
  >(functions, "cancelSubscription");
  const result = await fn({});
  return result.data;
}

// ─── TossPayments (국내 결제) — ★신규 진입 차단(1단계) ──────────────
// 토스페이먼츠 PG 직결은 신규 결제를 받지 않는다. 국내 신규 결제는 포트원으로
// 일원화됐다(marblo-web /checkout). 아래 두 함수는 호출되면 서버에서
// failed-precondition(toss_entry_disabled) 로 거절되므로, 왕복하지 않고
// 클라이언트에서 먼저 끊는다 — 사용자가 결제창을 띄운 뒤에 실패하는 것보다
// 누르기 전에 막히는 편이 낫다.
//
// ★함수 시그니처는 남긴다. 호출부(BillingPage)를 아직 정리하지 않았고, 지우면
// 빌드가 깨져 "가리기 먼저" 라는 이 티켓의 방침과 어긋난다.
// 되돌리려면 서버 TOSS_ENTRY_ENABLED="true" + 아래 상수를 false 로.
export const TOSS_ENTRY_DISABLED: boolean = true;
export const TOSS_ENTRY_DISABLED_CODE = "toss_entry_disabled";

/** 신규 토스 결제 진입이 막혀 있으면 던진다. 호출 전에 부르는 가드. */
function assertTossEntryEnabled(): void {
  if (!TOSS_ENTRY_DISABLED) return;
  const err = new Error(
    "토스페이먼츠 결제는 더 이상 신규 접수하지 않습니다. 포트원으로 결제해 주세요.",
  );
  err.name = TOSS_ENTRY_DISABLED_CODE;
  throw err;
}

/**
 * 결제수단 목록에서 토스 진입을 걸러낸다. 화면단이 이 함수를 통과시킨
 * 목록만 그리면, 차단 정책이 컴포넌트가 아니라 여기 한 곳에 남는다.
 */
export function filterAvailablePaymentMethods<T extends { provider: string }>(
  methods: readonly T[],
): T[] {
  if (!TOSS_ENTRY_DISABLED) return [...methods];
  return methods.filter((m) => m.provider !== "toss");
}

export async function createTossCheckout(
  userId: string,
  planType: PlanType,
): Promise<{ paymentKey: string; orderId: string; amount: number }> {
  assertTossEntryEnabled();

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
  assertTossEntryEnabled();

  const fn = httpsCallable<
    { orderId: string; paymentKey: string; amount: number },
    { success: boolean }
  >(functions, "confirmTossPayment");

  await fn({ orderId, paymentKey, amount });
}
