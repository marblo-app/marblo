/**
 * Korean — `settings.*` namespace (Settings modal: tabs, profile/account,
 * team, agent model preset, language). Keys keep their dotted form.
 */
export const settings = {
  // ── Settings → tabs ─────────────────────────────────────
  "settings.title": "설정",
  "settings.tab.profile": "프로필",
  "settings.tab.models": "에이전트 모델",
  "settings.tab.billing": "결제",
  "settings.tab.team": "팀",
  "settings.tab.privacy": "Privacy",
  "settings.tab.apikeys": "API Keys",
  "settings.tab.language": "언어",
  "settings.profile.heading": "프로필 정보",
  "settings.account.heading": "계정 정보",
  "settings.account.name": "이름",
  "settings.account.email": "이메일",
  "settings.account.uid": "UID",
  "settings.team.selectProjectFirst": "프로젝트를 먼저 선택해주세요.",
  "settings.models.heading": "Agent Model Preset",
  "settings.models.help":
    "오케스트레이터가 새 에이전트를 스폰할 때 어떤 모델을 사용할지 결정합니다. 태스크에 특정 tags가 있으면 최적 모델이 자동 선택되고, 없으면 프리셋 비율로 배분됩니다.",
  "settings.language.heading": "Language / 언어",
  "settings.language.help": "UI 언어를 변경합니다. 변경 즉시 적용됩니다.",
  "settings.language.korean": "한국어",
  "settings.language.english": "English",

  // ── Team management (TeamManagement) ─────────────────────
  "settings.team.inviteHeading": "멤버 초대",
  "settings.team.email": "이메일",
  "settings.team.role": "역할",
  "settings.team.inviting": "전송 중...",
  "settings.team.inviteButton": "초대",
  "settings.team.pendingInvitations": "대기 중인 초대 ({count})",
  "settings.team.membersHeading": "멤버 ({count})",
  "settings.team.you": "(나)",
  "settings.team.remove": "제거",
  "settings.team.empty": "아직 멤버가 없습니다.",

  // ── Invitation banner (InvitationBanner) ─────────────────
  "settings.invitation.invitedYou": "{inviter}님이 {project}에 초대했습니다",
  "settings.invitation.fallbackProject": "프로젝트",
  "settings.invitation.accept": "수락",
  "settings.invitation.reject": "거절",

  // ── Plan gate (PlanGate) ─────────────────────────────────
  "settings.planGate.requiresPlan":
    "이 기능은 {plan} 플랜부터 사용 가능합니다.",
  "settings.planGate.upgradeButton": "플랜 업그레이드",

  // ── Upgrade modal (UpgradeModal) ─────────────────────────
  "settings.upgrade.needed": "업그레이드 필요",
  "settings.upgrade.featureRequiresPlan":
    "{feature} 기능은 {plan} 플랜부터 사용 가능합니다.",
  "settings.upgrade.planLabel": "{plan} 플랜",
  "settings.upgrade.projectsUnlimited": "프로젝트 무제한",
  "settings.upgrade.projectsCount": "프로젝트 {count}개",
  "settings.upgrade.agentsUnlimited": "에이전트 무제한",
  "settings.upgrade.agentsCount": "에이전트 {count}개",
  "settings.upgrade.processing": "처리 중...",
  "settings.upgrade.upgradeTo": "{plan}으로 업그레이드",
  "settings.upgrade.feature.flowEditor": "Flow 에디터",
  "settings.upgrade.feature.teamCollab": "팀 협업",
  "settings.upgrade.feature.orchestrator": "오케스트레이터",
  "settings.upgrade.feature.prioritySupport": "우선 지원",

  // ── Privacy settings (PrivacySettings) ───────────────────
  "settings.privacy.heading": "Privacy",
  "settings.privacy.optInDescription":
    "외부 제3자(Sentry) 송신은 옵트인입니다. 거부해도 마블로 모든 기능은 정상 작동합니다.",
  "settings.privacy.sentry.label": "익명 크래시 리포트 (Sentry)",
  "settings.privacy.sentry.hint": "스택 트레이스에서 PII 자동 마스킹.",
  "settings.privacy.bigquery.label": "자체 운영 품질 지표 (BigQuery)",
  "settings.privacy.bigquery.body":
    "식별정보를 제거한 비식별 데이터(익명 설치 ID, 토큰/비용/이벤트 종류)만 우리 GCP에 수집됩니다. 계정 UID·코드·입력 텍스트는 포함되지 않으며, 제3자에게 제공되지 않습니다.",
  "settings.privacy.overseas.notice":
    "국외 이전 동의: {status} — Sentry는 미국에서 처리됩니다 (PIPA 제15조 제2항).",
  "settings.privacy.overseas.agreed": "✓ 동의함",
  "settings.privacy.overseas.required": "필요",
  "settings.privacy.viewPolicy": "처리방침 보기",
  "settings.privacy.requestDeletion": "데이터 삭제 요청 (PIPA 제36조)",
  "settings.privacy.lastUpdated":
    "마지막 동의 갱신: {date} (정책 버전 {version})",
  "settings.privacy.deletion.subject": "[Marblo] 텔레메트리 데이터 삭제 요청",
  "settings.privacy.deletion.body":
    "안녕하세요.\n\n아래 사용자의 텔레메트리 데이터 삭제를 요청합니다 (PIPA 제36조).\n\n사용자 UID: {uid}\n\n대상 서비스:\n[ ] Sentry (크래시 리포트)\n\n30일 이내 응답 부탁드립니다.\n",
  "settings.saveFailed": "저장 실패",

  // ── Subscription plans (SettingsPage › SubscriptionPlansSection) ─
  "settings.subscription.heading": "구독제 플랜 등록",
  "settings.subscription.help":
    "Claude Max, ChatGPT Plus 처럼 월정액 구독으로 쓰는 모델이 있으면 여기 등록하세요. 등록된 모델은 토큰 단가가 아닌 월정액으로 비용이 계산되고, 선택적으로 월간 토큰 한도를 넘으면 그 초과분만 토큰 단가로 과금합니다. 등록 안 하면 기본 토큰 단가가 적용됩니다.",
  "settings.subscription.empty":
    "등록된 구독 플랜이 없습니다. 모든 모델은 토큰 단가로 과금됩니다.",
  "settings.subscription.monthlyFlat": "월정액 USD",
  "settings.subscription.tokenAllowance": "월 토큰한도",
  "settings.subscription.optional": "(선택)",
  "settings.subscription.delete": "삭제",
  "settings.subscription.addPlan": "+ 플랜 추가",
  "settings.subscription.saving": "저장 중...",
  "settings.subscription.saved": "저장됨",
};
