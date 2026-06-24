/**
 * Korean — `billing.*` namespace (Settings → Billing: plan cards, payment
 * method modal, subscription management). Plan/brand names (Free/Pro/Team…)
 * and KRW amounts stay literal; only the surrounding UI chrome is translated.
 *
 * `billing.data.*` holds "data-as-label" strings — payment-method and
 * provider display names. The underlying identifiers (enum codes, provider
 * ids like "toss"/"paddle") stay English in code; only the visible label is
 * keyed here. See ../README.md (△ data.* section).
 */
export const billing = {
  // ── Page / current plan ─────────────────────────────────
  "billing.title": "플랜 및 결제",
  "billing.currentPlan": "현재 플랜",
  "billing.status.pastDue": "결제 지연",
  "billing.status.canceled": "취소됨",
  "billing.nextBillingDate": "다음 결제일",

  // ── Plan cards ──────────────────────────────────────────
  "billing.currentPlanBadge": "현재 플랜",
  "billing.upgrade": "업그레이드",

  // Plan feature bullets (shared across cards where the text is identical)
  "billing.feature.projects1": "프로젝트 1개",
  "billing.feature.projects3": "프로젝트 3개",
  "billing.feature.projectsUnlimited": "무제한 프로젝트",
  "billing.feature.agents2": "에이전트 2개",
  "billing.feature.agents5": "에이전트 5개",
  "billing.feature.agentsUnlimited": "무제한 에이전트",
  "billing.feature.mcpBasic": "MCP 기본 지원",
  "billing.feature.flowEditor": "Flow 에디터",
  "billing.feature.orchestrator": "오케스트레이터",
  "billing.feature.teamCollab": "팀 협업",
  "billing.feature.prioritySupport": "우선 지원",
  "billing.feature.sso": "SSO (Auth0/Clerk)",
  "billing.feature.auditLog": "감사 로그 노출",
  "billing.feature.prioritySupportSlack": "우선 지원 (Slack 채널)",
  "billing.feature.seatsIncluded": "5시트 포함 · 추가 시트당 ₩59,000",
  "billing.feature.allTeamFeatures": "모든 Team 기능 포함",

  // ── Payment method modal ────────────────────────────────
  "billing.selectPaymentMethod": "결제 수단 선택",
  "billing.modal.planLabel": "{plan} 플랜",
  "billing.modal.amountPerMonth": "{amount}원/월",
  "billing.processing": "처리 중...",
  "billing.pay": "결제하기",

  // ── Subscription management ─────────────────────────────
  "billing.manage.heading": "구독 관리",
  "billing.manage.desc": "결제 수단 변경, 구독 취소, 인보이스 확인",
  "billing.manage.button": "관리",
  "billing.cancelSubscription": "구독 취소",
  "billing.confirm.cancel":
    "정말 구독을 취소하시겠습니까? 현재 기간이 끝날 때까지 서비스를 이용할 수 있습니다.",
  "billing.alert.cancelViaSupport": "구독 취소는 고객센터로 문의해주세요.",

  // ── Data-as-label: checkout payment methods (BillingPage) ──
  "billing.data.method.paddle": "해외 결제 (카드/PayPal)",
  "billing.data.method.cardKr": "국내 카드",
  "billing.data.method.naverpay": "네이버페이",
  "billing.data.method.kakaopay": "카카오페이",
  "billing.data.method.tosspay": "토스페이",

  // ── Data-as-label: price unit suffixes (KRW amount stays literal) ──
  "billing.data.unit.perMonth": "/월",
  "billing.data.unit.perSeatMonth": "/인/월",

  // ── Data-as-label: payment provider display name ─────────
  "billing.data.provider.toss": "토스페이먼츠",

  // ── Data-as-label: PaymentMethod enum (types/payment.ts) ──
  // Enum internal values are English code identifiers; these are the
  // human-facing labels for each method code.
  "billing.data.paymentMethod.CARD": "카드",
  "billing.data.paymentMethod.VIRTUAL_ACCOUNT": "가상계좌",
  "billing.data.paymentMethod.TRANSFER": "계좌이체",
  "billing.data.paymentMethod.MOBILE_PHONE": "휴대폰",
  "billing.data.paymentMethod.GIFT_CERTIFICATE": "상품권",
  "billing.data.paymentMethod.EASY_PAY": "간편결제",
};
