/**
 * Korean — `bugReport.*` namespace (in-app "Report a bug" entry point + modal).
 * Kept in its own namespace file so it doesn't collide with the settings table.
 */
export const bugReport = {
  // ── Settings → tab + section ────────────────────────────
  "bugReport.tab": "버그 신고",
  "bugReport.heading": "버그 신고",
  "bugReport.help":
    "문제를 발견하셨나요? 무엇이 잘못되었는지 알려주시면 빠르게 살펴보겠습니다. 앱 버전·OS 등 진단에 필요한 정보가 자동으로 첨부됩니다.",
  "bugReport.button": "버그 신고하기",

  // ── Global entry point (header) ─────────────────────────
  "bugReport.globalButton": "버그 신고",
  "bugReport.globalButtonTitle": "버그 신고 — 문제가 있으면 알려주세요",

  // ── Modal ───────────────────────────────────────────────
  "bugReport.modal.title": "버그 신고",
  "bugReport.modal.descriptionLabel": "무슨 일이 있었나요?",
  "bugReport.modal.descriptionPlaceholder":
    "어떤 동작을 하다가 무엇이 잘못되었는지, 기대한 결과는 무엇이었는지 적어주세요.",
  "bugReport.modal.contextHeading": "자동 첨부 정보",
  "bugReport.modal.appVersion": "앱 버전",
  "bugReport.modal.platform": "플랫폼",
  "bugReport.modal.route": "현재 위치",
  "bugReport.modal.agents": "에이전트",
  "bugReport.modal.cancel": "취소",
  "bugReport.modal.submit": "신고 보내기",
  "bugReport.modal.submitting": "보내는 중…",
  "bugReport.modal.required": "버그 설명을 입력해 주세요.",
  "bugReport.modal.successTitle": "신고가 접수되었습니다",
  "bugReport.modal.successBody":
    "소중한 제보 감사합니다. 빠르게 확인하겠습니다.",
  "bugReport.modal.errorGeneric":
    "신고를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.",
  "bugReport.modal.loginRequired": "버그 신고는 로그인 후 이용할 수 있습니다.",
  "bugReport.modal.rateLimited":
    "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
  "bugReport.modal.close": "닫기",

  // ── One-time in-app notice (post-update discovery) ──────
  "bugReport.notice.title": "🐛 버그 신고가 더 쉬워졌어요",
  "bugReport.notice.body":
    "이제 앱 상단 바의 🐛 버튼으로 어디서든 버그를 신고할 수 있어요.",
  "bugReport.notice.cta": "지금 신고하기",
  "bugReport.notice.dismiss": "안내 닫기",
};
