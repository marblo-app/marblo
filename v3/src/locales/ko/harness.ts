/**
 * Korean — `harness.*` namespace (Harness Store surface: connection status
 * panel + package catalog). One namespace per file so parallel i18n PRs don't
 * collide on a single monolith. Keys keep their fully-qualified dotted form.
 */
export const harness = {
  // --- Connection status panel ---
  "harness.conn.title": "저장소(GitHub) 연결",
  "harness.conn.noProject": "프로젝트 미선택",
  "harness.conn.refreshTitle": "연결 상태 새로고침",
  "harness.conn.resyncTitle": "git 메타(repo URL·기본 브랜치) 재동기화",
  "harness.conn.resync": "재동기화",
  "harness.conn.check": "연결 확인",
  "harness.conn.loading": "연결 상태 확인 중",
  "harness.conn.loadError": "연결 상태를 불러오지 못했습니다.",
  "harness.conn.createError": "연결 생성에 실패했습니다.",
  "harness.conn.checkError": "연결 확인에 실패했습니다.",
  "harness.conn.accessError": "권한 적용에 실패했습니다.",
  "harness.conn.removeError": "연결 해제에 실패했습니다.",
  "harness.conn.removeConfirm": "현재 프로젝트의 repo 연결을 해제하시겠습니까?",
  "harness.conn.nodeBadge": "node 실행 불가",
  "harness.conn.nodeError": "spawn 용 node 바이너리를 실행하지 못했습니다.",
  "harness.conn.nodeHintBefore":
    "MCP·에이전트 자식이 뜨지 못하고 끊길 수 있습니다 (-32000). 터미널에서",
  "harness.conn.nodeHintAfter": "후 앱을 재시작하세요.",
  "harness.conn.noRepo": "연결된 repo가 없습니다.",
  "harness.conn.autoFillHint":
    "현재 프로젝트의 로컬 경로로 저장소 연결을 만들면 repo URL·기본 브랜치를 git 에서 자동으로 채웁니다. private 저장소 접근은 아래 GitHub 계정 연결을 추가로 사용합니다.",
  "harness.conn.connect": "연결하기",
  "harness.conn.connecting": "연결 중",
  "harness.conn.noFolderPath":
    "프로젝트에 로컬 경로(folderPath)가 없어 연결할 수 없습니다. 프로젝트 설정에서 경로를 지정하세요.",
  "harness.conn.selectProjectFirst": "프로젝트를 먼저 선택하세요.",
  "harness.conn.unknown": "미확인",
  "harness.conn.notConnected": "미연결",
  "harness.conn.noActiveAgents": "실행 중인 에이전트 없음",
  "harness.conn.noRecord": "기록 없음",
  "harness.conn.currentMode": "현재 모드: {mode}",
  "harness.conn.applyAccess": "권한 적용",
  "harness.conn.disconnect": "연결 해제",
  "harness.conn.checkResult": "연결 확인 결과",
  "harness.conn.ok": "정상",
  "harness.conn.needsCheck": "확인 필요",
  // Manual connect form
  "harness.conn.invalidUrl":
    "올바른 repo URL 형식이 아닙니다. 예: https://github.com/owner/repo 또는 git@github.com:owner/repo.git",
  "harness.conn.manualError": "수동 연결에 실패했습니다.",
  "harness.conn.manualTitle": "repo URL 직접 입력",
  "harness.conn.manualHint":
    "git remote 가 없거나 자동으로 도출되지 않은 경우 repo URL 을 직접 입력해 연결할 수 있습니다.",
  "harness.conn.branchPlaceholder": "기본 브랜치 (선택, 예: main)",
  "harness.conn.manualConnect": "수동 연결",
  // 리포 연결 후 티켓별 독립 워크트리 안내 (YTpcEK5Ow5LIldkJJzQc)
  "harness.conn.worktreeGuide.badge": "독립 워크트리",
  "harness.conn.worktreeGuide.title": "티켓별 독립 워크트리",
  "harness.conn.worktreeGuide.body":
    "이제 에이전트가 티켓별로 독립 워크트리에서 작업합니다. 서로 충돌 없이 병렬로 진행됩니다.",
  "harness.conn.worktreeGuide.popupTitle": "독립 워크트리로 작업합니다",
  "harness.conn.worktreeGuide.popupBody":
    "깃 리포가 연결되었습니다. 이제 에이전트가 티켓별로 독립 워크트리에서 작업합니다(충돌 없이 병렬).",
  "harness.conn.worktreeGuide.gotIt": "확인",
  // Permission state labels (enum → display)
  "harness.perm.unknown": "미확인",
  "harness.perm.pending": "대기",
  "harness.perm.granted": "허용",
  "harness.perm.denied": "거부",
  // Connection-check item status labels
  "harness.checkStatus.pass": "통과",
  "harness.checkStatus.warn": "주의",
  "harness.checkStatus.fail": "실패",
  // MCP status table
  "harness.mcp.available": "사용 가능",
  "harness.mcp.denied": "권한 거부",
  "harness.mcp.pending": "권한 대기",
  "harness.mcp.unknown": "미확인",
  "harness.mcp.colName": "MCP명",
  "harness.mcp.colStatus": "상태",
  "harness.mcp.colPerm": "권한",
  "harness.mcp.colLastUsed": "마지막사용",
  "harness.mcp.empty": "사용 가능한 MCP가 없습니다.",
  // --- Harness store (package catalog) ---
  "harness.store.cat.all": "전체",
  "harness.store.cat.required": "필수 (원클릭 설치)",
  "harness.store.cat.recommended": "추천 스킬",
  "harness.store.cat.mcp": "유용한 MCP",
  "harness.store.cat.cli": "CLI",
  "harness.store.cat.envswap": "env-swap 벤더",
  // --- env-swap 벤더 섹션 (설치가 아니라 키 등록) ---
  // ★벤더 이름·모델 id 가 이 표에 하나도 없다. 목록은 model-registry 파생이고,
  //   여기 있는 것은 "설치할 CLI 가 아니라 키를 얹는 것" 이라는 분류 문구뿐이다.
  "harness.store.envSwap.title": "env-swap 벤더",
  "harness.store.envSwap.summary": "{total}개 중 {ready}개 준비됨",
  "harness.store.envSwap.loading": "벤더 목록을 불러오는 중…",
  "harness.store.envSwap.loadFailed": "벤더 목록을 불러오지 못했습니다.",
  "harness.store.envSwap.retry": "다시 시도",
  "harness.store.envSwap.empty": "등록된 env-swap 벤더가 없습니다.",
  "harness.store.status.installed": "설치됨",
  "harness.store.status.not-installed": "설치",
  "harness.store.status.manual-required": "수동 설치",
  "harness.store.status.unknown": "확인 중",
  "harness.store.loadFail": "불러오기 실패",
  "harness.store.noManualGuide": "수동 설치 안내가 없습니다.",
  "harness.store.installFail": "설치 실패",
  "harness.store.installDone": "{name} 설치 완료.",
  "harness.store.uninstallConfirm": "{name} 제거하시겠습니까?",
  "harness.store.uninstallFail": "제거 실패",
  "harness.store.uninstallDone": "{name} 제거됨.",
  // Harness 탭은 "이 앱을 쓰려면 반드시 해야 하는 연결"만 담는다 — 골라 담는
  // 자산 카탈로그는 최상위 스토어 탭으로 나갔다.
  "harness.store.title": "하네스 연결",
  "harness.store.subtitle": "저장소·커넥터·채널 — 하네스가 쓰는 연결",
  "harness.store.emptyList": "표시할 패키지가 없습니다.",
  "harness.store.deprecated": "단종 예정",
  "harness.store.badge.installed": "설치됨",
  "harness.store.badge.manual": "수동",
  "harness.store.badge.notInstalled": "미설치",
  "harness.store.auth.checking": "인증 확인 중…",
  "harness.store.auth.needed": "인증 필요",
  "harness.store.auth.checkingShort": "확인 중…",
  "harness.store.updatePending": "→ v{version} 업데이트 대기 중",
  "harness.store.upToDate": "(최신)",
  "harness.store.auth.loginHintBefore": "로그인이 필요합니다. 터미널에서",
  "harness.store.auth.loginHintAfter":
    "실행 후 Re-check 하세요. (미인증 상태로 spawn 시 로그인 프롬프트에서 멈춥니다)",
  "harness.store.pkg.cliClaude.desc":
    "오케스트레이터 및 Claude 에이전트 실행에 필요한 CLI입니다. 공식 네이티브 인스톨러로 설치되며, 설치 후 첫 실행 시 OAuth 또는 API 키로 인증합니다.",
  "harness.store.pkg.cliCodex.desc":
    "Codex(gpt) 에이전트 실행에 필요한 CLI입니다. 공식 네이티브 인스톨러로 설치되며, 설치 후 `codex login`으로 인증합니다.",
  "harness.store.pkg.cliGrok.desc":
    "Grok Build 에이전트 실행에 필요한 CLI입니다. 공식 shell 인스톨러로 설치하며, 첫 실행 또는 `grok login` 시 브라우저 인증을 엽니다.",
  "harness.store.pkg.cliClaude.postInstall":
    "설치 후 터미널에서 `claude` 한 번 실행해서 Anthropic 계정 OAuth 또는 API 키 인증을 완료하세요. 그 후 Marblo 재시작.",
  "harness.store.pkg.cliCodex.postInstall":
    "설치 후 터미널에서 `codex login` 실행해서 OpenAI 계정 인증을 완료하세요. /goal 기능이 자동 활성화됐으니, 인증 후 Codex 세션에서 `/goal <목표>`로 자율 모드 사용 가능.",
  "harness.store.pkg.cliGrok.postInstall":
    "설치 후 터미널에서 `grok login` 또는 `grok`를 실행해 브라우저 인증을 완료하세요. 인증 후 Marblo 재시작.",
  "harness.store.pkg.marbloTfCommands.name": "TaskForce 슬래시 커맨드",
  "harness.store.pkg.marbloTfCommands.desc":
    "Marblo 워크플로우용 /tf-* 슬래시 커맨드 18종. 설치 버튼으로 한 번에 설치됩니다.",
  "harness.store.pkg.marbloMcp.name": "Marblo MCP 서버",
  "harness.store.pkg.marbloMcp.desc":
    "TaskForce / 칸반 / 에이전트 관리 MCP 도구 모음. Marblo 대시보드 내부에서 spawn 된 에이전트(Claude / Codex / Gemini)는 per-agent isolated config 로 자동 연결됩니다. 외부 터미널 CLI 세션에는 등록하지 않습니다 — 그쪽은 사용자의 taskforce MCP 등 별도 설정으로 관리하세요.",
  "harness.store.pkg.cliGemini.desc":
    "⚠️ 단종 예정 (2026-06-18 개인 티어 EOL). Antigravity (agy) CLI 로 통합됩니다. 신규 설치는 권장하지 않습니다 — 주력은 Claude Code / Codex / Antigravity 3종. 엔터프라이즈 Code Assist 또는 유료 API 키 사용자만 계속 동작합니다.",
  "harness.store.pkg.cliGemini.postInstall":
    "⚠️ Gemini CLI 개인 티어는 2026-06-18 종료됩니다. 신규 설치 대신 Antigravity (agy) CLI 를 사용하세요. 기존 사용자는 엔터프라이즈 Code Assist 또는 유료 API 키로만 계속 동작합니다.",
  "harness.store.pkg.cliAntigravity.desc":
    "Antigravity 2.0 (Google I/O 2026 발표) 의 agy CLI. Marblo 의 4번째 1st-class 에이전트 모델. 설치 버튼으로 curl shell 인스톨러를 실행합니다. 첫 실행 시 OAuth 브라우저 인증.",
  "harness.store.pkg.cliAntigravity.postInstall":
    "설치 후 터미널에서 `agy` 한 번 실행해서 OAuth 브라우저 인증을 완료하세요. 바이너리는 `~/.local/bin/agy` 에 설치되고 shell rc 의 PATH 가 업데이트됩니다. 인증 후 Marblo 재시작. 첫 agy 워커 스폰 시 `~/.gemini/antigravity-cli/mcp_config.json` 에 Marblo MCP 항목이 자동 머지됩니다 (기존 MCP 항목 보존).",
  "harness.store.pkg.superpowers.desc":
    "Anthropic의 Claude Code 스킬 모음 (TDD, debugging, brainstorming, code review 등).",
  "harness.store.pkg.superpowers.instructions":
    "Claude Code 플러그인 시스템으로 설치하세요. 자세한 안내: https://github.com/anthropics/claude-code-plugins",
  "harness.store.pkg.gstack.desc":
    "디자인 / QA / 배포 / 보안 / 회고 등 풀스택 워크플로우 스킬셋.",
  "harness.store.pkg.context7.name": "context7 (라이브러리 문서)",
  "harness.store.pkg.context7.desc":
    "라이브러리 / API 최신 문서를 조회하는 MCP. React / Next.js / Tailwind 등.",
  "harness.store.pkg.filesystem.name": "filesystem (파일 시스템)",
  "harness.store.pkg.filesystem.desc":
    "Claude가 사용자 지정 디렉터리의 파일을 읽고 쓸 수 있게 하는 공식 MCP.",
  "harness.store.pkg.github.name": "github (이슈 / PR / 코드 검색)",
  "harness.store.pkg.github.desc":
    "GitHub 이슈 / PR 관리, 저장소 / 코드 / 사용자 검색을 위한 공식 MCP.",
  "harness.store.pkg.playwright.name": "playwright (브라우저 자동화)",
  "harness.store.pkg.playwright.desc":
    "에이전트가 헤드리스 Chromium으로 페이지 열기 / 클릭 / 폼 입력 / 스크린샷 / 콘솔 로그 캡처를 직접 수행. 자체 IDE 임베드 브라우저(P2-10) 미루는 동안 90% 대체.",
  "harness.store.installing": "설치 중...",
  "harness.store.viewGuide": "안내 보기",
  "harness.store.bundled": "원클릭 설치",
  "harness.store.requiredInstall": "필수 — 설치",
  "harness.store.processing": "처리 중...",
  "harness.store.uninstall": "제거",
  "harness.store.requiredNoRemove": "필수 패키지 — 제거 불가",
  "harness.store.deprecatedNoInstall": "단종 예정 — 설치 비권장",
  "harness.store.docs": "문서 →",
  "harness.store.footerMcp":
    "Marblo MCP는 대시보드 내부에서 spawn 된 에이전트에만 자동 연결됩니다 (per-agent isolated config). 외부 터미널 CLI 세션은 사용자의 taskforce MCP 등 별도 설정으로 관리하세요.",
  "harness.store.footerStoreMoved":
    "스킬·MCP 자산 설치는 상단 '스토어' 탭으로 옮겨졌습니다.",
  // --- 연결 섹션 머리줄 ---
  "harness.store.section.connections": "연결",
  "harness.store.section.connectionsDesc":
    "저장소(GitHub), 커넥터, Telegram/Slack 채널을 한곳에서 연결합니다.",
  "harness.store.section.cli": "오케 CLI",
  "harness.store.section.cliDesc":
    "Claude Code, Codex, Grok CLI를 설치하고 로그인 상태를 확인합니다.",
  // ★섹션 머리는 두 줄(제목 + 이 한 줄)까지다. 예전엔 여기 아래로 "띄우는 법 —
  // 오케스트레이터에게 이렇게 말하세요" 가 한 줄 더 섰는데, 그 문장이 하던 일은
  // 아래 스니펫이 무엇인지 말해 주는 것뿐이라 이 줄 뒤에 붙여 하나로 합쳤다.
  // 벤더 열거(GLM·Kimi·…)는 바로 밑 카드가 이미 이름으로 말하므로 뺀다.
  "harness.store.section.envSwapDesc":
    "claude 하네스에 API 키만 얹어 쓰는 벤더입니다. 모델을 명시해서 오케에게 요청해보세요.",
  "harness.store.section.localDesc":
    "Ollama로 내 기기에서 실행할 로컬 모델을 설치하고 진행률을 확인합니다.",
  // --- Telegram channel panel ---
  // Status badge (fixed-set labels)
  "harness.telegram.status.idle": "대기",
  "harness.telegram.status.connected": "연결",
  "harness.telegram.status.needsCheck": "확인 필요",
  "harness.telegram.status.disconnected": "미연결",
  "harness.telegram.title": "Telegram 채널 연결",
  "harness.telegram.loadError": "텔레그램 채널 상태를 불러오지 못했습니다.",
  "harness.telegram.needChatId": "chatId 를 저장해야 활성화할 수 있습니다.",
  "harness.telegram.saved": "채널 설정을 저장했습니다.",
  "harness.telegram.saveError": "채널 설정 저장에 실패했습니다.",
  "harness.telegram.refreshTitle": "채널 상태 새로고침",
  "harness.telegram.enableTitle": "텔레그램 채널 활성화",
  "harness.telegram.enabled": "활성",
  "harness.telegram.disabled": "비활성",
  "harness.telegram.loading": "채널 상태 확인 중",
  "harness.telegram.chatIdPlaceholder": "@channel 또는 chatId",
  "harness.telegram.save": "저장",
  // Connection guide (collapsible)
  "harness.telegram.guide.toggle": "어떻게 연결하나요?",
  "harness.telegram.guide.step1Before": "",
  "harness.telegram.guide.step1After":
    "에서 봇을 만들고 bot token을 복사합니다.",
  "harness.telegram.guide.step2":
    "만든 봇을 사용할 채널 또는 그룹에 추가합니다.",
  "harness.telegram.guide.step3":
    "공개 채널은 @username을 쓸 수 있습니다. 비공개 채널/그룹은 봇을 초대한 뒤 채팅에 테스트 메시지를 보내고 getUpdates 응답의 message.chat.id 값을 복사합니다.",
  "harness.telegram.guide.step4":
    "bot token과 chatId를 입력해 저장한 뒤 활성 토글을 켭니다.",
  "harness.telegram.chatIdGuide.title": "비공개 채널/그룹 chatId 가져오기",
  "harness.telegram.chatIdGuide.before":
    "봇을 채널/그룹에 추가하고 채팅에 메시지를 하나 보낸 뒤, <BOT_TOKEN>만 실제 bot token으로 바꿔 실행합니다.",
  "harness.telegram.chatIdGuide.after":
    "응답 JSON에서 result[].message.chat.id 또는 result[].channel_post.chat.id 값을 복사합니다. 채널 ID는 보통 -100으로 시작합니다. 응답이 비어 있으면 채팅에 새 메시지를 보낸 뒤 다시 실행하세요.",
  "harness.telegram.plugin.title": "Telegram 플러그인 필요",
  "harness.telegram.plugin.descAfter":
    "이 동작하려면 telegram 플러그인이 설치되어 있어야 합니다. 하네스 스토어에서 telegram 플러그인을 설치하거나, CLI에서 같은 플러그인 이름으로 설치한 뒤 채널을 활성화하세요.",

  // --- Slack channel panel (#936 IPC 미러 — 시크릿 원문은 렌더러로 안 내려온다) ---
  "harness.slack.status.idle": "대기",
  "harness.slack.status.connected": "연결",
  "harness.slack.status.needsCheck": "확인 필요",
  "harness.slack.status.disconnected": "미연결",
  "harness.slack.title": "Slack 채널 연결",
  "harness.slack.loadError": "Slack 채널 상태를 불러오지 못했습니다.",
  "harness.slack.needChannelId": "채널 ID를 저장해야 활성화할 수 있습니다.",
  "harness.slack.saved": "채널 설정을 저장했습니다.",
  "harness.slack.saveError": "채널 설정 저장에 실패했습니다.",
  "harness.slack.refreshTitle": "채널 상태 새로고침",
  "harness.slack.enableTitle": "Slack 채널 활성화",
  "harness.slack.enabled": "활성",
  "harness.slack.disabled": "비활성",
  "harness.slack.loading": "채널 상태 확인 중",
  "harness.slack.channelIdPlaceholder": "C0123456789",
  "harness.slack.save": "저장",
  "harness.slack.tokenSavedPlaceholder": "저장됨 — 바꾸려면 새로 입력",
  "harness.slack.probe": "확인",
  "harness.slack.probeTitle": "저장한 자격증명이 실제로 동작하는지 확인",
  "harness.slack.probeOk": "자격증명 확인 완료.",
  "harness.slack.probeFailed": "자격증명 확인에 실패했습니다.",
  "harness.slack.probeResultOk": "자격증명 정상",
  "harness.slack.probeResultFail": "자격증명 확인 실패",
  "harness.slack.probeTeam": "team {team} · bot {bot}",
  "harness.slack.probeAppTokenOk": "app token(Socket Mode) 정상",
  "harness.slack.probeAppTokenSkipped": "app token 미확인(미입력 또는 건너뜀)",
  "harness.slack.remove": "채널 해제",
  "harness.slack.removeConfirm":
    "현재 프로젝트의 Slack 채널 연결을 해제하시겠습니까? 저장된 토큰이 삭제됩니다.",
  "harness.slack.removed": "채널 연결을 해제했습니다.",
  "harness.slack.removeError": "채널 해제에 실패했습니다.",
  "harness.slack.secretsNotEncrypted":
    "이 기기에서는 토큰이 암호화 없이 저장됩니다(OS 시크릿 저장소 사용 불가).",
  "harness.slack.healthError": "최근 헬스 체크 실패: {error}",
  // Connection guide (collapsible) — Slack 앱 셋업 7단계
  "harness.slack.guide.toggle": "Slack 앱을 어떻게 연결하나요?",
  "harness.slack.guide.step1Before": "",
  "harness.slack.guide.step1After": "에서 새 앱(Create New App)을 만듭니다.",
  "harness.slack.guide.step2":
    "Socket Mode를 켜고 App-Level Token을 발급합니다 (connections:write 스코프, xapp-로 시작).",
  "harness.slack.guide.step3":
    "Bot Token Scopes에 app_mentions:read, chat:write, channels:history를 추가한 뒤 Install to Workspace를 실행해 Bot Token(xoxb-)을 발급합니다.",
  "harness.slack.guide.step4":
    "Event Subscriptions를 켜고 app_mention 이벤트를 구독합니다.",
  "harness.slack.guide.step5":
    "봇을 사용할 채널에 초대하고 채널 ID를 확인합니다. 채널 세부정보의 About/정보 하단 또는 Copy link의 마지막 경로에서 C/G로 시작하는 ID를 복사합니다.",
  "harness.slack.guide.step6":
    "위 패널에 Bot Token과 App Token을 입력해 저장한 뒤 확인(Probe) 버튼으로 동작을 검증합니다.",
  "harness.slack.guide.step7":
    "채널에서 봇을 멘션해 응답이 왕복하는지 확인합니다.",
  "harness.slack.channelIdGuide.title": "채널 ID 확인",
  "harness.slack.channelIdGuide.body":
    "Slack 채널명(#general)이 아니라 C0123456789 같은 채널 ID가 필요합니다. 데스크톱 Slack에서 채널 이름을 누른 뒤 About/정보 하단의 Channel ID를 복사하거나, 채널 링크를 복사해 마지막 경로 조각을 사용하세요. 비공개 채널은 G로 시작할 수 있으며, 봇을 먼저 초대해야 Probe가 통과합니다.",

  // --- GitHub 연결 패널 (leyZnPBHbHUl3H9sRTDF) — 선택사항, 온보딩 필수 아님 ---
  "harness.github.title": "GitHub 계정 연결",
  "harness.github.subtitle":
    "private 저장소 clone·협업용 선택 연결입니다. 시작하기에는 뜨지 않고, 하네스 탭에서 필요할 때만 설정합니다.",
  "harness.github.optionalBadge": "선택",
  "harness.github.status.connected": "연결",
  "harness.github.status.disconnected": "미연결",
  "harness.github.account": "GitHub 계정",
  "harness.github.accountNone": "연결된 계정 없음",
  "harness.github.accountConnected": "device OAuth 연결됨",
  "harness.github.waitingAuth": "브라우저 승인 대기 중",
  "harness.github.connect": "연결하기",
  "harness.github.connected":
    "GitHub가 연결되었습니다. private 저장소를 clone할 수 있습니다.",
  "harness.github.connectFailed": "GitHub 연결을 시작하지 못했습니다.",
  "harness.github.denied": "GitHub 연결이 취소되었습니다.",
  "harness.github.expired":
    "GitHub 연결 코드가 만료되었습니다. 다시 시도하세요.",
  "harness.github.disconnect": "연결 해제",
  "harness.github.disconnectConfirm":
    "이 기기에서 GitHub 연결을 해제하시겠습니까? private 저장소 clone·push 가 막힐 수 있습니다.",
  "harness.github.disconnected": "GitHub 연결을 해제했습니다.",
  "harness.github.disconnectFailed": "연결 해제에 실패했습니다.",
  "harness.github.refreshTitle": "GitHub 연결 상태 새로고침",
  "harness.github.loadError": "GitHub 연결 상태를 불러오지 못했습니다.",
  "harness.github.needLogin":
    "마블로에 로그인한 뒤 GitHub를 연결할 수 있습니다.",
  "harness.github.deviceCodeLabel": "GitHub에서 다음 코드를 입력하세요:",
  "harness.github.deviceCodeHint":
    "코드 입력·승인 후 이 패널이 자동으로 연결 상태로 바뀝니다.",
  "harness.github.openGithub": "GitHub 열기",
  "harness.github.guide.toggle": "GitHub 저장소 접근 가이드",
  "harness.github.guide.step1":
    "먼저 이 섹션의 「연결하기」로 현재 프로젝트의 repo URL·기본 브랜치를 저장합니다.",
  "harness.github.guide.step2Before": "",
  "harness.github.guide.step2After":
    "에서 표시된 코드를 입력하고 Marblo를 승인합니다.",
  "harness.github.guide.step3":
    "private 저장소 clone·push 가 필요하면 위 「GitHub 계정 연결」 버튼으로 device OAuth 코드를 발급합니다.",
  "harness.github.guide.step4":
    "승인이 끝나면 공유·repo 연결(협업) 화면에서도 같은 device OAuth 연결을 재사용합니다.",
  "harness.github.guide.step5":
    "나중에 GitHub App 설치 권한이 열리면 같은 신원으로 자동 상속됩니다 — 다시 로그인할 필요 없습니다.",
  "harness.github.guide.step6":
    "연결 해제는 이 패널의 휴지통 버튼으로 언제든 가능합니다(선택 연결).",
  "harness.github.guide.appTitle": "device OAuth → GitHub App 자동 상속",
  "harness.github.guide.appBody":
    "GitHub 계정 연결은 하네스 탭의 선택 연결입니다. 시작하기 탭의 필수 온보딩에는 나타나지 않습니다. 지금은 device OAuth 가 1차 경로이고, GitHub App 설치 토큰은 같은 계정 경로에서 이어받는 엔드게임입니다.",

  // --- Google Drive 위키 폴더 패널 (MCTHALmNAWPpilTFwe8o) ---
  // ★두 축이 한 패널에 있다: 계정 연결은 유저 단위(1회), 위키 폴더는 프로젝트 단위.
  "harness.drive.title": "Google Workspace",
  // ★약속은 실제 요청 스코프와 같아야 한다(티켓 v5Phjv1WxndUpgFJyrIn).
  // Drive 문서 읽기·Gmail 메일 읽기는 restricted 스코프라 이번 출시에서 요청하지 않는다.
  "harness.drive.subtitle":
    "Calendar·Contacts·스프레드시트 조회와 메일 발송을 Google 계정 1회 연결로 사용합니다. Drive 문서 읽기와 Gmail 메일 읽기는 이번 출시에서 제공하지 않습니다.",
  "harness.drive.status.disconnected": "미연결",
  "harness.drive.status.needsFolder": "폴더 필요",
  "harness.drive.status.bound": "연결",
  "harness.drive.account": "Google 계정",
  "harness.drive.accountNone": "연결된 계정 없음",
  "harness.drive.connect": "Google 계정 연결",
  "harness.drive.reconnect": "다시 연결",
  "harness.drive.connecting": "브라우저에서 동의 진행 중",
  "harness.drive.connected": "Google Workspace 를 연결했습니다.",
  "harness.drive.connectFailed": "Google Workspace 연결에 실패했습니다.",
  "harness.drive.disconnect": "계정 연결 해제",
  "harness.drive.disconnectConfirm":
    "이 기기에서 Google 연결을 해제하시겠습니까? 저장된 인증 정보가 삭제되고 모든 프로젝트의 Calendar·Contacts·스프레드시트 조회와 메일 발송이 멈춥니다.",
  "harness.drive.disconnected": "Google Workspace 연결을 해제했습니다.",
  "harness.drive.disconnectFailed": "연결 해제에 실패했습니다.",
  "harness.drive.gmail": "Gmail 읽기 (이번 출시 미제공)",
  "harness.drive.calendar": "Calendar 읽기",
  "harness.drive.contacts": "Contacts 읽기",
  "harness.drive.scopeReady": "준비됨",
  "harness.drive.scopeNeedsReconnect": "재연결 필요",
  "harness.drive.folderSection": "이 프로젝트의 Drive 위키 폴더 (이번 출시 미제공)",
  "harness.drive.folderNone": "폴더가 지정되지 않았습니다",
  "harness.drive.folderHint":
    "Drive 폴더 지정은 이번 출시에서 제공하지 않습니다. 프로젝트 지식위키는 로컬 폴더(프로젝트의 docs/wiki)로 그대로 동작합니다. 이미 지정해 둔 폴더 정보는 지우지 않고 보관합니다.",
  "harness.drive.searchPlaceholder": "폴더 이름으로 검색 (비우면 최근 폴더)",
  "harness.drive.searchFolders": "폴더 찾기",
  "harness.drive.searching": "폴더 검색 중",
  "harness.drive.noFolders": "조건에 맞는 폴더가 없습니다.",
  "harness.drive.select": "이 폴더로 지정",
  "harness.drive.bound": "위키 폴더를 지정했습니다.",
  "harness.drive.bindFailed": "위키 폴더 지정에 실패했습니다.",
  "harness.drive.clearFolder": "폴더 지정 해제",
  "harness.drive.clearConfirm":
    "이 프로젝트의 위키 폴더 지정을 해제하시겠습니까? 해제하면 이 프로젝트의 에이전트는 Drive 문서를 읽지 못합니다.",
  "harness.drive.cleared": "위키 폴더 지정을 해제했습니다.",
  "harness.drive.clearFailed": "폴더 지정 해제에 실패했습니다.",
  "harness.drive.preview": "범위 확인",
  "harness.drive.previewTitle":
    "에이전트가 보는 범위 그대로 조회해 결과 수를 확인합니다",
  "harness.drive.previewOk": "이 폴더 범위에서 문서 {count}개가 조회됩니다.",
  "harness.drive.previewEmpty":
    "이 폴더 범위에 조회되는 문서가 없습니다(폴더가 비었거나 하위에만 있습니다).",
  "harness.drive.previewTruncated":
    "하위 폴더가 많아 일부만 검색했습니다(폴더 {count}개까지).",
  "harness.drive.loadError": "Drive 상태를 불러오지 못했습니다.",
  "harness.drive.needProject": "프로젝트를 먼저 선택해 주세요.",
  "harness.drive.refreshTitle": "Drive 상태 새로고침",
  // 바인딩은 매 요청 디스크에서 읽고 폴더트리 캐시는 저장 즉시 버리므로,
  // 이미 떠 있는 에이전트도 재시작 없이 새 폴더를 본다.
  "harness.drive.appliesImmediately": "실행 중인 에이전트에도 즉시 적용됩니다.",

  // --- Notion wiki panel (gaUx2Cmsw6EN8ymjL2ks) ---
  "harness.notion.title": "Notion 위키",
  "harness.notion.subtitle":
    "integration token은 1회 저장하고, 위키 DB/페이지는 프로젝트마다 지정합니다.",
  "harness.notion.status.disconnected": "미연결",
  "harness.notion.status.needsBinding": "바인딩 필요",
  "harness.notion.status.bound": "연결",
  "harness.notion.account": "Notion 워크스페이스",
  "harness.notion.accountNone": "연결된 워크스페이스 없음",
  "harness.notion.tokenPlaceholder": "Integration token",
  "harness.notion.workspacePlaceholder": "워크스페이스 이름(선택)",
  "harness.notion.connect": "Notion 연결",
  "harness.notion.reconnect": "다시 연결",
  "harness.notion.connected": "Notion 을 연결했습니다.",
  "harness.notion.connectFailed": "Notion 연결에 실패했습니다.",
  "harness.notion.disconnect": "Notion 연결 해제",
  "harness.notion.disconnectConfirm":
    "이 기기에서 Notion 연결을 해제하시겠습니까? 저장된 인증 정보가 삭제되고 모든 프로젝트의 Notion 조회가 멈춥니다.",
  "harness.notion.disconnected": "Notion 연결을 해제했습니다.",
  "harness.notion.disconnectFailed": "연결 해제에 실패했습니다.",
  "harness.notion.bindingSection": "이 프로젝트의 위키 DB/페이지",
  "harness.notion.bindingNone": "DB 또는 페이지가 지정되지 않았습니다",
  "harness.notion.bindingHint":
    "이 프로젝트의 에이전트는 여기서 고른 DB 또는 페이지 범위만 읽습니다.",
  "harness.notion.searchPlaceholder": "DB/페이지 이름으로 검색",
  "harness.notion.search": "Notion 찾기",
  "harness.notion.searching": "검색 중",
  "harness.notion.noResults": "조건에 맞는 DB/페이지가 없습니다.",
  "harness.notion.select": "이 항목으로 지정",
  "harness.notion.bound": "Notion 위키를 지정했습니다.",
  "harness.notion.bindFailed": "Notion 위키 지정에 실패했습니다.",
  "harness.notion.clearBinding": "Notion 바인딩 해제",
  "harness.notion.clearConfirm":
    "이 프로젝트의 Notion 위키 지정을 해제하시겠습니까? 해제하면 이 프로젝트의 에이전트는 Notion 문서를 읽지 못합니다.",
  "harness.notion.cleared": "Notion 위키 지정을 해제했습니다.",
  "harness.notion.clearFailed": "Notion 지정 해제에 실패했습니다.",
  "harness.notion.preview": "범위 확인",
  "harness.notion.previewTitle":
    "에이전트가 보는 Notion 범위 그대로 조회해 결과 수를 확인합니다",
  "harness.notion.previewOk":
    "이 Notion 범위에서 페이지 {count}개가 조회됩니다.",
  "harness.notion.previewEmpty": "이 Notion 범위에 조회되는 페이지가 없습니다.",
  "harness.notion.loadError": "Notion 상태를 불러오지 못했습니다.",
  "harness.notion.needProject": "프로젝트를 먼저 선택해 주세요.",
  "harness.notion.refreshTitle": "Notion 상태 새로고침",
  "harness.notion.appliesImmediately":
    "실행 중인 에이전트에도 즉시 적용됩니다.",

  // HarnessVersionBadge — tooltip for an agent's installed CLI version
  "harness.installedCliVersion": "설치된 CLI 버전 v{version}",

  // --- Public registry store (marblo-app/marblo) ---
  // 최상위 스토어 탭 헤더
  "store.tab.title": "스토어",
  "store.tab.subtitle": "공개 레지스트리의 스킬·MCP·에이전트 카탈로그",
  "harness.store.registry.title": "공개 레지스트리",
  "harness.store.registry.subtitle":
    "공개 레지스트리(marblo-app/marblo)의 전체 카탈로그입니다. 공식·검증됨 tier 는 원클릭 설치되고, 커뮤니티 tier 는 미검수라 경고에 동의해야만 설치됩니다. tier 와 권한은 공시이며, 설치 후 동작을 제한하지 않습니다.",
  "harness.store.registry.category.all": "전체",
  "harness.store.registry.skills": "스킬",
  "harness.store.registry.mcp": "MCP",
  "harness.store.registry.agents": "에이전트",
  "harness.store.registry.workflows": "워크플로",
  "harness.store.registry.study": "스터디",
  "harness.store.registry.other": "기타",
  "harness.store.registry.stale":
    "레지스트리에 연결하지 못해 마지막으로 확인한 목록을 표시 중입니다.",
  "harness.store.registry.unavailable":
    "레지스트리에 연결할 수 없습니다. 내장 카탈로그는 정상 동작합니다.",
  "harness.store.registry.refresh": "새로고침",
  "harness.store.registry.tier.official": "공식",
  "harness.store.registry.tier.verified": "검증됨",
  "harness.store.registry.tier.community": "커뮤니티",
  "harness.store.registry.referenceOnly":
    "참조 전용 — 인앱 설치 없이 링크로 열람합니다.",
  "harness.store.registry.usage.skill":
    "설치하면 에이전트가 슬래시 커맨드(/이름) 또는 자동으로 이 스킬을 사용합니다.",
  "harness.store.registry.usage.mcpServer":
    "설치하면 에이전트 MCP 설정에 등록되어 도구로 자동 노출됩니다.",
  "harness.store.registry.usage.agent":
    "설치하면 에이전트를 스폰할 때 이 에이전트 유형으로 선택할 수 있습니다.",
  "harness.store.registry.usage.workflow":
    "참고 전용 — 설치가 아니라 문서로 열람합니다.",
  "harness.store.registry.usage.knowledge":
    "지식팩(참고 전용) — 에이전트 컨텍스트 참고 자료로 열람합니다.",
  "harness.store.registry.communityWarnTitle": "미검수 항목 설치",
  "harness.store.registry.communityWarnBody":
    "이 항목은 커뮤니티 tier 로, Marblo 가 내용을 검수하지 않았습니다. 설치하면 {source} 의 콘텐츠가 내 머신에 내려받아져 에이전트가 로드할 수 있습니다. 출처를 직접 확인한 뒤에만 진행하세요.",
  "harness.store.registry.communityWarnConsent":
    "위 출처({source})를 신뢰하고 설치합니다.",
  "harness.store.registry.communityWarnConfirm": "동의하고 설치",
  "harness.store.registry.permissions": "요구 권한(공시)",
  "harness.store.registry.permissionsNone": "권한 필요 없음(명시)",
  "harness.store.registry.permissionsUndeclared": "권한 미신고",
  "harness.store.registry.highRisk": "고위험",
  "harness.store.registry.disclosureTitle": "설치 전 권한 공시",
  "harness.store.registry.disclosureNote":
    "Marblo 는 항목이 필요하다고 공시한 권한을 보여줄 뿐, 설치 후 실제 동작을 제한하지 않습니다. 신뢰할 수 있는 항목만 설치하세요.",
  "harness.store.registry.disclosureConfirm": "확인하고 설치",
  "harness.store.registry.disclosureCancel": "취소",
  "harness.store.registry.install": "설치",
  "harness.store.registry.installing": "설치 중…",
  "harness.store.registry.uninstall": "제거",
  "harness.store.registry.uninstallConfirm":
    "{name} 을(를) 제거할까요? 설치 시 원장에 기록된 파일만 삭제됩니다.",
  "harness.store.registry.installed": "설치됨",
  "harness.store.registry.outdated": "업데이트 있음",
  "harness.store.registry.notInstallable": "원클릭 설치 불가",
  "harness.store.registry.revoked": "회수됨",
  "harness.store.registry.installDone": "{name} 설치 완료.",
  "harness.store.registry.installFail": "설치에 실패했습니다.",
  "harness.store.registry.uninstallDone": "{name} 제거 완료.",
  "harness.store.registry.uninstallFail": "제거에 실패했습니다.",
  // --- 별점(★1~5) — 산식은 electron/registry-rating.ts, 설명은 docs/store-rating.md ---
  "harness.store.registry.rating.aria": "별점 {stars}점 / 5점",
  "harness.store.registry.rating.title": "★ {stars}/5 (원점수 {score})",
  "harness.store.registry.rating.formula":
    "산식: 유용성 50% + 인증 30% + 라이선스 10% + 신선도 10%",
  "harness.store.registry.rating.snapshotAt": "스타 스냅샷 기준: {date}",
  "harness.store.registry.rating.reason.stars":
    "업스트림 GitHub 스타 {stars}개",
  "harness.store.registry.rating.reason.starsMissing":
    "업스트림 저장소({repo})가 스타 스냅샷에 없음 — 유용성 0점",
  "harness.store.registry.rating.reason.usefulnessUnmeasurable":
    "업스트림 저장소가 없어 스타로 유용성을 잴 수 없음 — 유용성 성분 제외, ★4 상한",
  "harness.store.registry.rating.reason.verifiedPin":
    "출처 검증 통과 — 허용 호스트(GitHub) + 불변 핀",
  "harness.store.registry.rating.reason.unpinnedSource":
    "출처 ref 가 불변 핀(커밋 SHA·버전 태그)이 아님",
  "harness.store.registry.rating.reason.hostRejected":
    "출처 저장소가 허용 호스트 형식이 아님",
  "harness.store.registry.rating.reason.verifiedIntegrity":
    "무결성 확인 — 설치 바이트가 전수 대조됨",
  "harness.store.registry.rating.reason.integrityNotApplicable":
    "인앱 설치 대상이 아님 — 무결성 항목 제외(설치 계약 없음)",
  "harness.store.registry.rating.reason.noIntegrity": "무결성 대조 근거 없음",
  "harness.store.registry.rating.reason.licenseOsi":
    "OSI 승인 라이선스({license})",
  "harness.store.registry.rating.reason.licensePublicDomain":
    "퍼블릭 도메인 헌정({license})",
  "harness.store.registry.rating.reason.licenseNonOsi":
    "비OSI 라이선스({license}) — 레지스트리 정책 위반, ★2 상한",
  "harness.store.registry.rating.reason.licenseUnrecognized":
    "미인식 라이선스({license})",
  "harness.store.registry.rating.reason.licenseUndeclared": "라이선스 미신고",
  "harness.store.registry.rating.reason.freshPin":
    "핀이 업스트림 최신 커밋을 가리킴",
  "harness.store.registry.rating.reason.freshUpstream":
    "업스트림 최근 활동 ({days}일 전)",
  "harness.store.registry.rating.reason.staleUpstream":
    "업스트림 마지막 활동 {days}일 전",
  "harness.store.registry.rating.reason.archivedUpstream":
    "업스트림 저장소가 아카이브(동결)됨",
  "harness.store.registry.rating.reason.freshnessUnknown":
    "업스트림 활동 정보 없음 — 신선도 성분 제외",
  "harness.store.registry.rating.reason.capRevoked": "회수된 항목 — ★1 로 고정",
  "harness.store.registry.rating.reason.capDeprecated":
    "지원 종료 항목 — ★3 상한",
  "harness.store.registry.rating.reason.capUnverifiedSource":
    "출처를 검증할 수 없음 — ★4 상한(★5 는 허용 호스트 + 불변 핀 통과 필수)",
  "harness.store.registry.rating.helpToggle": "별점은 어떻게 매기나요?",
  "harness.store.registry.rating.helpIntro":
    "사람이 매긴 점수가 아닙니다. 네 가지 객관 신호의 가중합을 1~5로 환산하고, 별 옆에 마우스를 올리면 그 항목의 근거가 그대로 나옵니다.",
  "harness.store.registry.rating.helpUsefulness":
    "유용성 50% — 업스트림 GitHub 스타(로그 스케일: 10배마다 한 칸). 스타가 붙는 대상은 실제 설치 바이트가 오는 저장소뿐입니다.",
  "harness.store.registry.rating.helpVerification":
    "인증 30% — 설치 직전 검사와 같은 규칙: 허용 호스트, 불변 핀(커밋 SHA·버전 태그), 파일 단위 무결성 대조.",
  "harness.store.registry.rating.helpLicense":
    "라이선스 10% — OSI 승인 라이선스만 만점. 미신고·미인식은 감점, 비OSI(FSL·BUSL·NC 등)는 정책 위반이라 ★2 상한.",
  "harness.store.registry.rating.helpFreshness":
    "신선도 10% — 핀이 업스트림 최신인지, 업스트림이 아직 살아 있는지(아카이브·장기 방치는 감점).",
  "harness.store.registry.rating.helpCaps":
    "상한: 회수됨 ★1 고정 · 비OSI ★2 · 지원 종료 ★3 · 출처 미검증 ★4 · 업스트림이 없어 유용성을 못 재는 항목 ★4. ★5 는 업스트림에서 실증된 수요와 출처 검증 통과를 동시에 만족할 때만 나옵니다.",
  "harness.store.registry.rating.helpSource":
    "스타 수치는 릴리스 빌드 시점에 한 번 수집한 스냅샷에서 읽습니다 — 스토어를 열 때 GitHub 를 조회하지 않으며, 점수는 앱 안에서 바꿀 수 없습니다.",
  // 별점은 메인 프로세스가 산출한다. 렌더러만 새 코드이고 메인이 구버전이면
  // 응답에 별점이 아예 없는데, 그때 카드에서 ★가 조용히 사라지면 사용자는
  // "별점 기능이 고장났다"고 읽는다. 원인을 화면에 적는다.
  "harness.store.registry.rating.mainOutdated":
    "★ 별점을 표시할 수 없습니다 — 실행 중인 앱이 별점 이전 버전입니다. 앱을 재시작하면 나타납니다.",

  "harness.store.registry.source": "소스",
  "harness.store.registry.loadFail": "레지스트리 목록을 불러오지 못했습니다.",
  // 커뮤니티 tier 는 목록에 뜨고, 설치엔 별도 동의가 필요하다 — 한 줄로 공시.
  "harness.store.registry.communityListedNote":
    "이 중 커뮤니티 {count}개는 미검수 — 설치 시 별도 동의 필요",
  "harness.store.registry.githubCatalog": "GitHub 전체 카탈로그 →",
  "harness.store.registry.emptyCatalog":
    "표시할 자산이 없습니다. 전체 카탈로그는 GitHub에서 볼 수 있습니다.",

  // --- 스토어 '로컬 모델'(Ollama) 탭 — first-party 큐레이션(§4.4) ---
  "harness.store.local.tab": "로컬 모델",
  "harness.store.local.title": "로컬 모델 (Ollama)",
  "harness.store.local.subtitle":
    "내 기기에서 무료로 도는 소형 모델의 first-party 큐레이션입니다. 시스템 메모리를 실측해 맞는 모델만 원클릭(ollama pull)으로 설치되고, 설치된 모델은 에이전트 추가의 Local Model 에서 고를 수 있습니다.",
  "harness.store.local.guideTitle": "메모리·양자화 가이드",
  "harness.store.local.guide.toggle": "Ollama를 어떻게 설치·사용하나요?",
  "harness.store.local.guide.step1Before": "Ollama를 설치합니다 — ",
  "harness.store.local.guide.step1After":
    " 에서 받거나, macOS면 `brew install ollama` 로 설치한 뒤 Ollama 앱(또는 `ollama serve`)을 켭니다.",
  "harness.store.local.guide.step2":
    "아래 카드에서 기기에 맞는 모델을 고르고 「설치 (ollama pull)」을 누릅니다. RAM이 부족하면 버튼이 비활성으로 남습니다.",
  "harness.store.local.guide.step3":
    "설치가 끝나면 에이전트 추가 → Local Model 에서 그 모델을 선택해 스폰합니다. (오케스트레이터용 env-swap은 별도 후속.)",
  "harness.store.local.guideRam":
    "권장 RAM = 모델 상주 메모리 + OS/앱 여유입니다. Mac 은 통합메모리라 GPU 가 같은 RAM 을 씁니다 — 표기된 최소 권장치보다 여유가 있을수록 안정적입니다.",
  "harness.store.local.guideQuant":
    "카탈로그 크기는 ollama 기본 4bit 계열 양자화(Q4_K_M 등) 기준입니다. 양자화 비트가 낮을수록 작고 빠르지만 품질이 조금 떨어집니다.",
  "harness.store.local.guideContext":
    "컨텍스트 표기는 모델의 최대치입니다. 실행 시 기본 컨텍스트는 이보다 작게 잡히며(ollama 기본 ~4K), 컨텍스트를 키우면 그만큼 메모리를 더 씁니다.",
  "harness.store.local.guideToolUse":
    "7B 미만은 「대화 전용」(테스트·스모크)입니다. Marblo 에이전트/오케 실작업(MCP tool-use)은 7B+ coder(예: qwen2.5-coder:7b)를 쓰세요. 소형에 툴을 주입하면 JSON 흉내·엉뚱한 답이 납니다.",
  "harness.store.local.badgeChatOnly": "대화 전용",
  "harness.store.local.badgeToolUseLite": "tool-use 지원(경량)",
  "harness.store.local.toolUseLiteHint":
    "도구는 쓰되 주입량을 깎은 경량 프로파일로 스폰됩니다(25~30B). MCP 표면 최소 + 역할 브리프 + 완료규약 compact.",
  "harness.store.local.installedHintToolUseLite":
    "에이전트 추가 → Local Model 에서 선택하면 경량 주입 프로파일로 도구를 쓸 수 있습니다.",
  "harness.store.local.paramSize": "파라미터",
  "harness.store.local.paramUnknown": "파라미터 미상",
  "harness.store.local.huggingFace": "HuggingFace",
  "harness.store.local.huggingFaceAria":
    "{name} 모델 원본 페이지(HuggingFace) 열기",
  "harness.store.local.memoryTierTitle.8": "8GB 이하로 도는 모델",
  "harness.store.local.memoryTierTitle.16": "16GB 급",
  "harness.store.local.memoryTierTitle.32": "32GB 급",
  "harness.store.local.memoryTierTitle.48plus":
    "48GB 이상 (도구 사용 가능 구간)",
  "harness.store.local.memoryTierRunnable": "내 기기에서 실행 가능",
  "harness.store.local.memoryTierTooBig": "내 기기 메모리로는 부족",
  "harness.store.local.memoryTierCount": "{count}개",
  "harness.store.local.outsideCatalogTitle": "카탈로그 외 설치됨",
  "harness.store.local.outsideCatalogNote":
    "큐레이션 목록에는 없지만 이 기기에 설치되어 있는 모델입니다(직접 `ollama pull` 했거나, 큐레이션에서 내려간 모델). 에이전트 추가에서는 그대로 선택할 수 있습니다.",
  "harness.store.local.badgeToolUse": "tool-use 지원",
  "harness.store.local.chatOnlyHint":
    "테스트·대화용. 에이전트 실작업에는 7B+ coder를 쓰세요.",
  "harness.store.local.toolUseHint":
    "MCP tool-use / 에이전트 실작업에 사용할 수 있습니다. 코딩 작업은 coder 계열 권장.",
  "harness.store.local.installedHintChatOnly":
    "대화·테스트용으로 Local Model에서 선택하세요. 티켓 실작업은 7B+ coder를 설치하세요.",
  "harness.store.local.installedHintToolUse":
    "에이전트 추가 → Local Model에서 이 모델을 선택해 실작업에 쓸 수 있습니다.",
  "harness.store.local.hardwareLine": "이 기기 메모리: {gb} GB",
  "harness.store.local.unifiedMemoryNote": "통합메모리(GPU 공유)",
  "harness.store.local.ollamaMissing":
    "Ollama 가 설치되어 있지 않아 원클릭 설치를 할 수 없습니다. 먼저 Ollama 를 설치하세요:",
  "harness.store.local.ollamaInstallLink": "ollama.com/download →",
  "harness.store.local.ollamaMissingShort": "Ollama 미설치",
  "harness.store.local.daemonStopped":
    "Ollama 는 설치되어 있지만 데몬이 실행 중이 아닙니다. Ollama 앱을 실행하거나 `ollama serve` 를 켠 뒤 새로고침하세요.",
  "harness.store.local.daemonStoppedShort": "Ollama 데몬 정지",
  "harness.store.local.loading": "로컬 모델 상태 확인 중…",
  "harness.store.local.loadFail": "로컬 모델 상태를 확인하지 못했습니다.",
  "harness.store.local.installed": "설치됨",
  "harness.store.local.fits": "내 기기에 맞음",
  "harness.store.local.insufficientRam": "부족 ({gb} GB 필요)",
  "harness.store.local.downloadSize": "다운로드",
  "harness.store.local.minRam": "최소 RAM",
  "harness.store.local.context": "컨텍스트",
  "harness.store.local.pull": "설치 (ollama pull)",
  "harness.store.local.installing": "설치 진행 중",
  "harness.store.local.progressPending": "준비 중",
  "harness.store.local.cancel": "취소",
  "harness.store.local.pullDone":
    "{id} 설치 완료 — 에이전트 추가의 Local Model 에서 선택할 수 있습니다.",
  "harness.store.local.pullCancelled":
    "{id} 설치를 취소했습니다(부분 다운로드는 재시도 시 이어받습니다).",
  "harness.store.local.pullFail": "{id} 설치 실패: {error}",
  "harness.store.local.installedHint":
    "에이전트 추가 → Local Model 에서 이 모델을 선택하세요.",
  "harness.store.local.desc.qwen25_05b":
    "가장 가벼운 시험·대화용(대화 전용). 에이전트 실작업·MCP tool-use에는 쓰지 마세요 — 7B+ coder를 쓰세요.",
  "harness.store.local.desc.qwen25_15b":
    "가벼움과 품질의 균형(대화 전용) — 요약·분류 스모크에 적합. 실작업은 7B+ coder.",
  "harness.store.local.desc.llama32_1b":
    "Meta 의 초소형 모델 — 128K 컨텍스트를 지원하는 가장 작은 축입니다.",
  "harness.store.local.desc.llama32_3b":
    "소형 중 상위 품질 — 8GB 이상 기기에서 무난하게 돕니다.",
  "harness.store.local.desc.phi3_mini":
    "Microsoft 의 3.8B 모델 — 크기 대비 추론 품질이 좋습니다.",
  "harness.store.local.desc.gemma2_2b":
    "Google 의 2B 모델 — 짧은 대화·초안 작성에 적합합니다.",
};
