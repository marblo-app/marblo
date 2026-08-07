/**
 * English — `billing.*` namespace. Typed `Record<keyof typeof koBilling, string>`
 * so any key drift against the ko sibling is a compile error for this
 * namespace alone.
 */
import type { billing as koBilling } from "../ko/billing";

export const billing: Record<keyof typeof koBilling, string> = {
  // ── Page / current plan ─────────────────────────────────
  "billing.title": "Plans & Billing",
  "billing.currentPlan": "Current plan",
  "billing.status.pastDue": "Payment overdue",
  "billing.status.canceled": "Canceled",
  "billing.nextBillingDate": "Next billing date",
  "billing.accessUntil": "Access ends on",
  "billing.periodEndPastDue": "Current period ends",

  // ── Plan cards ──────────────────────────────────────────
  "billing.currentPlanBadge": "Current plan",
  "billing.upgrade": "Upgrade",

  "billing.feature.projects1": "1 project",
  "billing.feature.projects3": "3 projects",
  "billing.feature.projectsUnlimited": "Unlimited projects",
  "billing.feature.agents2": "2 agents",
  "billing.feature.agents5": "5 agents",
  "billing.feature.agentsUnlimited": "Unlimited agents",
  "billing.feature.mcpBasic": "Basic MCP support",
  "billing.feature.flowEditor": "Flow editor",
  "billing.feature.orchestrator": "Orchestrator",
  "billing.feature.teamCollab": "Team collaboration",
  "billing.feature.prioritySupport": "Priority support",
  "billing.feature.sso": "SSO (Auth0/Clerk)",
  "billing.feature.auditLog": "Audit log access",
  "billing.feature.prioritySupportSlack": "Priority support (Slack channel)",
  "billing.feature.seatsIncluded": "5 seats included · ₩59,000 per extra seat",
  "billing.feature.allTeamFeatures": "All Team features included",

  // ── Payment method modal ────────────────────────────────
  "billing.selectPaymentMethod": "Select a payment method",
  "billing.modal.planLabel": "{plan} plan",
  "billing.modal.amountPerMonth": "₩{amount}/mo",
  "billing.processing": "Processing...",
  "billing.pay": "Pay",

  // ── Subscription management ─────────────────────────────
  "billing.manage.heading": "Manage subscription",
  "billing.manage.desc":
    "Change payment method, cancel subscription, view invoices",
  "billing.manage.descPastDue":
    "Payment retry is in progress. Canceling stops further charges. If paid time remains, you can use the service until the period ends (no refund).",
  "billing.manage.button": "Manage",
  "billing.cancelSubscription": "Cancel subscription",
  "billing.confirm.cancel":
    "Are you sure you want to cancel your subscription? You can keep using the service until the end of the current period.",
  "billing.confirm.cancelPastDue":
    "Payment has failed. Canceling stops retry charges. If paid time remains, you keep access until the period ends (no refund). Continue?",
  "billing.alert.cancelViaSupport":
    "To cancel your subscription, please contact support.",
  "billing.alert.cancelFailed":
    "Could not cancel the subscription. Please try again shortly.",

  // ── Data-as-label: checkout payment methods (BillingPage) ──
  "billing.data.method.paddle": "International (Card/PayPal)",
  "billing.data.method.cardKr": "Domestic card",
  "billing.data.method.naverpay": "Naver Pay",
  "billing.data.method.kakaopay": "Kakao Pay",
  "billing.data.method.tosspay": "Toss Pay",

  // ── Data-as-label: price unit suffixes (KRW amount stays literal) ──
  "billing.data.unit.perMonth": "/mo",
  "billing.data.unit.perSeatMonth": "/seat/mo",

  // ── Data-as-label: payment provider display name ─────────
  "billing.data.provider.toss": "TossPayments",

  // ── Data-as-label: payment method codes ──────────────────
  "billing.data.paymentMethod.CARD": "Card",
  "billing.data.paymentMethod.VIRTUAL_ACCOUNT": "Virtual account",
  "billing.data.paymentMethod.TRANSFER": "Bank transfer",
  "billing.data.paymentMethod.MOBILE_PHONE": "Mobile phone",
  "billing.data.paymentMethod.GIFT_CERTIFICATE": "Gift certificate",
  "billing.data.paymentMethod.EASY_PAY": "Easy pay",
};
