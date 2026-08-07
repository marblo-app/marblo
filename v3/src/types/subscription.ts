// 마스터플랜 §2.1 5-tier SKU. marblo-web/messages/{ko,en,ja}.json의
// pricing 키와 정확히 일치. drift 발생 시 결제 페이지 ↔ 데스크탑 앱
// 권한 게이팅이 어긋남.
export type PlanType = "free" | "pro" | "team" | "team_plus" | "enterprise";
export type SubscriptionStatus =
  | "active"
  | "canceled"
  | "past_due"
  | "trialing";
export type PaymentProvider = "paddle" | "toss" | "portone";

export interface Subscription {
  id: string;
  userId: string;
  planType: PlanType;
  status: SubscriptionStatus;
  paymentProvider: PaymentProvider;
  // Paddle
  paddleCustomerId?: string;
  paddleSubscriptionId?: string;
  // TossPayments
  tossBillingKey?: string;
  tossCustomerKey?: string;
  // PortOne V2
  portoneBillingKey?: string;
  portonePaymentId?: string;
  /** KG이니시스 갱신 청구 시 매번 필요 — completePortOneBillingKey 에서 저장. */
  portoneCustomerName?: string;
  portoneCustomerPhone?: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  createdAt: Date;
}

export interface PlanLimits {
  maxProjects: number;
  maxAgents: number;
  hasFlowEditor: boolean;
  hasTeamCollab: boolean;
  hasOrchestrator: boolean;
  hasPrioritySupport: boolean;
}
