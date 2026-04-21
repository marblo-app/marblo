export type PlanType = 'free' | 'pro' | 'team';
export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'trialing';
export type PaymentProvider = 'paddle' | 'toss';

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
