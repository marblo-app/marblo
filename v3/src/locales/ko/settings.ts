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
    "오케스트레이터가 새 에이전트를 스폰할 때 **어떤 하네스가 경쟁에 들어갈지**를 정합니다. 승자는 프리셋이 아니라 매 dispatch 마다 태그 적합·잔여 쿼터·주간 토큰 한도·최근 사용량·라우팅 그래프로 계산되고(스마트 라우팅), 그 하네스 안의 구체 모델 칸도 같은 근거로 골라집니다. 태스크에 모델을 명시하면 그 지정이 우선합니다.",
  "settings.models.customHelp":
    "경쟁에 넣을 하네스를 직접 고릅니다. 고른 뒤에도 승자는 스마트 라우팅이 정합니다.",
  "settings.models.customLastHarness":
    "최소 한 개는 켜져 있어야 합니다 — 후보가 없으면 dispatch 가 막힙니다.",
  "settings.models.restartNote":
    "프리셋은 즉시 저장되지만 dispatch 라우팅은 Electron main 에서 읽습니다. HMR 이 안 되므로 실제 스폰 분포는 앱을 재시작한 뒤에 확인하세요.",
  "settings.orchestratorModel.heading": "오케스트레이터 모델",
  "settings.orchestratorModel.help":
    "오케스트레이터 자체를 어떤 CLI로 실행할지 선택합니다. 환경변수 MARBLO_ORCHESTRATOR_MODEL이 있으면 환경변수가 우선합니다.",
  "settings.orchestratorModel.label": "실행 모델",
  "settings.orchestratorModel.restartRunning":
    "현재 오케스트레이터가 실행 중입니다. 변경사항은 오케스트레이터를 중지한 뒤 다시 시작하면 적용됩니다.",
  "settings.orchestratorModel.restartStopped":
    "변경사항은 다음 오케스트레이터 시작부터 적용됩니다. Electron main 변경은 HMR이 안 되므로 런타임 검증은 앱 재빌드/재시작 후 확인하세요.",
  "settings.orchestratorModel.saved":
    "저장됨. 다음 오케스트레이터 재시작 후 적용됩니다.",
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
  "settings.team.projectTabHint":
    "구성원별 작업량(에이전트 · 진행중 · 리뷰 · 완료 · 머지)은 프로젝트 탭에서 함께 볼 수 있습니다.",
  "settings.team.projectTabCta": "프로젝트 탭 열기",

  // ── Invitation banner (InvitationBanner) ─────────────────
  "settings.invitation.invitedYou": "{inviter}님이 {project}에 초대했습니다",
  "settings.invitation.fallbackProject": "프로젝트",
  "settings.invitation.accept": "수락",
  "settings.invitation.reject": "거절",
  "settings.invitation.joined": "{project}에 합류했습니다. 이동 중…",
  "settings.invitation.acceptFailed":
    "초대 수락에 실패했습니다. 다시 시도해주세요.",
  "settings.invitation.rejectFailed":
    "초대 거절에 실패했습니다. 다시 시도해주세요.",

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
  "settings.upgrade.feature.projects": "프로젝트 추가",
  "settings.upgrade.feature.agents": "무제한 에이전트",

  // ── Privacy settings (PrivacySettings) ───────────────────
  "settings.privacy.heading": "Privacy",
  "settings.privacy.optInDescription":
    "비식별 사용 분석은 기본 켜짐이며 언제든 끌 수 있습니다. 외부 제3자(Sentry) 송신은 옵트인입니다.",
  "settings.privacy.firstParty.label": "사용 분석 (비식별)",
  // ★라우팅 고지(ticket QFNrT4Z4dG9nGoRYmTlr): 라우팅 라벨(#892)은 새로 수집하는
  //   항목이 아니라 이 비식별 지표에서 파생되는 특징이다. 수집 범위가 아니라
  //   **이용 목적**을 명확히 밝히는 문구다 — 원문은 여기에 포함되지 않는다.
  "settings.privacy.firstParty.hint":
    "익명 설치 ID와 집계 지표만 자체 GCP(BigQuery)에 수집. 계정 UID·코드·입력 텍스트 제외. 이 비식별 파생 특징은 모델 라우팅(어떤 일을 어떤 모델에 맡길지) 품질 개선에도 쓰입니다.",
  "settings.privacy.sentry.label": "익명 크래시 리포트 (Sentry)",
  "settings.privacy.sentry.hint": "스택 트레이스에서 PII 자동 마스킹.",
  "settings.privacy.bigquery.label": "자체 운영 품질 지표 (BigQuery)",
  "settings.privacy.bigquery.body":
    "식별정보를 제거한 비식별 데이터(익명 설치 ID, 토큰/비용/이벤트 종류)만 우리 GCP에 수집됩니다. 계정 UID·코드·입력 텍스트는 포함되지 않으며, 제3자에게 제공되지 않습니다. 이 비식별 데이터에서 파생된 특징은 모델 라우팅 품질 개선에도 이용됩니다(원문 아님).",
  // 학습데이터 캡처 행(ticket IqcXHVbT0rXnHloXpV7n + 동의배선 QFNrT4Z4dG9nGoRYmTlr).
  // 행 자체는 모두에게 보이고 기본값은 off — 명시 옵트인만 인정한다.
  "settings.privacy.trainingCapture.label":
    "학습데이터 기여 (프롬프트·응답 원문)",
  "settings.privacy.trainingCapture.hint":
    "자체 모델 학습용으로 내 에이전트 턴의 원문 텍스트(코드 포함 가능)를 별도 보안 저장소에 보관합니다. 위 비식별 지표와 완전히 분리된 경로이고, 제3자에게 제공되지 않으며, 끄면 즉시 중단됩니다.",
  "settings.privacy.trainingCapture.phased":
    "상태: 이 계정은 아직 원문 수집이 열리지 않았습니다 — 동의는 지금 기록되고, 개방 시점부터 적용됩니다. 끄면 기록도 함께 철회됩니다.",
  "settings.privacy.trainingCapture.status":
    "상태: {state} · 미전송 대기 {spooled}건",
  "settings.privacy.trainingCapture.on": "수집 중",
  "settings.privacy.trainingCapture.off": "중지됨",
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
  "settings.subscription.heading": "구독제 과금",
  "settings.subscription.help":
    "구독으로 쓰는 하네스는 아래처럼 자동 감지됩니다. 비용 리포트에서 월정액으로 환산하려면 금액만 따로 등록하세요.",
  "settings.subscription.detected.heading": "감지된 CLI 구독",
  "settings.subscription.detected.none": "감지 안 됨",
  "settings.subscription.detected.help":
    "각 CLI 계정의 한도(rate limit) 창을 직접 조회한 결과입니다. 구독 여부와 소진율은 이렇게 자동으로 알 수 있지만, 월정액 금액은 CLI 가 알려주지 않습니다.",
  "settings.subscription.manual.heading": "월정액 금액 등록 (고급)",
  "settings.subscription.manual.help":
    "비용 리포트를 토큰 단가 대신 월정액으로 계산하려면 여기 금액을 넣으세요. 위에서 자동 감지되지 않는 벤더(GLM·MiniMax 등 잔액 API 가 없는 곳)도 여기서 선언합니다. 등록 안 하면 기본 토큰 단가가 적용됩니다.",
  "settings.subscription.empty":
    "등록된 구독 플랜이 없습니다. 모든 모델은 토큰 단가로 과금됩니다.",
  "settings.subscription.monthlyFlat": "월정액 USD",
  "settings.subscription.tokenAllowance": "월 토큰한도",
  "settings.subscription.optional": "(선택)",
  "settings.subscription.delete": "삭제",
  "settings.subscription.addPlan": "+ 플랜 추가",
  "settings.subscription.saving": "저장 중...",
  "settings.subscription.saved": "저장됨",

  // ── env-swap 벤더 키 (SettingsPage › VendorKeysSettings) ─────────
  // ★벤더 이름·모델 id·env 키 이름은 번역 대상이 아니다(식별자). 여기 있는 것은
  //   UI 틀 문구뿐이다.
  "settings.vendorKeys.heading": "벤더 API 키 (env-swap)",
  "settings.vendorKeys.help":
    "자체 CLI 가 없고 claude 하네스를 그대로 쓰되 백엔드만 갈아끼우는 벤더입니다. 여기 등록한 키는 OS 키체인으로 암호화해 {path} 에 저장되고, 에이전트 스폰 시에만 그 프로세스 환경변수로 주입됩니다. 평문은 화면·로그·클라우드 어디에도 남지 않습니다.",
  "settings.vendorKeys.loading": "벤더 키 상태를 불러오는 중...",
  "settings.vendorKeys.noEncryption":
    "이 시스템에서 OS 키체인 암호화를 쓸 수 없어 키를 저장할 수 없습니다. Linux 라면 libsecret-1-0 / gnome-keyring 설치 후 재시작하세요. (평문 저장은 하지 않습니다.)",
  "settings.vendorKeys.defaultHint":
    "claude 하네스를 이 벤더 엔드포인트로 붙입니다.",
  "settings.vendorKeys.models": "모델: {models}",
  "settings.vendorKeys.ready": "활성",
  "settings.vendorKeys.notReady": "미설정",
  "settings.vendorKeys.partialWarning":
    "필요한 키가 전부 차야 활성화됩니다. 일부만 채운 상태에서는 프로파일을 아예 주입하지 않습니다 — 반쪽 주입은 Anthropic 크레덴셜을 다른 엔드포인트로 보내는 유출이 됩니다.",
  "settings.vendorKeys.unset": "미설정",
  "settings.vendorKeys.sourceEnv": "· 셸/.env 값 사용 중(앱 저장값보다 우선)",
  "settings.vendorKeys.sourceStore": "· 앱 저장소",
  "settings.vendorKeys.replacePlaceholder": "새 키를 입력하면 교체됩니다",
  "settings.vendorKeys.newPlaceholder": "{console} 에서 발급한 키",
  "settings.vendorKeys.save": "저장",
  "settings.vendorKeys.delete": "삭제",
  "settings.vendorKeys.envWinsNotice":
    "셸/.env 에 같은 이름의 값이 있어 그쪽이 사용됩니다. 앱 저장값을 쓰려면 셸 env 를 지우고 재시작하세요.",
  "settings.vendorKeys.saved": "키를 안전 저장했습니다(OS 키체인 암호화).",
  "settings.vendorKeys.saveFailed": "저장에 실패했습니다.",
  "settings.vendorKeys.deleted": "저장된 키를 삭제했습니다.",
  "settings.vendorKeys.deleteFailed": "삭제에 실패했습니다.",
  "settings.vendorKeys.respawnNotice":
    "이미 떠 있는 에이전트는 자기 환경변수 사본을 들고 있습니다 — 새 키는 다음 스폰부터 적용됩니다.",
  "settings.vendorKeys.consoleFallback": "벤더 콘솔",
  "settings.vendorKeys.hint.zai":
    "GLM Coding Plan 구독키. claude 하네스를 Z.ai 엔드포인트로 붙입니다.",
  "settings.vendorKeys.hint.minimax":
    "MiniMax Token Plan 구독키. claude 하네스를 MiniMax 엔드포인트로 붙입니다.",
  "settings.vendorKeys.hint.upstage":
    "Upstage Solar Pro 4 API 키입니다. Codex 하네스를 OpenAI 호환 Upstage 엔드포인트로 붙입니다.",
};
