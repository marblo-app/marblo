/**
 * Korean — `harness.*` namespace (Harness Store surface: connection status
 * panel + package catalog). One namespace per file so parallel i18n PRs don't
 * collide on a single monolith. Keys keep their fully-qualified dotted form.
 */
export const harness = {
  // --- Connection status panel ---
  "harness.conn.title": "연결 상태",
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
    "현재 프로젝트의 로컬 경로로 연결을 만들면 repo URL·기본 브랜치를 git 에서 자동으로 채웁니다.",
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
  "harness.store.cat.required": "필수 (자동 설치)",
  "harness.store.cat.recommended": "추천 스킬",
  "harness.store.cat.mcp": "유용한 MCP",
  "harness.store.cat.cli": "CLI",
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
  "harness.store.title": "Harness 스토어",
  "harness.store.subtitle": "스킬 / MCP 한 번에 설치",
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
  "harness.store.installing": "설치 중...",
  "harness.store.viewGuide": "안내 보기",
  "harness.store.bundled": "자동 설치됨",
  "harness.store.requiredInstall": "필수 — 설치",
  "harness.store.processing": "처리 중...",
  "harness.store.uninstall": "제거",
  "harness.store.requiredNoRemove": "필수 패키지 — 제거 불가",
  "harness.store.deprecatedNoInstall": "단종 예정 — 설치 비권장",
  "harness.store.docs": "문서 →",
  "harness.store.footerMcp":
    "Marblo MCP는 대시보드 내부에서 spawn 된 에이전트에만 자동 연결됩니다 (per-agent isolated config). 외부 터미널 CLI 세션은 사용자의 taskforce MCP 등 별도 설정으로 관리하세요.",
  "harness.store.footerGithub":
    "외부 GitHub URL 직접 설치는 차후 추가될 예정입니다 (신뢰 검증 후).",
  // --- Telegram channel panel ---
  // Status badge (fixed-set labels)
  "harness.telegram.status.idle": "대기",
  "harness.telegram.status.connected": "연결",
  "harness.telegram.status.needsCheck": "확인 필요",
  "harness.telegram.status.disconnected": "미연결",
  "harness.telegram.title": "채널 연결",
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
    "대상이 공개 채널이면 @username을, 비공개 채널/그룹이면 Telegram API 응답에서 chatId를 확인합니다.",
  "harness.telegram.guide.step4":
    "bot token과 chatId를 입력해 저장한 뒤 활성 토글을 켭니다.",
  "harness.telegram.plugin.title": "Telegram 플러그인 필요",
  "harness.telegram.plugin.descAfter":
    "이 동작하려면 telegram 플러그인이 설치되어 있어야 합니다. 하네스 스토어에서 telegram 플러그인을 설치하거나, CLI에서 같은 플러그인 이름으로 설치한 뒤 채널을 활성화하세요.",

  // HarnessVersionBadge — tooltip for an agent's installed CLI version
  "harness.installedCliVersion": "설치된 CLI 버전 v{version}",
};
