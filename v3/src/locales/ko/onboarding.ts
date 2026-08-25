/**
 * Korean — `onboarding.*` namespace (entry/onboarding flow: welcome screen,
 * profile setup, channel integration guide, setup wizard, progress/steps
 * chrome, and the auth login/signup screen).
 *
 * Data labels (industries, business types, team sizes, budgets, goals, roles,
 * workspace types, channel names) live under their own sub-namespace here.
 * The *stored* value stays an English code identifier in the component
 * (e.g. industry: "ecommerce"); only the display label is translated. See
 * ../README.md §"데이터 겸 UI 라벨".
 *
 * Not translated (left hard-coded in components): example placeholder URLs
 * (https://example.com), email/timezone example values, the "Marblo" brand,
 * and the required-field "*" marker (language-neutral).
 */
export const onboarding = {
  // — shared within this namespace (P6 dedups against common.*) —
  "onboarding.common.skip": "건너뛰기",
  "onboarding.common.setupLater": "나중에 설정하기",

  // — LanguageFirstRun (first-launch language picker modal) —
  "onboarding.langFirstRun.title": "언어를 선택하세요",
  "onboarding.langFirstRun.subtitle":
    "마블로를 사용할 언어를 선택하세요. 나중에 설정에서 언제든 변경할 수 있습니다.",
  "onboarding.langFirstRun.continue": "계속",

  // — WelcomeScreen —
  "onboarding.welcome.title": "마블로에 오신 것을 환영합니다!",
  "onboarding.welcome.subtitle":
    "통합 마케팅 플랫폼으로 여러 채널의 성과를 한곳에서 관리하고 최적화하세요. 몇 분만 투자하면 바로 시작할 수 있습니다.",
  "onboarding.welcome.feature.dashboard.title": "통합 대시보드",
  "onboarding.welcome.feature.dashboard.desc":
    "모든 채널의 성과를 한눈에 확인하고 분석하세요",
  "onboarding.welcome.feature.automation.title": "자동화 워크플로우",
  "onboarding.welcome.feature.automation.desc":
    "반복 작업을 자동화하여 효율성을 극대화하세요",
  "onboarding.welcome.feature.ai.title": "AI 기반 최적화",
  "onboarding.welcome.feature.ai.desc":
    "AI가 분석한 인사이트로 마케팅 성과를 개선하세요",
  "onboarding.welcome.feature.collaboration.title": "팀 협업",
  "onboarding.welcome.feature.collaboration.desc":
    "팀원들과 실시간으로 협업하고 소통하세요",
  "onboarding.welcome.stepsTitle": "🚀 설정 단계 (약 5분 소요)",
  "onboarding.welcome.step.profile": "프로필 설정 및 기본 정보 입력",
  "onboarding.welcome.step.channels":
    "마케팅 채널 연동 (Google Ads, Meta, 네이버 등)",
  "onboarding.welcome.step.dashboard": "대시보드 개인화 설정",
  "onboarding.welcome.step.team": "팀원 초대 및 권한 설정",
  "onboarding.welcome.getStarted": "시작하기",

  // — OnboardingPage: step titles/descriptions + completion + header —
  "onboarding.step.profile.title": "프로필 설정",
  "onboarding.step.profile.description":
    "회사 정보와 마케팅 목표를 설정해주세요",
  "onboarding.step.channels.title": "채널 연동",
  "onboarding.step.channels.description":
    "마케팅 채널을 연동하여 통합 관리를 시작하세요",
  "onboarding.step.preferences.title": "환경 설정",
  "onboarding.step.preferences.description":
    "개인화 설정과 보안 옵션을 구성하세요",
  "onboarding.step.complete.title": "설정 완료",
  "onboarding.step.complete.description": "모든 설정이 완료되었습니다",
  "onboarding.complete.heading": "🎉 설정 완료!",
  "onboarding.complete.body":
    "마블로 설정이 완료되었습니다. 이제 통합 대시보드에서 마케팅 성과를 확인하고 관리하세요.",
  "onboarding.complete.goToDashboard": "대시보드로 이동",
  "onboarding.header.title": "마블로 설정",

  // — OnboardingSteps nav —
  "onboarding.nav.previous": "이전",
  "onboarding.nav.skipSetup": "설정 건너뛰기",
  "onboarding.nav.skipStep": "이 단계 건너뛰기",
  "onboarding.nav.next": "다음",
  "onboarding.nav.complete": "완료",

  // — ProgressIndicator —
  "onboarding.progress.stepOf": "{total}단계 중 {current}단계",
  "onboarding.progress.percentComplete": "{percent}% 완료",

  // — ProfileSetupForm —
  "onboarding.profile.title": "프로필 설정",
  "onboarding.profile.subtitle":
    "더 나은 추천과 분석을 위해 기본 정보를 입력해주세요",
  "onboarding.profile.basicInfo": "기본 정보",
  "onboarding.profile.companyName": "회사명",
  "onboarding.profile.companyNamePlaceholder": "우리 회사",
  "onboarding.profile.website": "웹사이트",
  "onboarding.profile.industry": "업종",
  "onboarding.profile.industryPlaceholder": "업종을 선택해주세요",
  "onboarding.profile.businessType": "사업 유형",
  "onboarding.profile.businessTypePlaceholder": "사업 유형을 선택해주세요",
  "onboarding.profile.teamSize": "팀 규모",
  "onboarding.profile.teamSizePlaceholder": "팀 규모를 선택해주세요",
  "onboarding.profile.budget": "월 마케팅 예산",
  "onboarding.profile.budgetPlaceholder": "예산 범위를 선택해주세요",
  "onboarding.profile.description": "회사 소개",
  "onboarding.profile.descriptionPlaceholder":
    "회사의 주요 사업이나 특징을 간단히 설명해주세요",
  "onboarding.profile.goalsTitle": "마케팅 목표",
  "onboarding.profile.goalsHint":
    "주요 마케팅 목표를 선택해주세요 (복수 선택 가능)",
  "onboarding.profile.next": "다음 단계",
  "onboarding.profile.error.companyName": "회사명을 입력해주세요",
  "onboarding.profile.error.primaryGoals": "최소 1개의 목표를 선택해주세요",

  // — Industries (data labels; stored value = code identifier) —
  "onboarding.industry.ecommerce": "이커머스/온라인 쇼핑",
  "onboarding.industry.fashionBeauty": "패션/뷰티",
  "onboarding.industry.foodBeverage": "식품/음료",
  "onboarding.industry.electronics": "전자제품/가전",
  "onboarding.industry.healthMedical": "건강/의료",
  "onboarding.industry.education": "교육/학습",
  "onboarding.industry.travel": "여행/숙박",
  "onboarding.industry.realEstate": "부동산",
  "onboarding.industry.finance": "금융/보험",
  "onboarding.industry.software": "IT/소프트웨어",
  "onboarding.industry.gameEntertainment": "게임/엔터테인먼트",
  "onboarding.industry.sportsFitness": "스포츠/피트니스",
  "onboarding.industry.other": "기타",

  // — Business types —
  "onboarding.businessType.b2c": "B2C (개인 고객 대상)",
  "onboarding.businessType.b2b": "B2B (기업 고객 대상)",
  "onboarding.businessType.b2b2c": "B2B2C (하이브리드)",
  "onboarding.businessType.marketplace": "마켓플레이스",
  "onboarding.businessType.saas": "SaaS/구독 서비스",
  "onboarding.businessType.other": "기타",

  // — Team sizes (profile) —
  "onboarding.teamSize.solo": "1명 (개인)",
  "onboarding.teamSize.2to5": "2-5명",
  "onboarding.teamSize.6to20": "6-20명",
  "onboarding.teamSize.21to50": "21-50명",
  "onboarding.teamSize.51to200": "51-200명",
  "onboarding.teamSize.201plus": "201명 이상",

  // — Budget ranges —
  "onboarding.budget.under1m": "월 100만원 미만",
  "onboarding.budget.1to5m": "월 100-500만원",
  "onboarding.budget.5to10m": "월 500-1,000만원",
  "onboarding.budget.10to50m": "월 1,000-5,000만원",
  "onboarding.budget.over50m": "월 5,000만원 이상",
  "onboarding.budget.undecided": "예산 미정",

  // — Marketing goals —
  "onboarding.goal.revenue": "매출 증대",
  "onboarding.goal.newCustomers": "신규 고객 확보",
  "onboarding.goal.brandAwareness": "브랜드 인지도 향상",
  "onboarding.goal.retention": "고객 재구매율 증가",
  "onboarding.goal.roi": "마케팅 ROI 개선",
  "onboarding.goal.competitive": "경쟁사 대비 우위 확보",
  "onboarding.goal.global": "글로벌 진출",
  "onboarding.goal.productLaunch": "신제품 론칭",
  "onboarding.goal.seasonal": "계절성 매출 대응",
  "onboarding.goal.dataDecision": "데이터 기반 의사결정",

  // — ChannelIntegrationGuide: shell —
  "onboarding.channels.banner.title": "커뮤니케이션 채널을 연동하세요",
  "onboarding.channels.banner.desc":
    "팀의 커뮤니케이션 플랫폼과 연동하여 실시간 업데이트와 알림을 받으세요. 채널은 설정에서 언제든 추가할 수 있습니다.",
  "onboarding.channels.connected": "연동됨",
  "onboarding.channels.hideGuide": "가이드 숨기기",
  "onboarding.channels.setupGuide": "설정 가이드",
  "onboarding.channels.setupStepsTitle": "설정 단계:",
  "onboarding.channels.webhookUrl": "웹훅 URL",
  "onboarding.channels.apiToken": "API 토큰/키",
  "onboarding.channels.apiPlaceholder": "API 토큰을 입력하세요",
  "onboarding.channels.connecting": "연동 중...",
  "onboarding.channels.connect": "채널 연동",
  "onboarding.channels.docs": "문서",
  "onboarding.channels.setupLater": "나중에 설정하겠습니다",

  // — Channel data: names —
  "onboarding.channel.googleAds.name": "Google Ads",
  "onboarding.channel.meta.name": "Meta Business",
  "onboarding.channel.naver.name": "네이버 쇼핑/검색광고",
  "onboarding.channel.coupang.name": "쿠팡 파트너스",
  "onboarding.channel.smartstore.name": "네이버 스마트스토어",
  "onboarding.channel.webhook.name": "사용자 지정 웹훅",

  // — Channel data: descriptions —
  "onboarding.channel.googleAds.desc":
    "Google Ads를 연동하여 캠페인 성과를 추적하고 최적화하세요",
  "onboarding.channel.meta.desc":
    "Meta(Facebook/Instagram) 광고 플랫폼을 연동하세요",
  "onboarding.channel.naver.desc":
    "네이버 쇼핑 및 검색광고 계정을 연동하여 성과를 관리하세요",
  "onboarding.channel.coupang.desc":
    "쿠팡 파트너스 API를 연동하여 주문 및 수수료 데이터를 추적하세요",
  "onboarding.channel.smartstore.desc":
    "네이버 스마트스토어 주문 관리 및 정산 데이터를 연동하세요",
  "onboarding.channel.webhook.desc":
    "최대의 유연성을 위해 사용자 지정 웹훅 엔드포인트를 설정하세요",

  // — Channel data: setup steps —
  "onboarding.channel.googleAds.step1": "Google Ads 계정에 로그인",
  "onboarding.channel.googleAds.step2": "도구 및 설정 → API 센터로 이동",
  "onboarding.channel.googleAds.step3":
    "API 접근 신청 또는 기존 접근 권한 사용",
  "onboarding.channel.googleAds.step4": "개발자 토큰 및 고객 ID 발급",
  "onboarding.channel.googleAds.step5":
    "Google Cloud Console에서 Google Ads API 활성화",
  "onboarding.channel.googleAds.step6": "애플리케이션 OAuth2 자격 증명 구성",
  "onboarding.channel.meta.step1": "Meta for Developers 포털로 이동",
  "onboarding.channel.meta.step2": "Marketing API용 새 앱 생성",
  "onboarding.channel.meta.step3": "Marketing API 권한 요청",
  "onboarding.channel.meta.step4": "App ID 및 App Secret 발급",
  "onboarding.channel.meta.step5":
    "ads_management 권한이 포함된 액세스 토큰 생성",
  "onboarding.channel.meta.step6": "광고 계정 ID 추가",
  "onboarding.channel.naver.step1": "네이버 검색광고 관리자 도구에 로그인",
  "onboarding.channel.naver.step2": "도구 → API 관리 → API 신청",
  "onboarding.channel.naver.step3": "API 키 및 시크릿 키 발급받기",
  "onboarding.channel.naver.step4": "고객 ID 확인 (우상단 고객센터에서 확인)",
  "onboarding.channel.naver.step5": "API 사용 승인 대기 (영업일 기준 1-2일)",
  "onboarding.channel.naver.step6": "발급된 API 정보 입력",
  "onboarding.channel.coupang.step1": "쿠팡 파트너스에 로그인",
  "onboarding.channel.coupang.step2": "파트너스 센터 → API 관리",
  "onboarding.channel.coupang.step3": "Access Key와 Secret Key 발급",
  "onboarding.channel.coupang.step4": "서비스 이용약관 동의",
  "onboarding.channel.coupang.step5": "API 테스트 및 연동 확인",
  "onboarding.channel.smartstore.step1": "네이버 커머스 API 센터 접속",
  "onboarding.channel.smartstore.step2": "스마트스토어 API 신청",
  "onboarding.channel.smartstore.step3": "Application ID 및 Secret 발급",
  "onboarding.channel.smartstore.step4": "스마트스토어 계정과 연동 승인",
  "onboarding.channel.smartstore.step5": "주문/상품 API 권한 확인",
  "onboarding.channel.smartstore.step6": "테스트 환경에서 API 호출 테스트",
  "onboarding.channel.webhook.step1": "웹훅 엔드포인트 URL 준비",
  "onboarding.channel.webhook.step2": "POST 요청을 수신하는지 확인",
  "onboarding.channel.webhook.step3": "필요 시 인증 구성",
  "onboarding.channel.webhook.step4": "연결 테스트",

  // — SetupWizard —
  "onboarding.wizard.sectionsTitle": "설정 항목",
  "onboarding.wizard.section.profile": "프로필",
  "onboarding.wizard.section.preferences": "환경설정",
  "onboarding.wizard.section.workspace": "워크스페이스",
  "onboarding.wizard.section.security": "보안",
  "onboarding.wizard.profileInfo": "프로필 정보",
  "onboarding.wizard.displayName": "표시 이름",
  "onboarding.wizard.displayNamePlaceholder": "이름을 입력하세요",
  "onboarding.wizard.email": "이메일 주소",
  "onboarding.wizard.role": "역할",
  "onboarding.wizard.role.member": "팀원",
  "onboarding.wizard.role.lead": "팀 리드",
  "onboarding.wizard.role.admin": "관리자",
  "onboarding.wizard.role.owner": "소유자",
  "onboarding.wizard.timezone": "시간대",
  "onboarding.wizard.theme": "테마",
  "onboarding.wizard.theme.light": "라이트",
  "onboarding.wizard.theme.dark": "다크",
  "onboarding.wizard.theme.system": "시스템",
  "onboarding.wizard.notifications": "알림",
  "onboarding.wizard.notif.email": "이메일 알림",
  "onboarding.wizard.notif.push": "푸시 알림",
  "onboarding.wizard.notif.sound": "소리 알림",
  "onboarding.wizard.autoSave": "변경사항 자동 저장",
  "onboarding.wizard.workspaceSettings": "워크스페이스 설정",
  "onboarding.wizard.workspaceName": "워크스페이스 이름",
  "onboarding.wizard.workspaceNamePlaceholder": "내 워크스페이스",
  "onboarding.wizard.workspaceType": "워크스페이스 유형",
  "onboarding.wizard.wsType.personal": "개인",
  "onboarding.wizard.wsType.team": "팀",
  "onboarding.wizard.wsType.enterprise": "기업",
  "onboarding.wizard.teamSize": "팀 규모",
  "onboarding.wizard.size.solo": "나 혼자",
  "onboarding.wizard.size.1to10": "1-10명",
  "onboarding.wizard.size.11to50": "11-50명",
  "onboarding.wizard.size.51to200": "51-200명",
  "onboarding.wizard.size.201plus": "201명 이상",
  "onboarding.wizard.securitySettings": "보안 설정",
  "onboarding.wizard.twoFactor": "2단계 인증",
  "onboarding.wizard.twoFactorDesc": "계정에 추가 보안 계층을 더하세요",
  "onboarding.wizard.sessionTimeout": "세션 시간 제한 (분)",
  "onboarding.wizard.ipWhitelist": "IP 주소 화이트리스트",
  "onboarding.wizard.ipWhitelistDesc": "특정 IP 주소로 접근을 제한하세요",
  "onboarding.wizard.configureLater": "나중에 설정하겠습니다",
  "onboarding.wizard.saving": "저장 중...",
  "onboarding.wizard.save": "설정 저장",

  // — CliSetupGate (first-run CLI install/login gate) —
  "onboarding.cliGate.title": "시작하기 전에 — CLI 설치 · 로그인",
  "onboarding.cliGate.subtitle":
    "오케스트레이터를 열려면 먼저 Claude Code 구독 인증(로그인)이 필요합니다. Codex 등은 선택입니다.",
  "onboarding.cliGate.required": "필수",
  "onboarding.cliGate.optional": "선택",
  "onboarding.cliGate.claudeDesc":
    "오케스트레이터와 Claude 에이전트 실행에 필요합니다.",
  "onboarding.cliGate.codexDesc":
    "선택: Codex(GPT) 에이전트를 쓰려면 설치·로그인하세요.",
  "onboarding.cliGate.agyDesc":
    "선택: Antigravity(agy) 에이전트를 쓰려면 설치하세요.",
  // Grok 은 ROWS 에 있는데 설명 문구가 없어 Antigravity 문구를 쓰고 있었다.
  "onboarding.cliGate.grokDesc":
    "선택: Grok(xAI) 에이전트를 쓰려면 설치 후 브라우저로 로그인하세요.",
  "onboarding.cliGate.installFail": "설치 실패",
  "onboarding.cliGate.manualHint":
    "원클릭 설치가 실패했습니다. 터미널에서 아래 명령을 직접 실행하세요:",
  "onboarding.cliGate.checking": "확인 중…",
  "onboarding.cliGate.ready": "준비 완료",
  "onboarding.cliGate.notInstalled": "미설치",
  "onboarding.cliGate.needsLogin": "로그인 필요",
  "onboarding.cliGate.install": "설치",
  "onboarding.cliGate.installing": "설치 중…",
  "onboarding.cliGate.loginHint":
    "터미널에서 아래 명령을 실행해 로그인한 뒤 '다시 확인'을 누르세요:",
  "onboarding.cliGate.copy": "복사",
  "onboarding.cliGate.copied": "복사됨",
  "onboarding.cliGate.recheck": "다시 확인",
  "onboarding.cliGate.continue": "계속",
  "onboarding.cliGate.skip": "나중에",
  "onboarding.cliGate.outdated": "구버전 (v{from} → v{to})",
  "onboarding.cliGate.updateHint":
    "아래 명령으로 최신 버전으로 업데이트하세요:",
  "onboarding.cliGate.runLogin": "인증 실행",
  "onboarding.cliGate.runLoginHint":
    "터미널에서 자동 실행 · 완료되면 자동 인식됩니다",

  // — 원클릭 온보딩 (ticket afW5wNdX) —
  // ①단계: 미설치 CLI 를 한 번에. 개별 [설치] 버튼은 실패한 행 재시도용으로 유지.
  "onboarding.cliGate.installAll.title": "필수 CLI 모두 설치",
  "onboarding.cliGate.installAll.body":
    "아직 설치되지 않은 CLI 만 골라 순서대로 설치합니다. 이미 설치된 것은 건너뜁니다.",
  "onboarding.cliGate.installAll.cta": "모두 설치 ({count}개)",
  "onboarding.cliGate.installAll.running": "설치 중… {done}/{total}",
  "onboarding.cliGate.installAll.done": "{total}개 모두 설치했습니다.",
  "onboarding.cliGate.installAll.partial":
    "{total}개 중 {failed}개 실패 — 실패한 CLI 카드의 수동 명령·공식 문서로 이어서 진행하세요.",
  "onboarding.cliGate.installAll.allDone": "필수 CLI 가 모두 설치돼 있습니다.",
  // ②단계: 터미널 자동생성 + 로그인 명령 자동주입. 사용자는 브라우저 승인만.
  "onboarding.cliGate.signInAll.title": "원클릭 사인인",
  "onboarding.cliGate.signInAll.body":
    "터미널 탭이 자동으로 열리고 로그인 명령이 자동 입력됩니다. 브라우저가 뜨면 승인만 하세요 — 직접 타이핑할 것은 없습니다.",
  "onboarding.cliGate.signInAll.cta": "{cli} 로 사인인",
  "onboarding.cliGate.signInAll.launched":
    "{cli} 터미널을 열고 로그인 명령을 실행했습니다. 브라우저에서 승인해 주세요.",
  "onboarding.cliGate.signInAll.watching": "완료되면 자동으로 인식합니다.",
  "onboarding.cliGate.signInAll.others":
    "다른 CLI {count}개도 각 카드에서 같은 방식으로 사인인할 수 있습니다.",
  "onboarding.cliGate.subscription.title": "구독 없으신가요?",
  "onboarding.cliGate.subscription.body":
    "공식 구독 페이지로 이동해 플랜을 선택할 수 있습니다. 한 번 구독하면 정액으로, per-token 깜짝 청구 없이 플랜 사용한도 내에서 안전하게 사용합니다.",
  "onboarding.cliGate.subscription.byomComplement":
    "구독제는 Claude Code/Codex 계정으로 로그인하는 길이고, 벤더 키는 별도 공급자의 키를 등록하는 길입니다.",
  "onboarding.cliGate.subscription.byomBridge":
    "Claude/Codex 구독 로그인과 벤더 키 등록은 서로 보완되는 두 경로입니다. 구독제는 공식 플랜 한도 안에서 쓰고, 벤더 키는 아래 BYOM 설정에서 별도로 관리합니다.",
  "onboarding.cliGate.subscription.openClaude":
    "Claude Pro/Max 공식 페이지로 이동",
  "onboarding.cliGate.subscription.openCodex":
    "ChatGPT Plus/Pro 공식 페이지로 이동",

  // — CliSetupGate 연결 마법사 스텝 (ticket CecrriY8) —
  "onboarding.cliGate.step.notice": "안내",
  "onboarding.cliGate.step.connect": "연결",
  "onboarding.cliGate.step.project": "시작",
  "onboarding.cliGate.stepOf": "{total}단계 중 {current}단계",
  // 비용 고지 블록 — BYOK 용어를 쓰지 않고 "기존 계정 연결"로 설명한다.
  "onboarding.cliGate.notice.title":
    "설치 전에 — AI 사용료는 포함되지 않습니다",
  "onboarding.cliGate.notice.body":
    "마블로는 Claude Code·Codex 같은 AI CLI를 오케스트레이션합니다. AI 사용료는 마블로 요금에 포함되지 않으며, 이미 쓰고 계신 Claude Code·Codex 계정을 그대로 연결해 사용합니다. 마블로가 별도의 API 키를 요구하지 않습니다.",
  "onboarding.cliGate.notice.b1":
    "이미 구독 중인 Claude Code / Codex 계정을 연결합니다.",
  "onboarding.cliGate.notice.b2":
    "AI 토큰 사용료는 각 CLI 계정으로 청구됩니다 — 마블로 요금과 별개입니다.",
  "onboarding.cliGate.notice.b3":
    "필요한 CLI는 아래 버튼으로 한 번에 설치하고, 로그인은 내장 터미널에서 이어서 진행합니다.",
  "onboarding.cliGate.notice.continue": "원클릭 설치·연결 시작",
  "onboarding.cliGate.back": "이전",
  "onboarding.cliGate.next": "다음",
  // 프로젝트/실행 스텝
  "onboarding.cliGate.project.title": "프로젝트 연결 · 첫 실행",
  "onboarding.cliGate.project.body":
    "오케스트레이터가 맡을 작업이면 폴더를 프로젝트로 연결하세요. 처음이라면 샘플 PRD로 시작해 첫 티켓을 만들어 보세요.",
  "onboarding.cliGate.project.connectFolder": "폴더 연결하고 시작",
  "onboarding.cliGate.project.seedPrd": "샘플 PRD 만들기",
  "onboarding.cliGate.project.seeding": "생성 중…",
  "onboarding.cliGate.project.seeded":
    "PRD.md 를 만들었습니다 — 편집기에서 열렸습니다.",
  "onboarding.cliGate.project.seedFail": "PRD 생성에 실패했습니다.",
  "onboarding.cliGate.project.connected": "연결됨",
  "onboarding.cliGate.project.launching": "오케스트레이터를 실행하는 중…",
  "onboarding.cliGate.project.hint":
    "이 버튼은 폴더를 프로젝트로 등록하고 오케스트레이터를 자동으로 엽니다.",
  "onboarding.cliGate.project.localFolderHint":
    "그냥 로컬 폴더를 열어 파일만 보려면 왼쪽 파일 트리의 폴더 열기 옵션에서 ‘둘러보기’를 선택하세요.",
  "onboarding.cliGate.done": "완료",

  // — CliSetupGate 선형 4스텝 활성화 위저드 (ticket ir94m9C6) —
  // 진행도 표시용 스텝 라벨
  "onboarding.cliGate.step.install": "설치",
  "onboarding.cliGate.step.auth": "인증",
  "onboarding.cliGate.step.prd": "PRD",
  "onboarding.cliGate.step.git": "Git",
  "onboarding.cliGate.step.firstTicket": "첫 티켓",
  // ① 설치
  "onboarding.cliGate.install.title": "① CLI 설치",
  "onboarding.cliGate.install.body":
    "오케스트레이터를 실행할 AI CLI를 설치합니다. 설치 버튼을 누르면 한 번에 진행하고, 실패하면 공식 설치 방법을 안내합니다.",
  "onboarding.cliGate.install.costNote":
    "AI 사용료는 마블로 요금에 포함되지 않습니다 — 이미 쓰고 계신 Claude Code·Codex 계정으로 청구됩니다.",
  "onboarding.cliGate.install.officialHint":
    "원클릭 설치가 막히면(예: EACCES·npm prefix 권한 문제) 아래 명령을 터미널에서 직접 실행하거나 공식 설치 문서를 참고하세요.",
  "onboarding.cliGate.install.official": "공식 설치 문서 열기",
  // ② 인증
  "onboarding.cliGate.auth.title": "② 로그인(인증)",
  "onboarding.cliGate.auth.body":
    "Claude Code 또는 Codex 중 하나만 로그인하면 됩니다. ‘인증 실행’을 누르면 내장 터미널에서 진행되고, 완료되면 자동으로 인식합니다.",
  "onboarding.cliGate.auth.needInstall":
    "먼저 CLI를 설치해야 로그인할 수 있습니다. 설치 단계로 돌아가 주세요.",
  // ③ 샘플 PRD
  "onboarding.cliGate.prd.title": "③ 샘플 PRD",
  "onboarding.cliGate.prd.body":
    "오케스트레이터에게 맡길 폴더를 프로젝트로 연결하고 샘플 PRD로 시작하세요.",
  // ④ Git 준비
  "onboarding.cliGate.git.title": "④ Git 저장소 준비",
  "onboarding.cliGate.git.body":
    "워크트리별 작업을 만들 수 있도록 연결한 폴더가 Git 저장소인지 확인합니다.",
  "onboarding.cliGate.git.confirm":
    "터미널 열고 git init 을 진행하겠습니다. 확인해주세요.",
  "onboarding.cliGate.git.run": "터미널에서 git init 실행",
  "onboarding.cliGate.git.started":
    "터미널에서 git init 을 시작했습니다. 끝나면 다시 확인해 주세요.",
  "onboarding.cliGate.git.startFailed":
    "터미널을 열지 못했습니다. 직접 터미널에서 git init 을 실행한 뒤 다시 확인해 주세요.",
  "onboarding.cliGate.git.alreadyInitialized":
    "이미 Git 저장소입니다. git init 을 다시 실행하지 않습니다.",
  "onboarding.cliGate.git.terminalOpened":
    "git init 터미널을 열었습니다. 실패하면 터미널 출력의 원인을 확인하고 다시 실행하세요.",
  "onboarding.cliGate.git.devGuide":
    "개발 작업은 하네스탭에서 깃 리포 연결을 권장드립니다.",
  "onboarding.cliGate.git.generalGuide":
    "일반 작업은 티켓별로 워크트리가 나뉘어 진행됩니다.",
  // ⑤ 첫 티켓 (아하 모먼트)
  "onboarding.cliGate.firstTicket.title": "⑤ 첫 티켓 만들기",
  "onboarding.cliGate.firstTicket.body":
    "오케스트레이터에게 이 PRD로 첫 티켓을 만들고 에이전트 스폰을 제안하도록 요청합니다. 버튼을 누르면 첫 프롬프트가 전달되고, 오케스트레이터가 작업을 시작하는 것을 지켜보세요.",
  "onboarding.cliGate.firstTicket.create": "이 PRD로 첫 티켓 만들기",
  "onboarding.cliGate.firstTicket.creating": "오케스트레이터에게 전달하는 중…",
  "onboarding.cliGate.firstTicket.sent":
    "첫 프롬프트를 전달했어요 — 오케스트레이터가 첫 티켓을 준비합니다. 잠시 지켜봐 주세요.",
  "onboarding.cliGate.firstTicket.result.delivered.title":
    "첫 티켓이 시작됩니다",
  "onboarding.cliGate.firstTicket.result.queued.title":
    "오케스트레이터가 켜질 때까지 아무 작업도 시작되지 않습니다",
  "onboarding.cliGate.firstTicket.result.failed.title":
    "첫 티켓이 만들어지지 않았습니다",
  "onboarding.cliGate.firstTicket.retry": "다시 시도",
  "onboarding.cliGate.firstTicket.retrying": "다시 시도하는 중…",
  // ★queued ≠ 전달됨. 로컬 오케에 못 넣어서 대기열에만 쌓아 둔 상태다 — 이걸
  //   'sent' 와 같은 초록 문구로 쓰면 신규 유저는 아무 일도 안 일어나는 화면을
  //   성공으로 읽고 이탈한다(활성화 F3). 다음 액션은 아래 needOrch.* 가 안내한다.
  "onboarding.cliGate.firstTicket.queued":
    "아직 전달되지 않았어요 — 대기열에 넣어만 뒀습니다. 이 프로젝트의 오케스트레이터가 실행 중이 아니라서, 지금은 첫 티켓을 만들 상대가 없습니다.",
  "onboarding.cliGate.firstTicket.needOrch.title":
    "오케스트레이터를 띄워야 첫 티켓이 실제로 만들어집니다",
  "onboarding.cliGate.firstTicket.needOrch.step1":
    "오케스트레이터 패널(왼쪽 오케 영역 또는 화면 아래 ‘오케스트레이터’ 바)을 펼치고, 상태가 ‘Stopped’ 면 모델을 고른 뒤 [Start] 를 누르세요.",
  "onboarding.cliGate.firstTicket.needOrch.step2":
    "[Start] 가 CLI 인증에서 막히면 ①설치·②로그인 단계로 돌아가 마저 끝내 주세요. 인증이 되면 오케스트레이터는 자동으로 다시 뜹니다.",
  "onboarding.cliGate.firstTicket.needOrch.step3":
    "오케스트레이터가 실행 중이 되면 위 버튼을 한 번 더 눌러 첫 티켓을 만드세요.",
  "onboarding.cliGate.firstTicket.needOrch.crossMachine":
    "다른 컴퓨터에서 이 프로젝트의 오케스트레이터가 켜져 있다면, 대기열에 넣어 둔 이 프롬프트는 그쪽에서 곧 전달됩니다.",
  "onboarding.cliGate.firstTicket.failed":
    "전달에 실패했어요. 오케스트레이터가 실행 중인지 확인한 뒤 다시 시도해 주세요.",
  "onboarding.cliGate.firstTicket.needProject":
    "먼저 폴더를 연결해 주세요(③ 단계).",
  // 오케스트레이터에게 보낼 첫 프롬프트 — tf-start 첫인사 훅과 연결된다.
  "onboarding.cliGate.firstTicket.prompt":
    "이 프로젝트의 PRD.md를 읽고 그걸로 첫 티켓을 만들어줘. 그리고 이 티켓에 알맞은 에이전트 스폰을 제안해줘.",
  // 샘플 PRD 파일 내용(첫 티켓 유도용, 편집기에서 열림)
  "onboarding.cliGate.prdContent":
    "# 제품 요구사항(PRD)\n\n> 마블로 샘플 PRD 입니다. 아래를 여러분의 목표로 바꾼 뒤, 오케스트레이터에게 '이 PRD로 첫 티켓을 만들어줘'라고 말해 보세요.\n\n## 무엇을 만들까요?\n한 문장으로 목표를 적어 주세요. 예) 방문자가 이메일을 남길 수 있는 간단한 랜딩 페이지.\n\n## 왜 필요한가요?\n이 기능이 해결하는 문제를 적어 주세요.\n\n## 핵심 요구사항\n- [ ] 요구사항 1\n- [ ] 요구사항 2\n- [ ] 요구사항 3\n\n## 완료 기준\n- 무엇이 되면 '완료'인가요?\n",

  // — StartHereTab ('시작하기' 탭 — 팝업에서 승격된 온보딩, ticket ZdgQMxW7) —
  "onboarding.startHere.title": "시작하기",
  "onboarding.startHere.subtitle":
    "네 단계면 첫 티켓까지 갑니다. 진행 상황은 저장되니 언제든 이어서 하세요.",
  "onboarding.startHere.progress": "{total}단계 중 {done}단계 완료",
  "onboarding.startHere.demoLead": "대화가 티켓이 되는 흐름을 먼저 체험할까요?",
  "onboarding.startHere.watchDemo": "영상 데모 보기 · {seconds}초",
  "onboarding.startHere.stuckLabel": "막혔을 때:",
  "onboarding.startHere.skipStep":
    "이 단계는 나중에 하기(목록에 계속 남습니다)",
  "onboarding.startHere.badge.done": "완료",
  "onboarding.startHere.badge.current": "지금 할 차례",
  "onboarding.startHere.badge.remaining": "남음",
  "onboarding.startHere.badge.skipped": "건너뜀 · 남음",
  "onboarding.startHere.allDone.title": "준비 끝났습니다!",
  "onboarding.startHere.allDone.body":
    "첫 티켓을 오케스트레이터에게 넘겼습니다. 보드 탭에서 진행 상황을 지켜보세요.",
  "onboarding.startHere.dontLand": "앱을 켤 때 이 탭으로 시작하지 않기",
  "onboarding.startHere.reenableLanding": "앱을 켤 때 이 탭으로 시작하기",
  "onboarding.startHere.dontLandHint":
    "어느 쪽이든 남은 단계는 이 탭에 그대로 남아 있습니다.",
  "onboarding.startHere.value.kicker": "인증 전 · {seconds}초 영상 데모",
  "onboarding.startHere.value.title":
    "대화 한 줄이 티켓으로 갈라지고 에이전트가 맡는 흐름",
  "onboarding.startHere.value.body":
    "요청→티켓 분해→배정→병렬 작업 흐름을 {seconds}초 영상으로 먼저 확인하세요. CLI·계정 연결 후엔 같은 흐름이 내 프로젝트의 실제 터미널·워크트리에서 돌아갑니다.",
  "onboarding.startHere.value.playVideo": "{seconds}초 데모 보기",
  "onboarding.startHere.value.zeroCost":
    "CLI 실행·AI 호출·과금 없이 · 오케스트레이션 흐름 먼저 확인",
  "onboarding.videoDemo.kicker": "{seconds}초 데모",
  "onboarding.videoDemo.title": "오케스트레이션 영상 데모",
  "onboarding.startHere.activation.kicker": "CLI 연결 + 계정 연동",
  "onboarding.startHere.activation.title":
    "설치가 끝나면 하단 에이전트 탭에서 인증합니다",
  "onboarding.startHere.activation.body":
    "설치 버튼을 누르면 필요한 CLI가 한 번에 깔립니다. 인증이 필요하면 에이전트 터미널에서 claude login 또는 codex login을 완료하고, 마블로가 인증 상태를 감지하면 첫 스폰으로 이어갑니다.",
  "onboarding.startHere.activation.terminalTitle": "하단 에이전트 터미널",
  "onboarding.startHere.activation.autoCreated": "자동 생성",
  "onboarding.startHere.activation.browserAuth":
    "브라우저에서 계정을 확인하고 터미널로 돌아옵니다.",
  "onboarding.startHere.activation.detected":
    "인증 감지됨 — 이제 첫 티켓을 만들 수 있습니다.",
  "onboarding.startHere.activation.step.install.title": "설치",
  "onboarding.startHere.activation.step.install.body":
    "설치 버튼을 누르면 필요한 CLI를 한 번에 설치하고 버전을 확인합니다.",
  "onboarding.startHere.activation.step.terminal.title": "터미널 자동 생성",
  "onboarding.startHere.activation.step.terminal.body":
    "인증이 필요하면 하단 에이전트 탭에 로그인용 터미널이 열립니다.",
  "onboarding.startHere.activation.step.auth.title": "인증",
  "onboarding.startHere.activation.step.auth.body":
    "터미널에서 claude login 또는 codex login을 끝내고 다시 확인합니다.",
  "onboarding.startHere.activation.step.spawn.title": "첫 스폰",
  "onboarding.startHere.activation.step.spawn.body":
    "프로젝트와 PRD를 연결한 뒤 첫 티켓을 보내면 오케스트레이터가 에이전트 배정을 제안합니다.",
  // 왜 필요한지 — 단계마다 한 줄
  "onboarding.startHere.why.install":
    "오케스트레이터와 에이전트는 이 CLI 위에서 돌아갑니다. 없으면 아무것도 실행되지 않습니다.",
  "onboarding.startHere.why.auth":
    "이미 쓰고 계신 AI 계정을 연결하는 단계입니다. 인증이 없으면 스폰이 조용히 실패합니다.",
  "onboarding.startHere.why.prd":
    "작업을 맡길 때는 프로젝트 연결이 필요합니다. 단순히 로컬 폴더를 열어 보는 길은 파일 트리에 따로 있습니다.",
  "onboarding.startHere.why.git":
    "워크트리 생성에는 Git 저장소가 필요합니다. 확인 전에는 폴더를 바꾸지 않습니다.",
  "onboarding.startHere.why.firstTicket":
    "첫 티켓을 만들어 봐야 마블로가 실제로 무엇을 해주는지 보입니다.",
  // 막혔을 때의 대안 — 단계마다 한 줄
  "onboarding.startHere.alt.install":
    "원클릭 설치가 실패하면(EACCES·npm prefix 권한 등) 위에 뜨는 명령을 터미널에서 직접 실행하거나 공식 설치 문서를 따라가세요.",
  "onboarding.startHere.alt.auth":
    "Claude Code 와 Codex 중 하나만 로그인하면 됩니다. 브라우저 인증이 막히면 명령을 복사해 터미널에서 직접 실행하세요.",
  "onboarding.startHere.alt.prd":
    "빈 폴더로 시작해도 됩니다. 비워크트리 폴더를 보기만 하려면 파일 트리의 ‘폴더 열기 옵션’에서 둘러보기를 쓰세요.",
  "onboarding.startHere.alt.git":
    "실패하면 터미널 출력의 원인을 확인하고, 폴더 연결은 유지한 채 git init 을 다시 실행하세요.",
  "onboarding.startHere.alt.firstTicket":
    "전달이 실패하면 오케스트레이터 터미널이 떠 있는지 확인한 뒤 다시 눌러 주세요.",
  // 인라인 배너(모달 대체) — 온보딩이 아직 남아 있는 순간.
  // ★제목은 단계별로 갈라야 한다. 예전엔 "CLI 인증이 필요합니다" 한 문장이
  //   고정이라, 인증을 마치고 폴더만 없는 유저에게 제목은 "인증 필요"인데
  //   본문(why.prd)은 "폴더를 연결해야…" 라고 서로 다른 말을 했다 (장벽 F2).
  "onboarding.startHere.banner.title.install":
    "오케스트레이터 CLI 설치가 필요합니다",
  "onboarding.startHere.banner.title.auth": "CLI 인증이 필요합니다",
  "onboarding.startHere.banner.title.prd": "작업할 폴더를 연결해 주세요",
  "onboarding.startHere.banner.title.git": "Git 저장소 준비가 필요합니다",
  "onboarding.startHere.banner.title.firstTicket": "첫 티켓만 만들면 끝납니다",
  "onboarding.startHere.banner.cta": "시작하기 열기",
  "onboarding.startHere.banner.dismiss": "이 안내 닫기(다시 띄우지 않기)",
  // 권장: 깃 리포 연결 → 티켓별 독립 워크트리 (YTpcEK5Ow5LIldkJJzQc)
  "onboarding.startHere.worktreeRecommend.badge": "권장",
  "onboarding.startHere.worktreeRecommend.title":
    "깃 리포를 연결하면 독립 워크트리가 자동입니다",
  "onboarding.startHere.worktreeRecommend.body":
    "개발 작업은 하네스탭에서 깃 리포 연결을 권장드립니다. 일반 작업은 티켓별로 워크트리가 나뉘어 진행됩니다.",

  // — 시작하기 탭: 다른 벤더 모델 붙이기 (XHXSIdPN) —
  // ★벤더 이름·모델 id 가 이 표에 하나도 없다. 목록은 model-registry 파생이고
  //   여기 있는 것은 "첫 켰을 때 무엇을 해야 켜지나" 라는 행동 문구뿐이다.
  //   엔드포인트·1M 컨텍스트·검증 런북 같은 상세는 중복하지 않는다 —
  //   docs/VENDOR-MODEL-USAGE-GUIDE.md 가 그쪽 단일소스다.
  "onboarding.startHere.vendors.title": "다른 벤더 모델도 붙일 수 있어요",
  "onboarding.startHere.vendors.subtitle":
    "①②단계가 Claude·Codex 입니다. 아래는 선택이고, 벤더마다 처음 한 번만 하면 됩니다.",
  "onboarding.startHere.vendors.summary": "{total}개 중 {ready}개 사용 가능",
  "onboarding.startHere.vendors.loading": "모델 목록을 불러오는 중…",
  "onboarding.startHere.vendors.loadFailed": "모델 목록을 불러오지 못했습니다.",
  "onboarding.startHere.vendors.retry": "다시 시도",
  // {command} = 이 벤더가 실제로 스폰하는 바이너리 이름(레지스트리 파생).
  // ★자체 CLI 벤더(Grok)엔 이런 줄이 없다 — 그쪽은 ①②단계와 같은 행 카드를
  //   그대로 재사용하므로 설명도 `onboarding.cliGate.*Desc` 를 쓴다.
  "onboarding.startHere.vendors.kind.envSwap":
    "이미 쓰는 {command} 를 그대로 씁니다 — 새 CLI 없이 구독키만 등록하면 켜집니다.",
  "onboarding.startHere.vendors.status.ready": "사용 가능",
  "onboarding.startHere.vendors.status.needsKey": "키 필요",
  "onboarding.startHere.vendors.status.needsInstall": "설치 필요",
  "onboarding.startHere.vendors.status.needsLogin": "로그인 필요",
  "onboarding.startHere.vendors.status.unknown": "확인 중",
  // {keys} = 필요한 env 키 **이름**만. 값은 렌더러에 오지 않는다.
  "onboarding.startHere.vendors.key.hint":
    "필요한 키: {keys} — 값은 OS 키체인에 암호화 저장되고 화면으로 다시 나오지 않습니다.",
  "onboarding.startHere.vendors.key.placeholder": "{key} 붙여넣기",
  "onboarding.startHere.vendors.key.save": "키 저장",
  "onboarding.startHere.vendors.key.saving": "저장 중...",
  "onboarding.startHere.vendors.key.saved": "키를 안전 저장했습니다.",
  "onboarding.startHere.vendors.key.error": "키 저장에 실패했습니다.",
  "onboarding.startHere.vendors.key.settings": "고급 설정",
  "onboarding.startHere.vendors.key.cta": "설정에서 키 등록하기",
  "onboarding.startHere.vendors.key.recheck": "등록 상태 다시 확인",
  "onboarding.startHere.vendors.key.ready":
    "키가 등록돼 있습니다. 아래처럼 모델을 지정해 바로 띄우세요(키 등록 뒤 새로 스폰하는 에이전트부터 적용됩니다).",
  "onboarding.startHere.vendors.dispatchLabel":
    "띄우는 법 — 오케스트레이터에게 이렇게 말하세요",
  // {model} = 사용자가 위 칩에서 고른 구체 모델 id(레지스트리 파생).
  "onboarding.startHere.vendors.dispatchSnippet":
    'dispatch_task(role="backend", instruction="…", model="{model}")',
  "onboarding.startHere.vendors.guideLead":
    "엔드포인트·컨텍스트·검증 런북 등 상세는 이 문서에 있습니다:",

  // — ②단계의 BYOM 대안 (활성화 F4) —
  // ★여기에도 벤더 이름이 없다. 목록은 레지스트리 파생이고, 이 표에 있는 것은
  //   "계정이 없어도 시작할 수 있다" 는 사실과 그 조건뿐이다.
  "onboarding.byom.title": "계정이 없나요? 벤더 키로 시작하기",
  "onboarding.byom.headline.ready":
    "등록된 벤더 키로 바로 시작할 수 있습니다 — Claude·Codex 계정 없이 다음 단계로 가세요.",
  "onboarding.byom.headline.workerOnly":
    "쓸 수 있는 벤더가 있습니다. 다만 오케스트레이터는 아직 Claude·Codex 로만 뜨므로, 이 벤더들은 작업 에이전트로 지정해 쓰세요.",
  "onboarding.byom.headline.setup":
    "Claude·Codex 계정 대신 이미 쓰는 다른 AI 구독의 키로 시작할 수 있습니다. 벤더마다 처음 한 번만 등록하면 됩니다.",
  "onboarding.byom.headline.none":
    "지금 이 빌드에 붙일 수 있는 다른 벤더가 없습니다.",
  "onboarding.byom.canHostOrchestrator":
    "✓ 이 벤더로 오케스트레이터까지 띄울 수 있습니다 — 이 단계를 이걸로 통과할 수 있어요.",
  // ★이 줄이 화면의 정직성이다. 지우거나 흐리게 만들지 말 것 — 이 문구가 없으면
  //   사용자는 ②단계를 넘긴 뒤 ④단계(첫 티켓)에서 이유 없이 막힌다.
  "onboarding.byom.workerOnlyNote":
    "이 벤더는 아직 작업 에이전트 전용입니다. 오케스트레이터(티켓을 만들고 에이전트를 배치하는 쪽)는 Claude·Codex 계정이 필요해서, 이 벤더만으로는 이 단계를 넘길 수 없습니다.",

  // — LoginPage (auth) —
  "onboarding.login.signupSubtitle": "새 계정을 만드세요",
  "onboarding.login.loginSubtitle": "계정에 로그인하세요",
  "onboarding.login.google": "Google로 로그인",
  "onboarding.login.github": "GitHub로 로그인",
  "onboarding.login.or": "또는",
  "onboarding.login.email": "이메일",
  "onboarding.login.password": "비밀번호",
  "onboarding.login.marketingConsentLabel":
    "마블로 소식·업데이트 이메일 수신 동의 (선택)",
  "onboarding.login.marketingConsentHint":
    "team@marblo.app 발신 제품 소식, 업데이트, 베타 안내를 받을 수 있습니다. 동의하지 않아도 가입과 이용에는 영향이 없습니다.",
  "onboarding.login.signupButton": "회원가입",
  "onboarding.login.loginButton": "로그인",
  "onboarding.login.haveAccount": "이미 계정이 있나요?",
  "onboarding.login.noAccount": "아직 계정이 없나요?",

  // — LoginPage: 인증 전 데모 진입점 (Demo Mode P3, ticket qQLGS3NW) —
  "onboarding.login.demoLead": "마블로가 어떻게 동작하는지 먼저 볼까요?",
  // {seconds} — 위 startHere.watchDemo 와 같은 실측값이 들어간다.
  "onboarding.login.watchDemo": "{seconds}초 데모 보기",

  // — DemoMode (인증 전 샘플 데모 재생, 2막 구성) —
  // ★대사 길이가 곧 재생 지연이다: demoScript.ts 가 아래 ko 문자열의 글자 수를
  //   세어(한글 분당 400자) step 지연을 계산한다. 대사를 고치면 총 재생시간과
  //   watchDemo 라벨의 {seconds} 가 함께 움직인다.
  "onboarding.demo.badge": "샘플 데모",
  "onboarding.demo.title":
    "오케스트레이터가 티켓을 분해하고 에이전트를 배정합니다",
  "onboarding.demo.disclaimer":
    "실제 CLI 실행·AI 호출·과금 없이 재생되는 미리보기입니다.",
  "onboarding.demo.close": "닫기",
  "onboarding.demo.orchestrator": "오케스트레이터",
  "onboarding.demo.thinking": "생각하는 중…",
  "onboarding.demo.board": "작업 보드",
  "onboarding.demo.status.queued": "대기",
  "onboarding.demo.status.analyzing": "분석 중",
  "onboarding.demo.status.running": "진행 중",
  "onboarding.demo.status.done": "완료",
  "onboarding.demo.col.todo": "대기",
  "onboarding.demo.col.doing": "진행 중",
  "onboarding.demo.col.done": "완료",
  "onboarding.demo.agentWorking": "작업 중",
  "onboarding.demo.playing": "샘플 시나리오를 재생하는 중…",
  "onboarding.demo.paused": "일시정지됨 — 이어서 보려면 재개를 누르세요.",
  "onboarding.demo.skip": "이 막 건너뛰기",
  "onboarding.demo.replay": "처음부터 다시 보기",
  "onboarding.demo.pause": "일시정지",
  "onboarding.demo.resume": "재개",
  "onboarding.demo.nextStep": "다음 단계",
  "onboarding.demo.cta": "이제 내 계정을 연결해 실제로 실행하기",
  // 막(챕터) 구조
  "onboarding.demo.act.indicator": "{current}/{total}막",
  "onboarding.demo.act1.name": "1막 · PRD 로 프로젝트 열기",
  "onboarding.demo.act2.name": "2막 · 추가 임무 붙이기",
  "onboarding.demo.act1.request": "랜딩 페이지 만들기",
  "onboarding.demo.act2.request": "구독자 관리 화면 추가",
  "onboarding.demo.nextAct": "이어서 2막 · 추가 임무 붙이기 보기",
  "onboarding.demo.actDone": "1막이 끝났습니다. 실전에서는 여기서 멈추지 않죠.",
  // 티켓 카드 — 1막(PRD 분해 결과)
  "onboarding.demo.sub.frontend": "랜딩 페이지 UI 와 이메일 폼 구현",
  "onboarding.demo.sub.backend": "이메일 수집 API 엔드포인트 작성",
  "onboarding.demo.sub.test": "폼 제출 플로우 E2E 테스트",
  // 티켓 카드 — 2막(/tf-add 로 얹은 것)
  "onboarding.demo.sub.subApi": "구독자 조회 API + 검색 파라미터",
  "onboarding.demo.sub.subUi": "구독자 목록 화면 · CSV 내보내기",
  "onboarding.demo.role.frontend": "프론트엔드",
  "onboarding.demo.role.backend": "백엔드",
  "onboarding.demo.role.test": "테스트",
  "onboarding.demo.carriedOver": "1막에서 완료",
  "onboarding.demo.scheduled": "예약됨",
  "onboarding.demo.blockedBy": "선행 티켓 대기",
  // — 1막 대사: 사용자가 PRD 를 쓰고 /tf-start 로 프로젝트를 연다 —
  // ★한 줄이 길어지면 그 step 이 통째로 길어진다. 대사는 한 호흡(≈35자) 안에서
  //   끊고, 할 말이 남으면 step 을 하나 더 쓴다 — 그래야 clamp 가 아니라 실측이
  //   재생시간을 정한다(demoScript.ts 의 STEP_MAX_MS 불변식).
  "onboarding.demo.a1.user": "PRD.md 에 만들 것을 적어 뒀어요.",
  "onboarding.demo.a1.cmd": "/tf-start PRD.md",
  "onboarding.demo.a1.cmdHint": "처음 한 번은 PRD 와 함께 /tf-start 로 엽니다.",
  "onboarding.demo.a1.readPrd": "PRD 를 읽었어요. 요구사항 3개를 찾았습니다.",
  "onboarding.demo.a1.decompose": "티켓 3개로 분해해 보드에 올렸어요.",
  "onboarding.demo.a1.assign": "각 티켓에 알맞은 에이전트를 배정합니다.",
  "onboarding.demo.a1.claudeStart": "프론트엔드 · 테스트를 맡았습니다.",
  "onboarding.demo.a1.codexStart": "백엔드 API 를 맡았습니다.",
  "onboarding.demo.a1.working": "격리된 워크트리에서 병렬로 작업 중이에요.",
  "onboarding.demo.a1.done":
    "티켓 3개가 모두 끝났습니다. 실제로는 각 티켓이 PR 까지 이어집니다.",
  // — 2막 대사: 그다음부터는 /tf-add 뒤에 프롬프트를 이어 쓴다 —
  "onboarding.demo.a2.user":
    "요구가 하나 늘었어요. 관리자용 구독자 목록 화면이 필요합니다.",
  // ★커맨드와 프롬프트는 두 비트로 나뉘어 순서대로 등장한다(demoScript.ts 의
  //   act2 log). 붙여 쓰면 "/tf-add 구독자 목록 화면. 이메일 검색과 CSV 내보내기."
  //   한 줄 — 사람이 치는 순서를 보이려고 나눠 둔 것이니 다시 합치지 말 것.
  "onboarding.demo.a2.cmd": "/tf-add",
  "onboarding.demo.a2.prompt": "구독자 목록 화면. 이메일 검색과 CSV 내보내기.",
  "onboarding.demo.a2.cmdHint":
    "그다음부터는 /tf-add 뒤에 원하는 것을 그대로 쓰면 됩니다.",
  "onboarding.demo.a2.ingest":
    "돌아가던 보드는 그대로 두고 새 티켓 2개를 얹었어요.",
  "onboarding.demo.a2.dependency":
    "목록 화면은 조회 API 가 먼저라 예약해 뒀어요.",
  "onboarding.demo.a2.codexStart": "구독자 조회 API 를 맡았습니다.",
  "onboarding.demo.a2.unblocked": "선행이 끝나 예약이 풀렸어요.",
  "onboarding.demo.a2.claudeStart": "목록 화면을 바로 시작합니다.",
  "onboarding.demo.a2.done":
    "추가 임무까지 끝났습니다 🎉 — 프로젝트가 도는 동안 /tf-add 로 계속 얹으면 됩니다.",

  // — L0 온램프: 룰 분해 카드 (설계 v3/docs/onramp-ladder-design-2026-08-09.md §4) —
  // ★데모(위)와 역할이 다르다: 데모는 **본다**, 이 카드는 **만든다**. 문구가 그
  //   경계를 말하지 않으면 두 표면이 중복으로 읽힌다(설계 R4).
  "onramp.decompose.title": "먼저, 내 말로 티켓을 만들어 보세요",
  "onramp.decompose.body":
    "하고 싶은 일을 한 문장으로 쓰면 진짜 보드에 진짜 티켓으로 쪼개 드립니다. 계정 연결 전이라 비용은 들지 않아요.",
  "onramp.decompose.placeholder": "예) 로그인 화면이랑 인증 API 가 필요해요",
  "onramp.decompose.cta": "데모로 티켓 만들어보기",
  "onramp.decompose.working": "쪼개는 중…",
  "onramp.decompose.zeroCost": "무료 · 계정 연결 불필요",
  "onramp.decompose.example1": "로그인 화면이랑 인증 API 만들어줘",
  "onramp.decompose.example2": "결제창 붙이고 결제 결과 검증까지",
  "onramp.decompose.example3": "구독자 목록 화면에 검색 기능 추가",
  "onramp.decompose.result": "티켓 {count}장을 보드에 올렸어요.",
  "onramp.decompose.resultHint":
    "이 티켓들은 진짜입니다 — 보드에 그대로 남아 있고, 계정을 연결하면 그대로 실행됩니다.",
  // ★정직성 규칙(설계 §4-D): 규칙이 확신 못 했을 때 화면이 그렇게 말한다.
  //   초안을 완성품처럼 팔지 않는 것이 룰베이스에서 가능한 유일한 방어다.
  "onramp.decompose.fallbackNote":
    "대략 이런 모양으로 쪼갤 수 있어요. 계정을 연결하면 오케스트레이터가 실제 코드를 읽고 다시 쪼갭니다.",
  "onramp.decompose.partial":
    "일부 티켓만 만들어졌어요. 잠시 후 다시 시도해 주세요.",
  "onramp.decompose.failed":
    "티켓을 만들지 못했어요. 잠시 후 다시 시도해 주세요.",
  "onramp.decompose.preparing":
    "샘플 프로젝트를 준비하는 중이에요. 곧 쓸 수 있습니다.",
  "onramp.decompose.noProject":
    "티켓을 올릴 폴더가 아직 없어요. 폴더를 연결하면 여기서 바로 만들 수 있습니다.",
  "onramp.decompose.remaining": "데모로 {count}번 더 쪼갤 수 있어요",
  "onramp.decompose.limitTitle": "데모로 만들 수 있는 티켓을 다 만들었어요",
  "onramp.decompose.limitBody":
    "여기까지는 계정 없이 볼 수 있는 범위예요. 계정을 연결하면 이 티켓들을 실제로 실행할 수 있습니다.",
  "onramp.decompose.limitCta": "연결하고 실행하기",
  "onramp.decompose.runCta": "이 티켓 실행하기",
  "onramp.decompose.openBoard": "보드에서 보기 (데모 티켓 {count}장)",
  "onramp.decompose.dependsOn": "선행 필요",
  "onramp.decompose.role.frontend": "프론트엔드",
  "onramp.decompose.role.backend": "백엔드",
  "onramp.decompose.role.test": "테스트",
  "onramp.decompose.role.devops": "데브옵스",

  // — L0 온램프: M1 실행 차단 모달 (설계 §5-A) —
  // ★이미 있는 게이트(checkSpawnAuthGate)에 처음으로 목소리를 주는 자리다.
  //   지금까지 이 차단은 비기너 셸에서 **아무 화면도 만들지 않았다**.
  "onramp.block.title": "여기까지는 무료로 볼 수 있어요",
  "onramp.block.body":
    "이 티켓들은 진짜입니다 — 보드에 그대로 남아 있어요. 실제로 실행하려면 코딩 CLI 계정 하나만 연결하면 됩니다. 추가 비용은 없어요 — 이미 쓰고 계신 구독을 그대로 씁니다.",
  "onramp.block.cta.connect": "{cli} 연결하기",
  "onramp.block.cta.install": "{cli} 설치하고 연결하기",
  "onramp.block.alt": "다른 방법 보기",
  "onramp.block.altHint": "이미 API 키가 있다면 그 키로 시작할 수 있어요.",
  "onramp.block.ghost": "티켓만 더 만들어 볼게요",
  "onramp.block.close": "닫기",
  "onramp.block.reason.limit": "데모 분해 한도에 도달했어요.",
  "onramp.block.reason.run": "실행은 계정 연결 뒤부터 가능합니다.",

  // — 첫 스폰 가이드 — 오케 터미널 바로 위, 접고 펼 수 있는 인라인 패널
  // (티켓 YYD71y0KU8cNhIFI5YSu). 연결 + 폴더가 끝나 오케 대화창이 뜬 화면에
  // 항상 함께 있다 — 오버레이가 아니라 대상 창과 같은 화면에 있어야
  // "무엇을 쳐야 하는지" 가 가려지지 않는다. 여기 안내하는 명령은 전부
  // 번들 18종 안(SlashCommandPopup.SLASH_COMMANDS)에서만 고른다.
  "onboarding.firstSpawn.title": "이제 오케에게 뭘 시키나요?",
  "onboarding.firstSpawn.small.badge": "작은 일",
  "onboarding.firstSpawn.small.desc": "티켓 하나 열고 에이전트를 스폰해요.",
  "onboarding.firstSpawn.small.step1": "티켓 열기",
  "onboarding.firstSpawn.small.step2": "에이전트 스폰",
  "onboarding.firstSpawn.big.badge": "큰 일",
  "onboarding.firstSpawn.big.desc":
    "PRD부터 써서 태스크 생성과 스폰을 한 번에 해요.",
  "onboarding.firstSpawn.big.step1": "PRD 작성",
  // ★/tf-start 는 태스크 생성 + 스폰을 한 번에 한다 — "만들고 그 다음
  // 스폰" 으로 쪼개 쓰지 말 것(오케 원문: Create tasks from the PRD and
  // spawn agents).
  "onboarding.firstSpawn.big.step2": "태스크 생성 + 스폰 한 번에",
  // ★접힌 바에 얹히는 명령 칩 묶음의 접근성 라벨. 명령 자체는 접혀 있어도
  // 보이고, 펼침 패널은 "언제 어느 경로냐" 를 두 카드로 설명한다.
  "onboarding.firstSpawn.commandsLabel": "시작 명령",
  "onboarding.firstSpawn.allCommands": "전체 명령은 왼쪽 커맨드 메뉴에서.",
  "onboarding.firstSpawn.guideHint": "뭘 쓸지 모르겠으면",
  "onboarding.firstSpawn.send": "보내기",
  "onboarding.firstSpawn.sent": "보냈어요",
  "onboarding.firstSpawn.collapse": "접기",
  "onboarding.firstSpawn.expand": "펼치기",
};
