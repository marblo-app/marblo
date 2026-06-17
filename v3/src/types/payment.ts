/**
 * Payment System Type Definitions
 * Marblo Payment API와 연동하기 위한 TypeScript 타입 정의
 */

// Payment Status Enum
export enum PaymentStatus {
  PENDING = "pending",
  READY = "ready",
  IN_PROGRESS = "in_progress",
  DONE = "done",
  CANCELED = "canceled",
  PARTIAL_CANCELED = "partial_canceled",
  ABORTED = "aborted",
  EXPIRED = "expired",
}

// Payment Method Enum
export enum PaymentMethod {
  CARD = "카드",
  VIRTUAL_ACCOUNT = "가상계좌",
  TRANSFER = "계좌이체",
  MOBILE_PHONE = "휴대폰",
  GIFT_CERTIFICATE = "상품권",
  EASY_PAY = "간편결제",
}

// Subscription Status Enum
export enum SubscriptionStatus {
  ACTIVE = "active",
  CANCELED = "canceled",
  EXPIRED = "expired",
  PENDING = "pending",
  TRIALING = "trialing",
  PAST_DUE = "past_due",
}

// Subscription Plan Enum — 마스터플랜 §2 가격표 기준. BASIC enum은
// 폐기되었고(베이직 플랜 없음), Team / Team Plus가 신규 SKU.
export enum SubscriptionPlan {
  FREE = "free",
  PRO = "pro",
  TEAM = "team",
  TEAM_PLUS = "team_plus",
  ENTERPRISE = "enterprise",
}

// Payment Request Interface
export interface PaymentRequestData {
  amount: number;
  order_name: string;
  customer_email: string;
  customer_name: string;
  success_url: string;
  fail_url: string;
  payment_method?: "TOSS" | "NAVERPAY";
}

// Payment Response Interface
export interface PaymentResponse {
  id: number;
  payment_key: string | null;
  order_id: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  method: PaymentMethod | null;
  requested_at: string;
  approved_at: string | null;
  canceled_at: string | null;
  cancel_amount: number;
  cancel_reason: string | null;
  receipt_url: string | null;
  checkout_url: string | null;
  failure_message: string | null;
  created_at: string;
}

// Payment Confirmation Interface
export interface PaymentConfirmData {
  payment_key: string;
  order_id: string;
  amount: number;
}

// Payment Cancellation Interface
export interface PaymentCancelData {
  payment_key: string;
  cancel_reason: string;
  cancel_amount?: number;
}

// Billing Key Registration Interface
export interface BillingKeyRequest {
  payment_method: "TOSS" | "NAVERPAY";
  card_number?: string;
  card_expiry_year?: string;
  card_expiry_month?: string;
  card_password?: string;
  birth_or_business_number?: string;
  return_url?: string;
}

// Billing Key Response Interface
export interface BillingKeyResponse {
  billing_key?: string;
  customer_key: string;
  redirect_url?: string;
}

// Subscription Creation Interface
export interface SubscriptionCreateData {
  plan: SubscriptionPlan;
  billing_cycle: "monthly" | "yearly";
  trial_days?: number;
}

// Subscription Response Interface
export interface SubscriptionResponse {
  id: number;
  subscription_id: string;
  user_id: number;
  customer_key: string;
  billing_key: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  amount: number;
  billing_cycle: string;
  trial_end_date: string | null;
  current_period_start: string;
  current_period_end: string;
  next_billing_date: string | null;
  canceled_at: string | null;
  cancel_reason: string | null;
  failure_count: number;
  created_at: string;
}

// Subscription Update Interface
export interface SubscriptionUpdateData {
  plan?: SubscriptionPlan;
  billing_cycle?: "monthly" | "yearly";
}

// Subscription Cancellation Interface
export interface SubscriptionCancelData {
  cancel_reason: string;
  immediate: boolean;
}

// Billing History Interface
export interface BillingHistoryResponse {
  id: number;
  subscription_id: number;
  payment_id: number | null;
  amount: number;
  status: string;
  billing_date: string;
  paid_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
  retry_count: number;
  created_at: string;
}

// Payment Statistics Interface
export interface PaymentStatistics {
  total_revenue: number;
  total_transactions: number;
  successful_payments: number;
  failed_payments: number;
  refunded_amount: number;
  average_transaction_value: number;
  period_start: string;
  period_end: string;
}

