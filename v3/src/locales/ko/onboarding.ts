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
  "onboarding.cliGate.installFail": "설치 실패",
  "onboarding.cliGate.manualHint":
    "자동 설치가 실패했습니다. 터미널에서 아래 명령을 직접 실행하세요:",
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
    "필요한 CLI는 아래에서 자동으로 감지·설치하고, 로그인은 내장 터미널에서 한 번에 진행합니다.",
  "onboarding.cliGate.notice.continue": "설치·연결 시작",
  "onboarding.cliGate.back": "이전",
  "onboarding.cliGate.next": "다음",
  // 프로젝트/실행 스텝
  "onboarding.cliGate.project.title": "프로젝트 연결 · 첫 실행",
  "onboarding.cliGate.project.body":
    "작업할 폴더를 연결하면 오케스트레이터가 자동으로 열립니다. 처음이라면 샘플 PRD로 시작해 첫 티켓을 만들어 보세요.",
  "onboarding.cliGate.project.connectFolder": "폴더 연결하고 시작",
  "onboarding.cliGate.project.seedPrd": "샘플 PRD 만들기",
  "onboarding.cliGate.project.seeding": "생성 중…",
  "onboarding.cliGate.project.seeded":
    "PRD.md 를 만들었습니다 — 편집기에서 열렸습니다.",
  "onboarding.cliGate.project.seedFail": "PRD 생성에 실패했습니다.",
  "onboarding.cliGate.project.connected": "연결됨",
  "onboarding.cliGate.project.launching": "오케스트레이터를 실행하는 중…",
  "onboarding.cliGate.project.hint":
    "폴더를 연결하면 이 마법사는 자동으로 닫히고 오케스트레이터가 첫 인사를 건넵니다.",
  "onboarding.cliGate.done": "완료",
  // 샘플 PRD 파일 내용(첫 티켓 유도용, 편집기에서 열림)
  "onboarding.cliGate.prdContent":
    "# 제품 요구사항(PRD)\n\n> 마블로 샘플 PRD 입니다. 아래를 여러분의 목표로 바꾼 뒤, 오케스트레이터에게 '이 PRD로 첫 티켓을 만들어줘'라고 말해 보세요.\n\n## 무엇을 만들까요?\n한 문장으로 목표를 적어 주세요. 예) 방문자가 이메일을 남길 수 있는 간단한 랜딩 페이지.\n\n## 왜 필요한가요?\n이 기능이 해결하는 문제를 적어 주세요.\n\n## 핵심 요구사항\n- [ ] 요구사항 1\n- [ ] 요구사항 2\n- [ ] 요구사항 3\n\n## 완료 기준\n- 무엇이 되면 '완료'인가요?\n",

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
  "onboarding.login.watchDemo": "60초 데모 보기",

  // — DemoMode (인증 전 샘플 데모 재생) —
  "onboarding.demo.badge": "샘플 데모",
  "onboarding.demo.title":
    "오케스트레이터가 티켓을 분해하고 에이전트를 배정합니다",
  "onboarding.demo.disclaimer":
    "실제 CLI 실행·AI 호출·과금 없이 재생되는 미리보기입니다.",
  "onboarding.demo.close": "닫기",
  "onboarding.demo.orchestrator": "오케스트레이터",
  "onboarding.demo.thinking": "생각하는 중…",
  "onboarding.demo.board": "작업 보드",
  "onboarding.demo.request": "랜딩 페이지 만들기",
  "onboarding.demo.status.queued": "대기",
  "onboarding.demo.status.analyzing": "분석 중",
  "onboarding.demo.status.running": "진행 중",
  "onboarding.demo.status.done": "완료",
  "onboarding.demo.col.todo": "대기",
  "onboarding.demo.col.doing": "진행 중",
  "onboarding.demo.col.done": "완료",
  "onboarding.demo.agentWorking": "작업 중",
  "onboarding.demo.playing": "샘플 시나리오를 재생하는 중…",
  "onboarding.demo.skip": "건너뛰기",
  "onboarding.demo.replay": "다시 보기",
  "onboarding.demo.cta": "이제 내 계정을 연결해 실제로 실행하기",
  // 하위 작업(분해 결과) — 카드 제목/역할
  "onboarding.demo.sub.frontend": "랜딩 페이지 UI 와 이메일 폼 구현",
  "onboarding.demo.sub.backend": "이메일 수집 API 엔드포인트 작성",
  "onboarding.demo.sub.test": "폼 제출 플로우 E2E 테스트",
  "onboarding.demo.role.frontend": "프론트엔드",
  "onboarding.demo.role.backend": "백엔드",
  "onboarding.demo.role.test": "테스트",
  // 오케 대화 로그(스크립트)
  "onboarding.demo.msg.user": "이 PRD로 첫 티켓을 만들어 주세요.",
  "onboarding.demo.msg.analyze": "요구사항을 분석하고 있어요…",
  "onboarding.demo.msg.decompose":
    "요청을 3개의 하위 작업으로 분해했어요 — 프론트엔드 · 백엔드 · 테스트.",
  "onboarding.demo.msg.assign": "각 작업에 알맞은 에이전트를 배정합니다.",
  "onboarding.demo.msg.claudeStart":
    "프론트엔드 · 테스트 작업을 맡았어요. 시작합니다.",
  "onboarding.demo.msg.codexStart": "백엔드 API 작업을 맡았어요. 시작합니다.",
  "onboarding.demo.msg.working":
    "에이전트들이 병렬로 작업 중이에요. 진행 상황이 보드에 실시간 반영됩니다.",
  "onboarding.demo.msg.done":
    "첫 티켓이 완료됐어요 🎉 — 실제로는 여러분의 코드에 커밋까지 이어집니다.",
};
