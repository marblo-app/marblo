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
  "harness.store.cat.envswap": "env-swap 벤더",
  // --- env-swap 벤더 섹션 (설치가 아니라 키 등록) ---
  // ★벤더 이름·모델 id 가 이 표에 하나도 없다. 목록은 model-registry 파생이고,
  //   여기 있는 것은 "설치할 CLI 가 아니라 키를 얹는 것" 이라는 분류 문구뿐이다.
  "harness.store.envSwap.title": "env-swap 벤더",
  "harness.store.envSwap.subtitle":
    "claude 하네스에 API 키만 얹어 쓰는 벤더입니다 — 설치할 CLI 가 없고, 키를 등록하면 바로 켜집니다.",
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
  "harness.store.subtitle": "CLI·벤더·채널 — 이 앱이 쓰려면 필요한 연결",
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
  "harness.store.footerStoreMoved":
    "스킬·MCP 자산 설치는 상단 '스토어' 탭으로 옮겨졌습니다.",
  // --- 연결 섹션 머리줄 ---
  "harness.store.section.connections": "연결",
  "harness.store.section.connectionsDesc":
    "CLI·벤더·채널을 이 앱에 연결합니다.",
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
  "harness.store.registry.notInstallable": "자동 설치 불가",
  "harness.store.registry.revoked": "회수됨",
  "harness.store.registry.installDone": "{name} 설치 완료.",
  "harness.store.registry.installFail": "설치에 실패했습니다.",
  "harness.store.registry.uninstallDone": "{name} 제거 완료.",
  "harness.store.registry.uninstallFail": "제거에 실패했습니다.",
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
  "harness.store.local.guideRam":
    "권장 RAM = 모델 상주 메모리 + OS/앱 여유입니다. Mac 은 통합메모리라 GPU 가 같은 RAM 을 씁니다 — 표기된 최소 권장치보다 여유가 있을수록 안정적입니다.",
  "harness.store.local.guideQuant":
    "카탈로그 크기는 ollama 기본 4bit 계열 양자화(Q4_K_M 등) 기준입니다. 양자화 비트가 낮을수록 작고 빠르지만 품질이 조금 떨어집니다.",
  "harness.store.local.guideContext":
    "컨텍스트 표기는 모델의 최대치입니다. 실행 시 기본 컨텍스트는 이보다 작게 잡히며(ollama 기본 ~4K), 컨텍스트를 키우면 그만큼 메모리를 더 씁니다.",
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
  "harness.store.local.cancel": "취소",
  "harness.store.local.pullDone":
    "{id} 설치 완료 — 에이전트 추가의 Local Model 에서 선택할 수 있습니다.",
  "harness.store.local.pullCancelled":
    "{id} 설치를 취소했습니다(부분 다운로드는 재시도 시 이어받습니다).",
  "harness.store.local.pullFail": "{id} 설치 실패: {error}",
  "harness.store.local.installedHint":
    "에이전트 추가 → Local Model 에서 이 모델을 선택하세요.",
  "harness.store.local.desc.qwen25_05b":
    "가장 가벼운 시험용 — 저사양 기기에서도 즉시 응답을 확인할 수 있습니다.",
  "harness.store.local.desc.qwen25_15b":
    "가벼움과 품질의 균형 — 요약·분류 같은 단순 작업에 적합합니다.",
  "harness.store.local.desc.llama32_1b":
    "Meta 의 초소형 모델 — 128K 컨텍스트를 지원하는 가장 작은 축입니다.",
  "harness.store.local.desc.llama32_3b":
    "소형 중 상위 품질 — 8GB 이상 기기에서 무난하게 돕니다.",
  "harness.store.local.desc.phi3_mini":
    "Microsoft 의 3.8B 모델 — 크기 대비 추론 품질이 좋습니다.",
  "harness.store.local.desc.gemma2_2b":
    "Google 의 2B 모델 — 짧은 대화·초안 작성에 적합합니다.",
};
