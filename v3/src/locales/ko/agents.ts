/**
 * Korean — `agents.*` namespace (Agent Dashboard surface). Keys keep their
 * dotted form.
 */
export const agents = {
  "agents.dashboard.title": "Agent Dashboard",
  "agents.dashboard.addAgent": "에이전트 추가",
  "agents.dashboard.cleanup": "정리",
  "agents.dashboard.cleanupConfirm":
    "{count}개의 비활성 에이전트를 삭제하시겠습니까?\n(working 상태 제외)",
  "agents.dashboard.loading": "에이전트 로딩 중...",

  // ── Usage Dashboard ─────────────────────────────────────────
  "agents.usage.note.claude":
    "Max 구독: 무제한 (5분 쿨다운) / Pro: 일일 제한 있음",
  "agents.usage.note.gpt": "ChatGPT 구독 — rate limit 기반",
  "agents.usage.note.gemini": "무료: 15 RPM, 1M TPM / 유료: 무제한",
  "agents.usage.empty": "에이전트를 추가하면 사용량이 여기에 표시됩니다.",
  "agents.usage.gauge.rateLimit": "구독: {planLabel} · 한도 사용률",
  "agents.usage.gauge.activity": "구독: {planLabel} · 활동량",
  "agents.usage.level.idle": "대기",
  "agents.usage.level.low": "낮음",
  "agents.usage.level.medium": "보통",
  "agents.usage.level.high": "높음",
  "agents.usage.hiddenNotice": "집계/합계는 숨긴 에이전트까지 포함합니다.",
  "agents.usage.showOlder": "오래된 항목 {count}개 더 보기",
  "agents.usage.hideOlder": "오래된 항목 접기",
  "agents.usage.noVisibleAgents":
    "최근 7일 사용량 또는 활성 에이전트가 없습니다.",
  // 하네스 그룹 안 막대가 하위모델 id 로 접혀 있을 때, 그 한 줄이 몇 개
  // 에이전트를 합친 것인지 알려주는 툴팁.
  "agents.usage.submodelAgentCount": "{n}개 에이전트 합산",

  // ── Guide: CLI comparison table ─────────────────────────────
  "agents.guide.cliCompare.title": "AI CLI 비교",
  "agents.guide.cliCompare.col.model": "모델",
  "agents.guide.cliCompare.col.free": "무료 사용",
  "agents.guide.cliCompare.col.strength": "강점",
  "agents.guide.cliCompare.col.install": "설치",
  "agents.guide.cliCompare.claude.free": "Pro/Max 구독 포함",
  "agents.guide.cliCompare.claude.strength":
    "코드 품질, 아키텍처 설계, 복잡한 리팩토링",
  "agents.guide.cliCompare.codex.free": "신규 $5 크레딧",
  "agents.guide.cliCompare.codex.strength": "빠른 반복, API 연동, 간단한 수정",
  "agents.guide.cliCompare.gemini.free": "15 RPM 무료",
  "agents.guide.cliCompare.gemini.strength":
    "긴 컨텍스트(1M), 대규모 코드 분석",

  // ── Guide: which agent to use ───────────────────────────────
  "agents.guide.which.title": "어떤 에이전트를 써야 할까?",
  "agents.guide.which.claude.0": "복잡한 아키텍처 설계/리팩토링",
  "agents.guide.which.claude.1": "코드 리뷰 + 보안 분석",
  "agents.guide.which.claude.2": "멀티파일 변경이 필요한 기능 구현",
  "agents.guide.which.claude.3": "MCP 도구 연동 (Marblo 태스크 관리)",
  "agents.guide.which.codex.0": "빠른 버그 수정 + 핫픽스",
  "agents.guide.which.codex.1": "API 엔드포인트 추가",
  "agents.guide.which.codex.2": "테스트 코드 작성",
  "agents.guide.which.codex.3": "간단한 CRUD 구현",
  "agents.guide.which.gemini.0": "대규모 코드베이스 분석 (1M 토큰 컨텍스트)",
  "agents.guide.which.gemini.1": "문서 생성 + 코드 설명",
  "agents.guide.which.gemini.2": "레거시 코드 이해 + 마이그레이션 계획",
  "agents.guide.which.gemini.3": "비용 절약이 필요한 반복 작업",

  // ── Guide: multi-agent strategy ─────────────────────────────
  "agents.guide.strategy.title": "멀티 에이전트 전략",
  "agents.guide.strategy.independent.title": "독립 에이전트 (분리형)",
  "agents.guide.strategy.independent.when":
    "서로 다른 파일/모듈을 동시에 작업할 때",
  "agents.guide.strategy.independent.example":
    "프론트엔드 에이전트 + 백엔드 에이전트를 각각 실행하여 병렬 개발",
  "agents.guide.strategy.independent.tip":
    "Git 충돌 방지를 위해 작업 범위(scope)를 명확히 분리하세요",
  "agents.guide.strategy.mixed.title": "혼합 모델 전략",
  "agents.guide.strategy.mixed.when": "비용 최적화 + 품질 균형이 필요할 때",
  "agents.guide.strategy.mixed.example":
    "Claude로 아키텍처 설계 → Codex로 반복 구현 → Gemini로 코드 리뷰",
  "agents.guide.strategy.mixed.tip":
    "복잡한 작업은 Claude, 단순 반복은 Codex/Gemini로 비용을 절감하세요",
  "agents.guide.strategy.single.title": "단일 에이전트 (집중형)",
  "agents.guide.strategy.single.when": "하나의 복잡한 작업에 집중할 때",
  "agents.guide.strategy.single.example":
    "대규모 리팩토링, 새로운 기능의 전체 구현",
  "agents.guide.strategy.single.tip":
    "컨텍스트가 중요한 작업은 하나의 에이전트에 맡기는 것이 효율적입니다",

  // ── Guide: setup instructions ───────────────────────────────
  "agents.guide.setup.title": "설치 가이드",
  "agents.guide.setup.step1.title": "CLI 설치",
  "agents.guide.setup.step1.code":
    "curl -fsSL https://claude.ai/install.sh | bash        # Claude\ncurl -fsSL https://chatgpt.com/codex/install.sh | sh   # Codex\nnpm install -g @google/gemini-cli                      # Gemini",
  "agents.guide.setup.step2.title": "인증 설정",
  "agents.guide.setup.step2.code":
    "# Claude: ANTHROPIC_API_KEY 환경변수 또는 Pro/Max 구독\n# Codex:  codex 실행 후 OAuth 브라우저 인증\n# Gemini: Google AI Studio에서 API 키 발급",
  "agents.guide.setup.step3.title": "Marblo에서 에이전트 추가",
  "agents.guide.setup.step3.code":
    "# 1. 'Add Agent' 버튼 클릭\n# 2. 이름, 모델, 역할 선택\n# 3. MCP 연결은 자동 — 태스크 관리 바로 사용 가능",

  // ── Setup Guide (empty state) ───────────────────────────────
  "agents.setupGuide.empty": "에이전트가 없습니다",
  "agents.setupGuide.addFirst": "+ 첫 에이전트 추가",
  "agents.setupGuide.preInstall": "사전 설치 가이드",
  "agents.setupGuide.preInstallDesc":
    "에이전트를 실행하려면 해당 AI CLI가 시스템에 설치되어 있어야 합니다.",
  "agents.setupGuide.install": "설치",
  "agents.setupGuide.run": "실행",
  "agents.setupGuide.note.claude": "Anthropic API 키 필요 (ANTHROPIC_API_KEY)",
  "agents.setupGuide.note.codex": "OpenAI API 키 필요 (OPENAI_API_KEY)",
  "agents.setupGuide.note.gemini": "Google AI API 키 필요",
  "agents.setupGuide.mcp.title": "MCP 연결 (선택)",
  "agents.setupGuide.mcp.desc":
    "터미널에서 직접 CLI를 MCP와 연결하면 에이전트 없이도 티켓을 관리할 수 있습니다.",

  // ── Add Agent modal ─────────────────────────────────────────
  "agents.addModal.model.local": "로컬 모델 (Ollama 등)",
  "agents.addModal.model.custom": "커스텀 (직접 입력)",
  "agents.addModal.localHint":
    "CLI 명령어를 ollama / lms / llama 등 본인 환경에 맞게 변경",
  "agents.addModal.localModel": "로컬 모델 (ollama 설치됨)",
  "agents.addModal.localModelHint":
    "(ollama list 실측 — 설치된 모델만 선택 가능)",
  "agents.addModal.localModelNone":
    "설치된 로컬 모델이 없습니다. 스토어 → 로컬 모델 탭에서 원클릭 설치하세요.",
  "agents.addModal.localModelLoading": "설치된 로컬 모델 확인 중…",
  "agents.addModal.name": "이름",
  "agents.addModal.modelSelect": "모델 선택",
  "agents.addModal.role": "역할",
  "agents.addModal.command": "CLI 명령어",
  "agents.addModal.commandHint": "(모델에 따라 자동 설정, 수동 변경 가능)",
  "agents.addModal.cwd": "작업 디렉토리",
  "agents.addModal.selectFolder": "폴더 선택",
  "agents.addModal.taskAssign": "태스크 할당",
  "agents.addModal.optional": "(선택)",
  "agents.addModal.noTask": "태스크 없이 시작 (대화형)",
  "agents.addModal.noTasksAvail":
    "할당 가능한 태스크가 없습니다. 보드에서 먼저 태스크를 생성하세요.",
  "agents.addModal.initPrompt": "초기 프롬프트",
  "agents.addModal.initPromptHint": "(선택, 비우면 대화형으로 시작)",
  "agents.addModal.promptPlaceholder": "에이전트에게 시킬 작업을 입력하세요...",

  // ── Status labels ───────────────────────────────────────────
  "agents.status.working": "작업 중",
  "agents.status.idle": "대기",
  "agents.status.error": "오류",
  "agents.status.stopped": "중지",

  // ── Shared stats ────────────────────────────────────────────
  "agents.stats.done": "완료",
  "agents.stats.inProgress": "진행 중",

  // ── Relative / duration time ────────────────────────────────
  "agents.time.justNow": "방금 전",
  "agents.time.minsAgo": "{count}분 전",
  "agents.time.hoursAgo": "{count}시간 전",
  "agents.time.daysAgo": "{count}일 전",
  "agents.time.minutes": "{count}분",
  "agents.time.hoursMinutes": "{hours}시간 {mins}분",

  // ── Agent status card ───────────────────────────────────────
  "agents.statusCard.deleteConfirm": '"{name}" 에이전트를 삭제하시겠습니까?',
  "agents.statusCard.deleteTitle": "에이전트 삭제",
  "agents.statusCard.currentTask": "현재 태스크",

  // ── Member card ─────────────────────────────────────────────
  "agents.member.currentWork": "현재 작업",
  "agents.member.model": "모델",
  "agents.member.recentDone": "최근 완료 작업",
  "agents.member.inProgressWork": "진행 중인 작업",

  // ── Attention badge ─────────────────────────────────────────
  "agents.attention.awaiting": "입력 대기",
  "agents.attention.awaitingTitle":
    "에이전트가 사용자 입력을 기다리고 있습니다",

  // ── 입력 대기 알림(우상단) ──────────────────────────────────
  "agents.inputWait.title": "{name} 이(가) 답을 기다립니다",
  "agents.inputWait.confirmBody":
    "확인 질문이 떠 있어 답하기 전까지 진행하지 않습니다.",
  "agents.inputWait.promptBody":
    "프롬프트 앞에서 멈춰 있습니다. 터미널에서 이어서 지시해 주세요.",
  "agents.inputWait.open": "터미널 열기",
  "agents.inputWait.dismiss": "알림 닫기",

  // ── Team dashboard ──────────────────────────────────────────
  "agents.team.title": "팀 대시보드",
  "agents.team.project": "프로젝트",
  "agents.team.members": "멤버 {count}명",
  "agents.team.online": "{count}명 온라인",
  "agents.team.doneToday": "오늘 완료",
  "agents.team.doneThisWeek": "이번 주 완료",
  "agents.team.avgTime": "평균 완료 시간",
  "agents.team.membersHeading": "멤버",
  "agents.team.noAgents": "등록된 에이전트가 없습니다",
  "agents.team.activity": "활동",

  // ── Team summary ────────────────────────────────────────────
  "agents.summary.totalTasks": "전체 태스크",
  "agents.summary.unit": "명",
  "agents.summary.none": "아직 붙은 에이전트가 없어요",

  // ── Terminal fleet cell ─────────────────────────────────────
  "agents.terminalCell.closeConfirm": '터미널 "{name}" 을 닫을까요?',
  "agents.terminalCell.ariaLabel":
    "{name} 터미널 — Enter 또는 더블클릭으로 상세보기",
  "agents.terminalCell.title":
    "{name} — 단일 클릭=선택, Enter/더블클릭=하단 상세보기",
  "agents.terminalCell.closeTitle": "터미널 닫기 (PTY kill + 영속 entry 제거)",
  "agents.terminalCell.closeAria": "{name} 터미널 닫기",

  // ── Agent fleet cell ────────────────────────────────────────
  "agents.fleetCell.deleteConfirm": '"{name}" 에이전트를 삭제할까요?',
  "agents.fleetCell.ariaLabel": "{name} — Enter 또는 더블클릭으로 상세보기",
  "agents.fleetCell.title":
    "{name} — 단일 클릭=선택, Enter/더블클릭=하단 상세보기",
  "agents.fleetCell.startTitle": "세션 시작 (cold restart — 새 PTY 생성)",
  "agents.fleetCell.startAria": "{name} 세션 시작",
  "agents.fleetCell.deleteTitle":
    "에이전트 삭제 (PTY 종료 + Firestore 문서 제거)",
  "agents.fleetCell.deleteAria": "{name} 에이전트 삭제",

  // ── Agent fleet grid ────────────────────────────────────────
  "agents.fleetGrid.addHint": "상단 Add Agent 버튼으로 추가하세요",
  "agents.fleetGrid.ariaLabel":
    "에이전트 그리드 — 화살표로 이동, Enter 로 상세보기",

  // ── Agent list panel ────────────────────────────────────────
  "agents.listPanel.noTerminal": "이 에이전트에 연결된 터미널이 없습니다.",
  "agents.listPanel.startNewSession": "새 세션을 시작하시겠습니까?",
  "agents.listPanel.newSessionTitle":
    "기존 PTY를 죽이고 새 CLI 세션 시작 (resume 안 함)",
  "agents.listPanel.cliHint":
    "세션이 안 뜨면 콘솔에서 CLI 설치 여부를 확인하세요 (claude / codex / gemini).",

  // ── Agent row ───────────────────────────────────────────────
  "agents.row.agentTitle":
    "↑/↓: 이동 · Enter / → / 클릭: 포커스 · 더블클릭: Agents 탭",
  "agents.row.terminalTitle": "↑/↓: 이동 · Enter: 터미널 포커스",

  // ── Close (X) — row / focus header ──────────────────────────
  "agents.close.rowAria": "{name} 닫기",
  "agents.close.rowAgentTitle": "닫기 — 세션 종료 후 목록에서 제거",
  "agents.close.rowTerminalTitle": "터미널 닫기 (PTY 종료)",
  "agents.close.confirmTitle": "작업 중인 에이전트를 닫을까요?",
  "agents.close.confirmBody":
    '"{name}" 은(는) 지금 작업 중입니다. 닫으면 세션이 종료되고 목록에서 사라집니다.',
  "agents.close.confirmWarning": "진행 중이던 작업은 복구할 수 없습니다.",
  "agents.close.confirm": "닫기",
  "agents.close.cancel": "취소",

  // ── Focus view ──────────────────────────────────────────────
  "agents.focus.backTitle": "목록으로 (← / Esc)",
  "agents.focus.renameTitle": "이름 변경 (Ctrl+R)",
  "agents.focus.newSessionTitle": "현재 PTY 종료 후 새 CLI 세션 시작",
  "agents.focus.prevTitle": "이전 에이전트",
  "agents.focus.nextTitle": "다음 에이전트 (→)",

  // ── Agents tab ──────────────────────────────────────────────
  "agents.tab.limitReached": "에이전트 한도 도달",
  "agents.tab.activeCount": "활성 에이전트 {active} / {limit}",
  "agents.tab.plan": "플랜",
  "agents.tab.atLimitHint":
    "한도 도달 — 업그레이드 또는 기존 에이전트 정지 필요",
  "agents.marbloBots.title": "마블로봇",
  "agents.marbloBots.subtitle":
    "Persona, Mission, Model, Tools, Knowledge를 저장하고 보드 dispatch 경로로 실행합니다.",
  "agents.marbloBots.knowledgeRoot": "Knowledge root_path",
  "agents.marbloBots.rootMissing": "프로젝트 폴더 연결 필요",
  "agents.marbloBots.runMission": "이번에 맡길 임무",
  "agents.marbloBots.runPlaceholder":
    "비워두면 봇의 기본 Mission으로 실행합니다.",
  "agents.marbloBots.runnableSeeds": "실행 가능한 시드",
  "agents.marbloBots.storageScope": "저장 범위: 프로젝트별 botDefinitions",
  "agents.marbloBots.saveAgain": "다시 저장",
  "agents.marbloBots.saveToProject": "프로젝트에 저장",
  "agents.marbloBots.saveAndRun": "저장 후 실행",
  "agents.marbloBots.savedBots": "저장된 봇",
  "agents.marbloBots.savedEmpty": "아직 저장된 봇이 없습니다.",
  "agents.marbloBots.runSaved": "이 봇에게 맡기기",
  "agents.marbloBots.newBot": "새 봇 저장",
  "agents.marbloBots.name": "이름",
  "agents.marbloBots.model": "모델",
  "agents.marbloBots.role": "역할",
  "agents.marbloBots.knowledgeUse": "Knowledge 사용",
  "agents.marbloBots.save": "저장",
  "agents.marbloBots.omitted": "이번 단계에서 뺀 봇",
  "agents.marbloBots.section.bots": "봇 갤러리",
  "agents.marbloBots.section.agents": "실행 중",
  "agents.marbloBots.section.triggers": "트리거",
  "agents.marbloBots.tabAria": "마블로봇 탭",
  "agents.marbloBots.loginRequired": "로그인 후 봇 정의를 저장할 수 있습니다.",
  "agents.marbloBots.triggersTitle": "스케줄러·조건 트리거",
  "agents.marbloBots.triggersBody":
    "실행 엔진은 준비되어 있고, 이 화면은 후속 티켓에서 켭니다.",

  // ── No-project empty state (agents tab reached with no project selected) ──
  "agents.noProject.title": "선택된 프로젝트가 없습니다",
  "agents.noProject.desc":
    "에이전트는 프로젝트에 속합니다. 먼저 프로젝트 폴더를 열거나 생성하세요.",
  "agents.noProject.cta": "폴더 연결 · 시작하기",
};
