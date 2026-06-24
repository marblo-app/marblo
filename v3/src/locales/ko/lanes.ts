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
  "lanes.header.subtitle":
    "메인 작업과 병렬로 — 떠오른 개선점을 독립 워크트리에서 빠르게",
  "lanes.newButton": "＋ 빠른 작업",

  // Empty state
  "lanes.empty.title": "진행 중인 빠른 작업이 없습니다.",
  "lanes.empty.hint":
    "“＋ 빠른 작업”으로 개선점을 격리된 워크트리에서 시작하세요.",
  "lanes.noProjectPlaceholder":
    "프로젝트를 선택하면 빠른 작업을 시작할 수 있습니다.",

  // Row
  "lanes.row.worktreePreparing": "워크트리 준비 중…",
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
