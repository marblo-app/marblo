/**
 * Korean — `lanes.*` namespace (Lanes tab + lane create/delete modals: quick
 * parallel tasks in isolated worktrees). UI chrome and user-facing
 * status/error banners only — task titles, branch names and the agent prompt
 * stay as data. Keys keep their dotted form.
 */
export const lanes = {
  // LaneTerminalButton
  "lanes.terminal.view": "터미널 보기",
  "lanes.terminal.connect": "세션에 연결",
  "lanes.terminal.noSession": "실행 중인 세션이 없습니다",
  "lanes.terminal.label": "터미널",
  "lanes.terminal.connectBadge": "(연결)",

  // Header
  "lanes.header.title": "퀵레인",
  "lanes.header.subtitle":
    "메인 작업과 병렬로 — 떠오른 개선점을 독립 워크트리에서 빠르게",
  "lanes.header.runningCount": "{count}개 병렬 실행 중",
  "lanes.newButton": "＋ 빠른 작업",

  // 낙관적(pending) 카드 — 티켓/에이전트 doc 이 돌아오기 전 단계 표시
  "lanes.pending.creating": "티켓 생성 중…",
  "lanes.pending.spawning": "에이전트 스폰 · 워크트리 준비 중…",
  "lanes.pending.dismiss": "닫기",

  // 모델 셀렉터(벤더 → 구체 모델 → effort). 목록은 model-registry 파생이라
  // 여기엔 모델 이름이 없다 — 라벨만 있다.
  "lanes.model.vendorLabel": "프로바이더",
  "lanes.model.modelLabel": "모델",
  "lanes.model.effortLabel": "reasoning effort",
  "lanes.model.effortDefault": "기본({value})",
  "lanes.model.loading": "모델 목록 불러오는 중…",
  "lanes.model.unavailable": "모델 목록을 불러오지 못했습니다.",
  "lanes.model.retry": "다시 시도",
  "lanes.model.keyRequiredBadge": "키 필요",
  "lanes.model.missingKeys": "다음 환경변수가 필요합니다: {keys}",
  "lanes.model.envHint": "키 미등록: {vendors} — v3/.env 에 추가하면 켜집니다.",
  "lanes.model.estimated": "추정단가",
  "lanes.model.estimatedTip":
    "공식 단가를 확인하지 못해 보수적으로(높게) 잡은 값입니다.",

  // Empty state
  "lanes.empty.title": "진행 중인 빠른 작업이 없습니다.",
  "lanes.empty.hint":
    "“＋ 빠른 작업”으로 개선점을 격리된 워크트리에서 시작하세요.",
  "lanes.noProjectPlaceholder":
    "프로젝트를 선택하면 빠른 작업을 시작할 수 있습니다.",

  // Status pills (laneStatusPill — terminal task states + idle)
  "lanes.pill.done": "완료",
  "lanes.pill.review": "리뷰",
  "lanes.pill.failed": "실패",
  "lanes.pill.idle": "준비 중",

  // 라인(상태 레인) 헤더 — lib/laneGroups 의 LANE_GROUPS 와 1:1
  "lanes.group.active": "진행 중",
  "lanes.group.review": "리뷰",
  "lanes.group.attention": "주의 필요",
  "lanes.group.done": "완료",

  // Row
  "lanes.row.worktreePreparing": "워크트리 준비 중…",
  "lanes.row.openDetail": "{title} 상세 열기",
  "lanes.row.openDetailTip":
    "클릭하면 티켓·에이전트·워크트리·히스토리를 봅니다",

  // 상세 드로우
  "lanes.detail.title": "레인 상세",
  "lanes.detail.close": "닫기",
  "lanes.detail.copy": "복사",
  "lanes.detail.copied": "복사됨",
  "lanes.detail.ticket": "연결 티켓",
  "lanes.detail.ticketId": "티켓 ID",
  "lanes.detail.status": "상태",
  "lanes.detail.created": "생성",
  "lanes.detail.updated": "갱신",
  "lanes.detail.openTicket": "티켓 상세 열기 (본문·코멘트·diff)",
  "lanes.detail.agent": "담당 에이전트",
  "lanes.detail.agentName": "이름",
  "lanes.detail.agentStatus": "에이전트 상태",
  "lanes.detail.harness": "하네스",
  "lanes.detail.claimedBy": "선점자",
  "lanes.detail.unclaimed": "미선점",
  "lanes.detail.noAgent": "이 레인에 연결된 에이전트가 없습니다.",
  "lanes.detail.worktree": "워크트리",
  "lanes.detail.branch": "브랜치",
  "lanes.detail.baseRef": "기준",
  "lanes.detail.path": "경로",
  "lanes.detail.diffStat": "변경",
  "lanes.detail.filesChanged": "파일 {count}개",
  "lanes.detail.conflicts": "충돌 {count}건",
  "lanes.detail.history": "히스토리 ({count})",
  "lanes.detail.noHistory": "아직 기록이 없습니다.",
  "lanes.detail.timeline.created": "티켓 생성",
  "lanes.detail.timeline.claimed": "{actor} 선점",
  "lanes.detail.timeline.status": "상태 → {status}",
  "lanes.row.restartTip": "충돌/실패 상태의 레인 항목을 다시 시작",
  "lanes.row.restarting": "재시작 중…",
  "lanes.row.restart": "재시작",
  "lanes.row.deleteTip": "완료/중단/충돌/실패 레인 항목 삭제",
  "lanes.row.deleting": "삭제 중…",
  "lanes.row.delete": "삭제",

  // Launch / limit errors
  "lanes.error.noProject": "프로젝트를 먼저 선택하세요.",
  "lanes.error.noRepoRoot":
    "프로젝트 폴더 경로가 없어 격리 워크트리를 만들 수 없습니다. 사이드바에서 프로젝트 폴더를 먼저 여세요.",
  "lanes.error.agentLimit": "에이전트 동시 실행 한도에 도달했습니다.",
  "lanes.error.needsAuth": "{model} CLI 인증이 필요합니다: {action}",

  // Delete flow (multi-step, banners)
  "lanes.delete.fatalStep":
    '레인 삭제가 "{step}" 단계에서 중단되었습니다: {error}',
  "lanes.delete.completedSteps": "완료된 단계: {steps}",
  "lanes.delete.warningsLine": "경고: {warnings}",
  "lanes.delete.retryHint":
    "항목이 목록에 남아 있으니 문제 해결 후 '삭제'로 재시도할 수 있습니다.",
  "lanes.delete.step.stopAgent": "에이전트 중지",
  "lanes.delete.warn.stopAgent":
    "에이전트 중지 실패(이미 종료됐을 수 있음): {error}",
  "lanes.delete.step.removeWorktree": "워크트리/브랜치 제거",
  "lanes.delete.warn.removeAgentProc": "에이전트 프로세스 정리 실패: {error}",
  "lanes.delete.step.deleteAgent": "에이전트 기록 삭제",
  "lanes.delete.step.deleteTask": "태스크 기록 삭제",
  "lanes.msg.deleted": '"{title}" 레인 항목을 삭제했습니다.',
  "lanes.msg.deletedWithWarnings": "경고(삭제는 완료됨): {warnings}",

  // Restart
  "lanes.error.noAgentToRestart": "재시작할 에이전트가 없습니다.",
  "lanes.msg.restarted": '"{title}" 레인 항목을 다시 시작했습니다.',
  "lanes.error.restartFailed": "레인 항목 재시작 실패",

  // LaneCreateModal
  "lanes.create.title": "＋ 빠른 작업",
  "lanes.create.whatLabel": "무엇을 할까요?",
  "lanes.create.placeholder": "예: 로그인 에러 메시지 개선",
  "lanes.create.agentLabel": "에이전트",
  "lanes.create.cancel": "취소",
  "lanes.create.starting": "시작 중…",
  "lanes.create.start": "시작",

  // LaneDeleteConfirmModal
  "lanes.confirm.title": "레인 항목 삭제",
  "lanes.confirm.bodyPre": "",
  "lanes.confirm.bodyPost": " 레인 항목을 삭제할까요?",
  "lanes.confirm.warnHeader":
    "이 작업은 되돌릴 수 없으며 아래 항목이 함께 제거됩니다:",
  "lanes.confirm.itemAgent": "에이전트 프로세스 및 기록",
  "lanes.confirm.itemTask": "태스크 기록",
  "lanes.confirm.itemWorktree": "격리 워크트리와 브랜치",
  "lanes.confirm.cancel": "취소",
  "lanes.confirm.delete": "삭제",
};
