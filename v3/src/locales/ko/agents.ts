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
  "agents.setupGuide.mcp.codeComment": "Claude Code MCP 설정 (~/.claude.json)",
  "agents.setupGuide.mcp.pathPlaceholder": "{v3 경로}",

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
  "agents.fleetCell.start": "▶ 시작",
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
  "agents.listPanel.focusedAgent": "포커스된 에이전트",
  "agents.listPanel.activeAgents": "활성 에이전트",
  "agents.listPanel.killAll": "전체 종료",
  "agents.listPanel.killAllTitle": "활성 에이전트 전체 종료",
  "agents.listPanel.cleanupStopped": "stopped 정리",
  "agents.listPanel.cleanupStoppedTitle": "stopped 에이전트를 목록에서 제거",
  "agents.listPanel.spawnTerminal": "+ 터미널",
  "agents.listPanel.spawnTerminalTitle": "프로젝트 폴더에서 셸 터미널 시작",
  "agents.listPanel.confirmRemoveStopped":
    'stopped 에이전트 "{name}" 을 제거할까요?',
  "agents.listPanel.confirmKill": '에이전트 "{name}" 세션을 종료할까요?',
  "agents.listPanel.confirmKillAll":
    "활성 에이전트 {count}개를 모두 종료할까요?",
  "agents.listPanel.confirmCleanupStopped":
    "stopped 에이전트 {count}개를 제거할까요?",

  // ── Agent row ───────────────────────────────────────────────
  "agents.row.agentTitle":
    "↑/↓: 이동 · Enter / → / 클릭: 포커스 · 더블클릭: Agents 탭",
  "agents.row.terminalTitle": "↑/↓: 이동 · Enter: 터미널 포커스",
  "agents.row.removeStoppedTitle": "이 stopped 에이전트 제거",
  "agents.row.killSessionTitle": "이 에이전트 세션 종료",
  "agents.row.cleanup": "정리",
  "agents.row.kill": "종료",

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
    "봇은 오케가 필요할 때 호출하는 전문 작업자입니다. 직접 실행도 가능하지만 기본 사용법은 오케와 대화하는 것입니다.",
  "agents.marbloBots.primer.line1": "오케와 대화한다",
  "agents.marbloBots.primer.line2": "→ 오케가 필요할 때 봇을 호출한다",
  "agents.marbloBots.primer.line3": "→ 봇이 격리된 워크트리에서 일한다",
  "agents.marbloBots.primer.details": "자세히",
  "agents.marbloBots.primer.detail1":
    "봇을 직접 저장 후 실행할 수는 있지만, 기본 흐름은 오케에게 목표를 말하고 오케가 맞는 봇을 골라 보드 티켓과 물리 에이전트를 띄우는 것입니다.",
  "agents.marbloBots.primer.detail2":
    "실행된 봇은 기존 create_task / dispatch_task 경로를 타며, 연결된 티켓에 봇 출처 표식을 남깁니다.",
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
  "agents.marbloBots.copy": "복사",
  "agents.marbloBots.copied": "복사됨",
  "agents.marbloBots.required": "필요",
  "agents.marbloBots.evidence": "MCP 근거",
  "agents.marbloBots.persona": "Persona",
  "agents.marbloBots.mission": "Mission",
  "agents.marbloBots.knowledgeBadge": "Knowledge",
  "agents.marbloBots.wikiQueryRoot": "wiki_query root_path",
  "agents.marbloBots.section.bots": "봇 갤러리",
  "agents.marbloBots.section.agents": "봇 실행 중",
  "agents.marbloBots.section.triggers": "트리거",
  "agents.marbloBots.tabAria": "마블로봇 탭",
  "agents.marbloBots.loginRequired": "로그인 후 봇 정의를 저장할 수 있습니다.",
  "agents.marbloBots.triggersTitle": "스케줄러·조건 트리거",
  "agents.marbloBots.triggersBody":
    "실행 엔진은 준비되어 있고, 이 화면은 후속 티켓에서 켭니다.",
  "agents.triggers.copy": "복사",
  "agents.triggers.copyFailed": "복사하지 못했습니다.",
  "agents.triggers.webhook.title": "Webhook 조건",
  "agents.triggers.webhook.enable": "외부 웹훅 이벤트 감지",
  "agents.triggers.webhook.pollMinutes": "pollMinutes",
  "agents.triggers.webhook.pollOutOfRange":
    "Webhook poll 간격은 1~60분이어야 합니다.",
  "agents.triggers.webhook.url": "수신 URL",
  "agents.triggers.webhook.notIssued": "아직 발급되지 않았습니다.",
  "agents.triggers.webhook.issue": "URL 발급",
  "agents.triggers.webhook.rotate": "URL·시크릿 재발급",
  "agents.triggers.webhook.issued": "웹훅 URL과 서명 시크릿을 발급했습니다.",
  "agents.triggers.webhook.rotated": "웹훅 URL과 서명 시크릿을 재발급했습니다.",
  "agents.triggers.webhook.issueFailed": "웹훅 URL 발급에 실패했습니다.",
  "agents.triggers.webhook.urlCopied": "웹훅 URL을 복사했습니다.",
  "agents.triggers.webhook.secretCopied": "웹훅 시크릿을 복사했습니다.",
  "agents.triggers.webhook.secretMasked": "저장된 시크릿: {secret}",
  "agents.triggers.webhook.signatureHint":
    "요청은 POST JSON이고, x-marblo-signature 헤더는 ts=<unix>;h1=<HMAC-SHA256(secret, ts + ':' + rawBody)> 형식입니다. 시크릿 원문은 발급·재발급 직후에만 표시됩니다.",
  // ── Apps Script (구글 시트 새 행 → 웹훅). 스코프 0 대체 경로. ───────────
  // ★사용자가 자기 시트에 붙여넣는 스크립트를 만들어 주는 블록의 문구다.
  // 마찰(붙여넣기)이 실재하므로 단계 수를 숨기지 않고 먼저 말한다.
  "agents.triggers.appsScript.title": "구글 시트 새 행 감지 (Apps Script)",
  "agents.triggers.appsScript.description":
    "Marblo 는 시트를 읽지 않습니다. 대신 시트에 붙여넣는 아래 스크립트가 새 행을 감지해 위 웹훅 URL을 호출합니다. 구글 권한을 하나도 요구하지 않고, Windows 에서도 동일하게 동작합니다.",
  "agents.triggers.appsScript.stepCount":
    "앱에서 1단계, 구글 화면에서 5단계 — 모두 6단계입니다. 한 번만 하면 됩니다.",
  "agents.triggers.appsScript.needsWebhook":
    "먼저 위에서 [URL 발급]을 눌러 수신 URL과 시크릿을 만드세요.",
  "agents.triggers.appsScript.needsSecret":
    "시크릿 원문은 발급·재발급 직후에만 표시됩니다. 지금은 값이 없어 스크립트를 만들 수 없습니다. [URL·시크릿 재발급]을 누르면 새 시크릿으로 스크립트를 만들어 드립니다. ★재발급하면 이전에 붙여넣은 스크립트는 401 로 실패하므로 새 스크립트로 덮어써야 합니다.",
  "agents.triggers.appsScript.sheetName": "시트 이름 (선택)",
  "agents.triggers.appsScript.sheetNameHint":
    "비워두면 첫 번째 시트를 봅니다. 예: 설문지 응답 시트1",
  "agents.triggers.appsScript.interval": "시트를 확인하는 주기",
  "agents.triggers.appsScript.intervalOption": "{minutes}분마다",
  "agents.triggers.appsScript.intervalHint":
    "Apps Script 시간 트리거가 받는 값만 고를 수 있습니다. ★이 주기는 Marblo 가 아니라 붙여넣은 스크립트가 들고 있습니다 — 나중에 바꾸려면 스크립트를 다시 만들어 붙여넣거나, Apps Script 편집기에서 MARBLO_INTERVAL_MINUTES 를 고치고 marbloInstall 을 다시 실행하세요. 행이 추가되면 onChange 가속기가 최대 1분 안에 먼저 알리므로, 5분을 권합니다.",
  "agents.triggers.appsScript.script": "붙여넣을 스크립트",
  "agents.triggers.appsScript.copy": "스크립트 복사",
  "agents.triggers.appsScript.copied": "스크립트를 복사했습니다.",
  "agents.triggers.appsScript.secretWarning":
    "이 스크립트에는 웹훅 시크릿 원문이 들어 있습니다. 시트 공동 편집자는 이 스크립트를 볼 수 있으니, 편집 권한을 가진 사람만 있는 시트에 붙여넣으세요.",
  "agents.triggers.appsScript.stepsTitle": "구글 화면에서 할 5단계",
  "agents.triggers.appsScript.step1":
    "시트 상단 메뉴에서 확장 프로그램 → Apps Script 를 엽니다.",
  "agents.triggers.appsScript.step2":
    "편집기에 있던 코드를 모두 지우고, 복사한 스크립트를 붙여넣습니다.",
  "agents.triggers.appsScript.step3": "저장합니다 (Cmd/Ctrl + S).",
  "agents.triggers.appsScript.step4":
    "상단 함수 목록에서 marbloInstall 을 고르고 실행합니다.",
  "agents.triggers.appsScript.step5":
    "권한 승인 창에서 본인 구글 계정을 선택하고 허용합니다 (최초 1회).",
  "agents.triggers.appsScript.frictionTitle": "여기서 막히기 쉽습니다",
  "agents.triggers.appsScript.friction1":
    "4단계에서 함수 목록에 marbloInstall 이 안 보이면 아직 저장하지 않은 것입니다. 3단계를 먼저 하세요.",
  "agents.triggers.appsScript.friction2":
    "5단계에서 '이 앱은 확인되지 않았습니다' 경고가 뜰 수 있습니다. 본인이 방금 붙여넣은 본인 스크립트이므로, 고급 → (프로젝트 이름)(으)로 이동을 눌러 진행하면 됩니다.",
  "agents.triggers.appsScript.friction3":
    "설치 직후에는 알림이 오지 않는 것이 정상입니다. 현재 상태를 기준선으로 잡고, 그 뒤에 늘어난 행부터 알립니다. 바로 확인하려면 행을 하나 추가한 뒤 marbloTestNow 를 실행하세요.",
  "agents.triggers.appsScript.troubleshootTitle": "실패하면 (Apps Script 실행 기록)",
  "agents.triggers.appsScript.troubleshoot401":
    "401 — 서명이 맞지 않습니다. 시크릿을 재발급한 뒤 스크립트를 갱신하지 않은 경우가 대부분입니다. 여기서 새 스크립트를 복사해 다시 붙여넣으세요.",
  "agents.triggers.appsScript.troubleshoot403":
    "403 — 이 프로젝트의 Webhook 조건이 꺼져 있습니다. 위 체크박스를 켜고 저장하세요.",
  "agents.triggers.appsScript.troubleshoot429":
    "429 — 잠시 호출이 몰렸습니다. 스크립트가 다음 실행에서 같은 행을 다시 보내므로 놓치지 않습니다.",
  "agents.marbloBots.savedSeed": "시드 봇을 프로젝트에 저장했습니다.",
  "agents.marbloBots.savedCustom": "봇 정의를 프로젝트에 저장했습니다.",
  "agents.marbloBots.saveFailed": "저장 실패",
  "agents.marbloBots.runFailed": "실행 실패",
  "agents.marbloBots.dispatchFailed":
    "오케스트레이터에 실행 지시를 보내지 못했습니다.",
  "agents.marbloBots.dispatchLocal":
    "오케스트레이터에 보냈습니다. 보드 티켓 생성 후 dispatch_task로 물리 에이전트가 뜹니다.",
  "agents.marbloBots.dispatchQueued":
    "오케스트레이터가 꺼져 있어 실행 지시를 대기열에 넣었습니다.",
  "agents.marbloBots.runningEmpty":
    "봇 갤러리에서 저장 후 실행한 봇 에이전트만 여기에 표시됩니다.",
  "agents.marbloBots.validation.missingProject": "프로젝트 귀속이 없습니다.",
  "agents.marbloBots.validation.missingOwner": "소유자 정보가 없습니다.",
  "agents.marbloBots.validation.missingName": "봇 이름이 비어 있습니다.",
  "agents.marbloBots.validation.missingPersona": "Persona가 비어 있습니다.",
  "agents.marbloBots.validation.emptyMission": "Mission이 비어 있습니다.",
  "agents.marbloBots.validation.unknownModel": "알 수 없는 모델입니다.",
  "agents.marbloBots.validation.knowledgeRootRequired":
    "Knowledge를 켜려면 wiki root_path가 필요합니다.",
  "agents.marbloBots.validation.default": "봇 정의를 저장할 수 없습니다.",
  "agents.marbloBots.wiki.title":
    "먼저 Knowledge 축 켜기: 마블로 위키 구성 가이드",
  "agents.marbloBots.wiki.ready": "docs/wiki 확인됨",
  "agents.marbloBots.wiki.needsSetup": "구성 필요",
  "agents.marbloBots.wiki.body":
    "봇의 차별점은 프로젝트 지식입니다. 새 엔진이 아니라 이미 등록된 wiki_ingest, wiki_query, wiki_lint와 wiki-init/wiki-note/wiki-ingest 스킬을 쓰게 오케에게 요청하세요.",
  "agents.marbloBots.wiki.root": "루트",
  "agents.marbloBots.wiki.mcpTools":
    "MCP: wiki_ingest / wiki_query / wiki_lint",
  "agents.marbloBots.wiki.singleRoot": "공유 위키는 docs/wiki 하나",
  "agents.marbloBots.wiki.copyTitle": "오케에게 복사해서 보낼 요청",
  "agents.marbloBots.wiki.request1":
    "오케, 이 프로젝트에 마블로 지식위키를 구성해줘.",
  "agents.marbloBots.wiki.request2":
    "공유 위키 루트는 docs/wiki 하나만 쓰고, .claude/skills/wiki-init · wiki-note · wiki-ingest 스킬과 MCP wiki_ingest/wiki_query/wiki_lint를 사용해.",
  "agents.marbloBots.wiki.request3":
    "먼저 README와 기본 분류를 만들고, 현재 프로젝트 문서/결정사항 중 봇이 자주 참조할 내용을 wiki-note로 정리한 뒤 wiki-ingest와 wiki-lint까지 돌려줘.",
  "agents.marbloBots.wiki.request4":
    '다른 프로젝트에서 참조할 때는 wiki_query({ root_path: "<프로젝트 절대경로>/docs/wiki", query: "..." }) 형태로 쓰게 안내해줘.',
  // ★Gmail 은 "읽기" 가 아니라 "발송" 만 남았다(티켓 v5Phjv1WxndUpgFJyrIn).
  "agents.marbloBots.require.google": "Google 계정 연결 (Calendar 조회·메일 발송)",
  "agents.marbloBots.require.outputChannel": "Slack 또는 Telegram 채널",
  "agents.marbloBots.seed.knowledge.name": "지식 비서",
  "agents.marbloBots.seed.knowledge.persona":
    "프로젝트 위키를 먼저 확인하고, 근거와 한계를 짧게 분리해 말하는 실무 비서",
  "agents.marbloBots.seed.knowledge.mission":
    "사용자의 질문을 프로젝트 지식위키에 근거해 답하고, 모호한 부분은 추가 확인 항목으로 정리한다.",
  "agents.marbloBots.seed.knowledge.evidence":
    "MCP 서버에 wiki_query가 등록되어 있고, .claude/skills/wiki-init·wiki-note·wiki-ingest가 있다.",
  "agents.marbloBots.seed.fullstack.name": "풀스택 개발",
  "agents.marbloBots.seed.fullstack.persona":
    "기존 코드 패턴을 읽고 작은 PR 단위로 구현·검증하는 제품 개발 에이전트",
  "agents.marbloBots.seed.fullstack.mission":
    "요구사항을 보드 티켓으로 만들고, 기존 dispatch 경로로 작업 에이전트를 띄워 구현과 검증을 진행한다.",
  "agents.marbloBots.seed.fullstack.evidence":
    "MCP 서버에 create_task, dispatch_task, add_activity, submit_for_review가 등록되어 있다.",
  "agents.marbloBots.seed.dailyBriefing.name": "일일 브리핑",
  "agents.marbloBots.seed.dailyBriefing.persona":
    "정해진 시간에 일정과 열린 할일만 짧게 확인하고 Slack/Telegram으로 밀어주는 비서",
  "agents.marbloBots.seed.dailyBriefing.mission":
    "오늘 일정과 진행 중인 할일을 확인해 한 화면 분량의 브리핑으로 정리하고 선택된 채널로 보낸다.",
  "agents.marbloBots.seed.dailyBriefing.evidence":
    "MCP 서버에 calendar_list, send_slack_message, send_telegram_message가 등록되어 있다. 새 메일 요약은 이번 출시에서 제공하지 않는다 — 메일 읽기(gmail.readonly)는 restricted 스코프라 요청하지 않는다.",
  "agents.marbloBots.seed.mailCalendar.name": "일정 팔로업",
  "agents.marbloBots.seed.mailCalendar.persona":
    "임박 일정이 들어오면 중요도와 다음 행동만 추려 알려주는 조건 반응 비서",
  "agents.marbloBots.seed.mailCalendar.mission":
    "임박 일정을 확인하고, 준비물·후속 태스크 후보를 짧게 정리한다.",
  "agents.marbloBots.seed.mailCalendar.evidence":
    "assistant-triggers 엔진이 Calendar 조건을 폴링하고 같은 전송 MCP 도구로 푸시하도록 배선되어 있다. 새 메일 조건은 이번 출시에서 제공하지 않는다.",
  "agents.marbloBots.seed.marketer.name": "마케터",
  "agents.marbloBots.seed.marketer.persona":
    "프로젝트 지식과 현재 보드 맥락을 바탕으로 캠페인·카피·실험안을 작업 티켓으로 쪼개는 성장 비서",
  "agents.marbloBots.seed.marketer.mission":
    "제품/고객/채널 맥락을 위키에서 확인하고, 메시지 초안과 실행 티켓, 공유 채널 보고문을 만든다.",
  "agents.marbloBots.seed.marketer.evidence":
    "MCP 서버에 wiki_query, create_task, dispatch_task, send_slack_message, send_telegram_message가 등록되어 있다.",
  "agents.marbloBots.seed.designer.name": "디자이너",
  "agents.marbloBots.seed.designer.persona":
    "기존 UI 패턴을 읽고 화면 문구·레이아웃·상태를 작은 프론트엔드 변경으로 정리하는 제품 디자이너",
  "agents.marbloBots.seed.designer.mission":
    "요구 화면의 문제를 정리하고, 기존 React UI 패턴 안에서 컴포넌트/문구/상태를 개선한 뒤 검증 기준을 남긴다.",
  "agents.marbloBots.seed.designer.evidence":
    "MCP 서버에 wiki_query, create_task, dispatch_task, add_activity가 있고 Codex 프론트엔드 에이전트가 React UI 작업을 수행한다.",
  "agents.marbloBots.seed.jarvis.name": "자비스",
  "agents.marbloBots.seed.jarvis.persona":
    "오케의 범용 보좌역으로 위키·일정·보드·출력 채널을 묶어 다음 행동을 정리하는 비서",
  "agents.marbloBots.seed.jarvis.mission":
    "요청의 성격을 판단해 위키, Calendar, 보드 티켓, Slack/Telegram 보고 중 필요한 조합만 사용해 실행 계획과 결과를 정리한다. 메일은 읽지 않고, 초안을 보여 드린 뒤 확인을 받아 발송한다.",
  "agents.marbloBots.seed.jarvis.evidence":
    "MCP 서버에 wiki_query, create_task, dispatch_task, calendar_list, gmail_send, send_slack_message, send_telegram_message가 등록되어 있다. 메일 읽기(gmail_search)는 이번 출시에서 제공하지 않는다.",
  "agents.marbloBots.omitted.youtube.name": "유튜브 리서치",
  "agents.marbloBots.omitted.youtube.reason":
    "유튜브 전용 커넥터나 검증된 브라우저/검색 MCP가 현재 시드 재료로 확인되지 않아 첫 화면 실행 신뢰도를 해친다.",
  "agents.marbloBots.omitted.web.name": "웹 리서치",
  "agents.marbloBots.omitted.web.reason":
    "브라우저/검색 MCP가 현재 Marblo MCP 표면에 등록된 실행 재료로 확인되지 않았다.",

  // ── Assistant trigger settings panel ──────────────────────────
  "agents.triggers.title": "스케줄·조건 트리거",
  "agents.triggers.description":
    "저장 범위는 프로젝트입니다. 기존 엔진은 projects 문서의 assistantTriggers를 읽고, assistant 프로젝트의 오케스트레이터에 주기·조건 메시지를 주입합니다.",
  "agents.triggers.refreshConnectors": "연결 상태 새로고침",
  "agents.triggers.connectorReady": "준비됨",
  "agents.triggers.connectorNeedsConnection": "연결 필요",
  "agents.triggers.enableLabel": "트리거 엔진 사용",
  "agents.triggers.enableHint":
    "꺼두면 assistantTriggers.enabled=false로 저장됩니다.",
  "agents.triggers.tabsAria": "트리거 설정 분류",
  "agents.triggers.tabs.schedule": "스케줄",
  "agents.triggers.tabs.conditions": "조건",
  "agents.triggers.tabs.outputs": "출력채널",
  "agents.triggers.engineNoticePrefix": "엔진은",
  "agents.triggers.engineNoticeSuffix":
    "프로젝트만 폴링합니다. 현재 프로젝트 종류:",
  "agents.triggers.engineNoticeEnabled": " — 저장 후 활성화 대상입니다.",
  "agents.triggers.engineNoticeDisabled":
    " — 설정은 저장할 수 있어도 실제 폴링은 돌지 않습니다.",
  "agents.triggers.schedule.title": "정시 스케줄",
  "agents.triggers.schedule.enable": "매칭되는 분마다 일일 브리핑 실행",
  "agents.triggers.calendar.title": "Calendar 조건",
  "agents.triggers.calendar.enable": "임박 일정 감지",
  "agents.triggers.gmail.title": "Gmail 조건 (이번 출시 미제공)",
  "agents.triggers.gmail.enable": "메일 조건 감지",
  "agents.triggers.sheets.title": "구글 시트 조건",
  "agents.triggers.sheets.heldBadge": "보류됨",
  "agents.triggers.sheets.heldNotice":
    "이 조건은 폴링으로 동작하지 않습니다. 연결이 끊긴 것이 아니라 방식이 바뀌었습니다 — 시트 읽기 권한(spreadsheets.readonly)을 요청하지 않기로 해서, 이제 위 Webhook 조건의 Apps Script 가 같은 일을 합니다. 아래 설정값은 지우지 않고 보관합니다.",
  "agents.triggers.sheets.enable": "새 행이 추가되면 감지",
  "agents.triggers.sheets.spreadsheet": "스프레드시트 ID 또는 URL",
  "agents.triggers.sheets.spreadsheetHint":
    "시트 주소창의 URL을 그대로 붙여넣어도 됩니다. 저장할 때 ID로 정리됩니다.",
  "agents.triggers.sheets.range": "시트·범위",
  "agents.triggers.sheets.rangeHint":
    "비워두면 첫 번째 시트의 A:Z를 봅니다. 시트를 지정하려면 '설문지 응답 시트1!A:Z'처럼 씁니다.",
  "agents.triggers.sheets.pollMinutes": "pollMinutes",
  "agents.triggers.sheets.detectionHint":
    "첫 폴링은 현재 상태를 기준선으로 잡기만 하고 알리지 않습니다. 이후 행 수가 늘어난 폴링에서 새로 나타난 행만 알립니다. 셀을 고치거나 행을 지우는 것은 알림 대상이 아닙니다.",
  "agents.triggers.outputs.title": "출력 채널",
  "agents.triggers.outputs.description":
    "엔진은 선택된 채널에 대해 {tools} MCP 도구를 호출하도록 오케스트레이터에 지시합니다.",
  "agents.triggers.outputs.none": "선택 안 됨",
  "agents.triggers.outputs.slackGuide": "Slack 연결 상태와 가이드",
  "agents.triggers.outputs.telegramGuide": "Telegram 연결 상태와 가이드",
  "agents.triggers.engineFields":
    "기존 엔진 필드: schedule, calendar, gmail, webhook, sheets, outputs",
  "agents.triggers.save": "저장",
  "agents.triggers.saved": "프로젝트 트리거 설정을 저장했습니다.",
  "agents.triggers.saveFailed": "저장 실패",
  "agents.triggers.errors.loadConnectorsFailed":
    "커넥터 상태를 불러오지 못했습니다.",
  "agents.triggers.errors.assistantProjectRequired":
    "현재 엔진은 kind=assistant 프로젝트만 폴링합니다. 비서 프로젝트에서 켜 주세요.",
  "agents.triggers.validation.noTriggerEnabled": "켜진 트리거가 없습니다.",
  "agents.triggers.validation.outputsRequired":
    "출력 채널을 하나 이상 선택해야 합니다.",
  "agents.triggers.validation.slackOutputUnavailable":
    "Slack 채널 연결이 준비되지 않았습니다.",
  "agents.triggers.validation.telegramOutputUnavailable":
    "Telegram 채널 연결이 준비되지 않았습니다.",
  "agents.triggers.validation.invalidCron":
    "cron은 5필드 형식이어야 합니다. 예: 0 9 * * 1-5",
  "agents.triggers.validation.calendarConnectorRequired":
    "Calendar 트리거를 켜려면 Google Calendar scope가 필요합니다.",
  "agents.triggers.validation.gmailConnectorRequired":
    "새 메일 감지 트리거는 이번 출시에서 제공하지 않습니다. 메일 읽기 권한(gmail.readonly)은 Google 이 restricted 로 분류해 별도 보안평가를 통과해야 요청할 수 있습니다. 일정·시간·스프레드시트 조건은 그대로 쓸 수 있습니다.",
  "agents.triggers.validation.calendarPollOutOfRange":
    "Calendar poll 간격은 1~60분이어야 합니다.",
  "agents.triggers.validation.gmailPollOutOfRange":
    "Gmail poll 간격은 1~60분이어야 합니다.",
  "agents.triggers.validation.sheetsTriggerWithheld":
    "시트 조건을 켠 채로는 저장할 수 없습니다. 새 행 감지는 이제 위 Webhook 조건의 Apps Script 로 동작합니다 — 이 체크박스를 끄고, Webhook 조건에서 스크립트를 만들어 시트에 붙여넣어 주세요.",
  "agents.triggers.validation.sheetsConnectorRequired":
    "시트 조건을 켜려면 Google Sheets readonly scope가 필요합니다. Harness 탭에서 Google 계정을 다시 연결해 주세요.",
  "agents.triggers.validation.sheetsSpreadsheetRequired":
    "스프레드시트 ID 또는 URL을 입력해야 합니다.",
  "agents.triggers.validation.sheetsPollOutOfRange":
    "시트 poll 간격은 1~60분이어야 합니다.",
  "agents.triggers.validation.calendarUpcomingOutOfRange":
    "임박 일정 범위는 1~1440분이어야 합니다.",
  "agents.triggers.validation.default": "트리거 설정을 저장할 수 없습니다.",

  // ── No-project empty state (agents tab reached with no project selected) ──
  "agents.noProject.title": "선택된 프로젝트가 없습니다",
  "agents.noProject.desc":
    "에이전트는 프로젝트에 속합니다. 먼저 프로젝트 폴더를 열거나 생성하세요.",
  "agents.noProject.cta": "폴더 연결 · 시작하기",
};
