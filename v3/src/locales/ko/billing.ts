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
  "billing.accessUntil": "이용 종료일",
  "billing.periodEndPastDue": "현재 청구 주기 종료일",

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
  "billing.method.portone.desc":
    "기본 브라우저에서 진행됩니다 (포트원 · KG이니시스)",
  "billing.method.paddle.desc": "Paddle 결제창이 앱 안에서 열립니다",
  "billing.error.checkoutUnavailable":
    "이 플랜은 앱에서 바로 결제할 수 없습니다. 고객센터로 문의해 주세요.",
  "billing.error.paddleNotConfigured":
    "해외 결제가 아직 설정되지 않았습니다. 국내 결제를 이용해 주세요.",
  "billing.error.paddleFailed":
    "결제창을 여는 데 실패했습니다. 잠시 후 다시 시도해 주세요.",

  // ── Web checkout handoff (국내 결제 · 포트원) ────────────
  // 앱은 결제를 하지 않고 브라우저로 데려다준다. 그동안 이 안내가 뜬다.
  "billing.webCheckout.heading": "브라우저에서 결제를 진행해 주세요",
  "billing.webCheckout.desc":
    "{plan} 플랜 결제창을 기본 브라우저에서 열었습니다. 결제를 마치면 이 화면이 자동으로 갱신됩니다.",
  "billing.webCheckout.account": "앱과 같은 계정({email})으로 로그인해 주세요.",
  "billing.webCheckout.reopen": "결제창 다시 열기",
  "billing.webCheckout.refresh": "결제 상태 새로고침",
  "billing.webCheckout.refreshing": "확인 중...",
  "billing.webCheckout.dismiss": "닫기",
  // ── 미반영 / 계정 불일치 의심 (티켓 3Notu54M) ─────────────
  // 수동 새로고침 후에도 구독이 안 바뀌면 그린다. 가장 흔한 원인은 브라우저에
  // 앱과 다른 계정으로 로그인한 채 결제한 것 — 돈은 그 계정에 정상 반영됐다.
  // 실패를 0 으로 그리지 않고, 다음 행동을 함께 준다.
  "billing.webCheckout.unresolved.heading":
    "결제를 마쳤는데 아직 반영되지 않았나요?",
  "billing.webCheckout.unresolved.desc":
    "가장 흔한 원인은 브라우저에 앱과 다른 계정으로 로그인한 채 결제한 경우입니다. 이 앱은 {email} 계정의 구독만 봅니다. 결제한 계정에는 권한이 정상적으로 부여되어 있어 결제가 사라지지는 않습니다.",
  "billing.webCheckout.unresolved.descNoEmail":
    "가장 흔한 원인은 브라우저에 앱과 다른 계정으로 로그인한 채 결제한 경우입니다. 이 앱은 지금 로그인된 계정의 구독만 봅니다. 결제한 계정에는 권한이 정상적으로 부여되어 있어 결제가 사라지지는 않습니다.",
  "billing.webCheckout.unresolved.reopen": "이 계정으로 결제 다시 열기",
  "billing.webCheckout.unresolved.switchAccount":
    "결제한 계정으로 앱에 다시 로그인",
  "billing.webCheckout.unresolved.notPaid": "아직 결제하지 않았어요",

  // ── Subscription management ─────────────────────────────
  "billing.manage.heading": "구독 관리",
  "billing.manage.desc": "결제 수단 변경, 구독 취소, 인보이스 확인",
  "billing.manage.descPastDue":
    "결제 재시도 중입니다. 해지하면 추가 청구가 중단됩니다. 이미 결제한 기간이 남아 있으면 종료일까지 이용할 수 있습니다(환불 없음).",
  "billing.manage.button": "관리",
  "billing.cancelSubscription": "구독 취소",
  "billing.confirm.cancel":
    "정말 구독을 취소하시겠습니까? 현재 기간이 끝날 때까지 서비스를 이용할 수 있습니다.",
  "billing.confirm.cancelPastDue":
    "결제 실패 상태입니다. 해지하면 재시도 청구가 중단됩니다. 이미 결제한 기간이 남아 있으면 종료일까지 이용할 수 있으며 환불은 되지 않습니다. 계속할까요?",
  "billing.alert.cancelFailed":
    "구독 취소에 실패했습니다. 잠시 후 다시 시도해주세요.",

  // ── Cancel confirmation modal (native confirm/alert 대체) ──
  // 웹(my/subscription)의 인라인 확인 UX 와 문구·단계가 같아야 한다 —
  // 취소 경로는 웹/앱 모두 단일 cancelSubscription callable 이다.
  "billing.cancel.modalTitle": "구독 취소",
  "billing.cancel.keep": "구독 유지",
  "billing.cancel.confirm": "구독 취소하기",
  "billing.cancel.canceling": "취소 중...",
  "billing.cancel.doneTitle": "구독이 취소되었습니다.",
  "billing.cancel.doneAlreadyTitle": "이미 취소된 구독입니다.",
  "billing.cancel.doneAccessUntil":
    "{date}까지 현재 플랜을 그대로 이용할 수 있습니다. 이후 Free 로 전환되며 추가 청구는 없습니다.",
  "billing.cancel.doneNoPeriod": "추가 청구는 발생하지 않습니다.",
  "billing.cancel.close": "닫기",

  // ── Data-as-label: checkout payment methods (BillingPage) ──
  // 국내 4종(국내 카드·네이버페이·카카오페이·토스페이)은 앱 안에서 토스
  // SDK 를 직접 띄우던 인앱 경로의 라벨이었다. 그 경로를 걷어내면서 함께
  // 지웠다 — 국내 결제는 이제 웹 체크아웃(포트원) 한 줄로 합쳐진다.
  // ★provider.toss 라벨은 남긴다: 기존 토스 구독자의 결제사 표시에 아직 쓴다.
  "billing.data.method.portoneKr": "국내 결제 (카드·간편결제)",
  "billing.data.method.paddle": "해외 결제 (카드/PayPal)",

  // ── Data-as-label: price unit suffixes (KRW amount stays literal) ──
  "billing.data.unit.perMonth": "/월",
  "billing.data.unit.perSeatMonth": "/인/월",

  // ── Data-as-label: payment provider display name ─────────
  "billing.data.provider.toss": "토스페이먼츠",
  "billing.data.provider.portone": "포트원",
  "billing.data.provider.paddle": "Paddle",

  // ── Data-as-label: payment method codes ──────────────────
  // Enum internal values are English code identifiers; these are the
  // human-facing labels for each method code.
  "billing.data.paymentMethod.CARD": "카드",
  "billing.data.paymentMethod.VIRTUAL_ACCOUNT": "가상계좌",
  "billing.data.paymentMethod.TRANSFER": "계좌이체",
  "billing.data.paymentMethod.MOBILE_PHONE": "휴대폰",
  "billing.data.paymentMethod.GIFT_CERTIFICATE": "상품권",
  "billing.data.paymentMethod.EASY_PAY": "간편결제",
};