// Subscription Statistics Interface
export interface SubscriptionStatistics {
  total_subscribers: number;
  active_subscriptions: number;
  canceled_subscriptions: number;
  trial_users: number;
  monthly_recurring_revenue: number;
  annual_recurring_revenue: number;
  churn_rate: number;
  average_revenue_per_user: number;
}

// Error Response Interface
export interface ErrorResponse {
  detail: string;
  type?: string;
  code?: string;
}

// API Response Wrapper
export interface ApiResponse<T> {
  data?: T;
  error?: ErrorResponse;
  status: number;
}

// Webhook Event Interface
export interface WebhookEvent {
  id: string;
  eventType: string;
  timestamp: string;
  data: Record<string, unknown>;
}

// Plan Features Interface
export interface PlanFeatures {
  name: string;
  price_monthly: number;
  price_yearly: number;
  features: string[];
  recommended?: boolean;
}

// Payment Plan Configuration
// Source of truth: docs/v3.1_런칭_마스터플랜.md §2.1 가격표.
// marblo-web/src/components/PricingSection.tsx + checkout/page.tsx
// PLAN_PRICES와 정확히 일치해야 함 — drift 시 결제 페이지 ↔ 데스크탑 앱
// gating이 어긋남.
//
// 연간 결제는 월 × 10 (2개월 무료). marblo-web의 동일 공식과 일치.
export const PAYMENT_PLANS: Record<SubscriptionPlan, PlanFeatures> = {
  [SubscriptionPlan.FREE]: {
    name: "Free",
    price_monthly: 0,
    price_yearly: 0,
    features: [
      "프로젝트 1개",
      "에이전트 2개",
      "칸반 보드",
      "터미널 + 코드 에디터",
      "MCP 연동",
    ],
  },
  [SubscriptionPlan.PRO]: {
    name: "Pro",
    price_monthly: 19000,
    price_yearly: 19000 * 10, // 190,000원 (2개월 무료)
    features: [
      "무제한 프로젝트",
      "무제한 에이전트 (BYOK · API 비용 사용자 부담)",
      "Mission 에디터 (구 Flow)",
      "Mission Launch (자연어 기반)",
      "우선 기술 지원",
      "모든 Free 기능 포함",
    ],
    recommended: true,
  },
  [SubscriptionPlan.TEAM]: {
    name: "Team",
    price_monthly: 29000, // per seat
    price_yearly: 29000 * 10, // 290,000원 per seat (2개월 무료)
    features: [
      "팀 공유 워크스페이스",
      "실시간 협업",
      "역할 기반 권한",
      "팀 분석 대시보드",
      "팀 채팅 (예정)",
      "모든 Pro 기능 포함",
    ],
  },
  [SubscriptionPlan.TEAM_PLUS]: {
    name: "Team Plus",
    price_monthly: 290000, // per-team floor (5 seats incl., +₩59,000/seat)
    price_yearly: 290000 * 10, // 2,900,000원 per team (2개월 무료)
    features: [
      "SSO (Auth0/Clerk)",
      "감사 로그 노출",
      "우선 지원 (Slack 채널)",
      "분기 ROI 미팅",
      "신규 기능 얼리 액세스",
      "모든 Team 기능 포함",
    ],
  },
  [SubscriptionPlan.ENTERPRISE]: {
    name: "Enterprise",
    price_monthly: 0, // Contact sales — price negotiated
    price_yearly: 0,
    features: [
      "온프레미스 배포 옵션",
      "SAML 인증",
      "SLA 99.9%",
      "SOC2 Type 1 (Year 2)",
      "전담 매니저",
      "모든 Team Plus 기능 포함",
    ],
  },
};

// Utility Types
export type PaymentMethodType = "TOSS" | "NAVERPAY";
export type BillingCycle = "monthly" | "yearly";
export type PaymentListParams = {
  skip?: number;
  limit?: number;
  status?: PaymentStatus;
  start_date?: string;
  end_date?: string;
};
export type SubscriptionListParams = {
  skip?: number;
  limit?: number;
  status?: SubscriptionStatus;
  plan?: SubscriptionPlan;
};
