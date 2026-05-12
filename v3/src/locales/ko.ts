/**
 * Korean string table. Keys are namespaced by surface (settings.*, header.*,
 * agents.*). Add new keys here AND in en.ts at the same time — the runtime
 * t() falls back to ko if en is missing, but that defeats the point.
 */
export const ko = {
  // ── Header ──────────────────────────────────────────────
  "header.selectProject": "프로젝트 선택",
  "header.newProject": "새 프로젝트",
  "header.projectName": "프로젝트 이름",
  "header.add": "추가",
  "header.settings": "설정",
  "header.logout": "로그아웃",
  "header.planBadge.suffix": "플랜",

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

  // ── Agents Dashboard ────────────────────────────────────
  "agents.dashboard.title": "Agent Dashboard",
  "agents.dashboard.addAgent": "에이전트 추가",
  "agents.dashboard.cleanup": "정리",
  "agents.dashboard.cleanupConfirm":
    "{count}개의 비활성 에이전트를 삭제하시겠습니까?\n(working 상태 제외)",
  "agents.dashboard.loading": "에이전트 로딩 중...",

  // ── Plans ───────────────────────────────────────────────
  "plan.free": "Free",
  "plan.pro": "Pro",
  "plan.team": "Team",
  "plan.teamPlus": "Team Plus",
  "plan.enterprise": "Enterprise",
};

export type MessageKey = keyof typeof ko;
