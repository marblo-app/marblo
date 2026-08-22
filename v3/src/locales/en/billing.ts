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
  "billing.method.portone.desc":
    "Opens in your default browser (PortOne · KG Inicis)",
  "billing.method.paddle.desc": "Paddle checkout opens inside the app",
  "billing.error.checkoutUnavailable":
    "This plan cannot be purchased from the app. Please contact support.",
  "billing.error.paddleNotConfigured":
    "International payment is not configured yet. Please use domestic payment.",
  "billing.error.paddleFailed":
    "Could not open the checkout window. Please try again shortly.",

  // ── Web checkout handoff (domestic · PortOne) ────────────
  // The app does not process payment; it hands off to the browser. This
  // notice stands in for the time in between.
  "billing.webCheckout.heading": "Finish your payment in the browser",
  "billing.webCheckout.desc":
    "We opened checkout for the {plan} plan in your default browser. This screen updates automatically once payment completes.",
  "billing.webCheckout.account":
    "Sign in with the same account you use here ({email}).",
  "billing.webCheckout.reopen": "Reopen checkout",
  "billing.webCheckout.refresh": "Refresh payment status",
  "billing.webCheckout.refreshing": "Checking...",
  "billing.webCheckout.dismiss": "Dismiss",

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
  "billing.alert.cancelFailed":
    "Could not cancel the subscription. Please try again shortly.",

  // ── Cancel confirmation modal (replaces native confirm/alert) ──
  // Mirrors the web (my/subscription) inline confirm UX — both surfaces go
  // through the single cancelSubscription callable.
  "billing.cancel.modalTitle": "Cancel subscription",
  "billing.cancel.keep": "Keep subscription",
  "billing.cancel.confirm": "Cancel subscription",
  "billing.cancel.canceling": "Canceling...",
  "billing.cancel.doneTitle": "Your subscription has been canceled.",
  "billing.cancel.doneAlreadyTitle": "This subscription was already canceled.",
  "billing.cancel.doneAccessUntil":
    "You keep your current plan until {date}. After that you move to Free and will not be charged again.",
  "billing.cancel.doneNoPeriod": "You will not be charged again.",
  "billing.cancel.close": "Close",

  // ── Data-as-label: checkout payment methods (BillingPage) ──
  // The four Korean methods (card / Naver Pay / Kakao Pay / Toss Pay) were
  // labels for the in-app TossPayments SDK path. They went out with that
  // path — domestic payment is now a single web-checkout (PortOne) entry.
  // The provider.toss label stays: existing Toss subscribers still show it.
  "billing.data.method.portoneKr": "Korea (Card / Easy Pay)",
  "billing.data.method.paddle": "International (Card/PayPal)",

  // ── Data-as-label: price unit suffixes (KRW amount stays literal) ──
  "billing.data.unit.perMonth": "/mo",
  "billing.data.unit.perSeatMonth": "/seat/mo",

  // ── Data-as-label: payment provider display name ─────────
  "billing.data.provider.toss": "TossPayments",
  "billing.data.provider.portone": "PortOne",
  "billing.data.provider.paddle": "Paddle",

  // ── Data-as-label: payment method codes ──────────────────
  "billing.data.paymentMethod.CARD": "Card",
  "billing.data.paymentMethod.VIRTUAL_ACCOUNT": "Virtual account",
  "billing.data.paymentMethod.TRANSFER": "Bank transfer",
  "billing.data.paymentMethod.MOBILE_PHONE": "Mobile phone",
  "billing.data.paymentMethod.GIFT_CERTIFICATE": "Gift certificate",
  "billing.data.paymentMethod.EASY_PAY": "Easy pay",
};
