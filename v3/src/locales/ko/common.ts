/**
 * Korean — `common.*` namespace.
 *
 * Two roles:
 *   1. Generic UI words (confirm/cancel/save/loading/close/unknown) reusable
 *      across surfaces — the dedup target later PRs can fold into.
 *   2. Home for the **non-React** user-facing strings (toasts, thrown errors,
 *      status labels) that live in services/stores/hooks. These reach the UI
 *      via the pure `t()` in lib/i18n.ts, so they belong in the table too.
 *
 * Grouped by dotted sub-prefix (common.team.*, common.payment.*, …) so the
 * single file stays readable. Placeholders use `{name}` form.
 */
export const common = {
  // — generic shared words —
  "common.confirm": "확인",
  "common.cancel": "취소",
  "common.save": "저장",
  "common.loading": "로딩 중...",
  "common.loadingProjects": "프로젝트 불러오는 중...",
  "common.restoringSession": "세션 복원 중...",
  "common.selectFolderPrompt": "프로젝트 폴더를 선택하여 시작하세요",
  "common.close": "닫기",
  "common.unknown": "알 수 없음",
  "common.loginRequired": "로그인이 필요합니다.",

  // — 기간 선택기 (components/common/PeriodSelector: 사용량 탭 + 작업내역 탭 공용) —
  "common.period.label": "기간",
  "common.period.7d": "7일",
  "common.period.30d": "30일",
  "common.period.all": "전체",

  // — agent runtime guard (stores/agentStore) —
  "common.agentLimitReached": "현재 플랜의 동시 에이전트 한도에 도달했습니다.",

  // — team / invitations (services/teamService, hooks/useTeam) —
  "common.team.duplicateInvite": "이미 대기 중인 초대가 있습니다.",
  "common.team.alreadyMember": "이미 이 팀의 멤버입니다.",
  "common.team.inviteNotFound": "초대를 찾을 수 없습니다.",
  "common.team.inviteAlreadyHandled": "이미 처리된 초대입니다.",
  "common.team.inviteExpired": "만료된 초대입니다.",
  "common.team.inviteMalformed":
    "초대 정보가 손상되었습니다. 초대한 사람에게 다시 초대를 요청하세요.",
  "common.team.loadMembersFailed": "멤버 로드 실패",
  "common.team.inviteFailed": "초대 실패",
  "common.team.acceptFailed": "수락 실패",
  "common.team.rejectFailed": "거절 실패",
  "common.team.cancelInviteFailed": "초대 취소 실패",
  "common.team.updateRoleFailed": "역할 변경 실패",
  "common.team.removeMemberFailed": "멤버 제거 실패",

  // — payment (services/billingService) —
  "common.payment.sdkLoadFailed": "Paddle SDK 로드 실패",
  "common.payment.checkoutCanceled": "결제 취소",

  // — agent notifications (services/agentNotificationService) —
  "common.notification.agentSpawned":
    '에이전트 "{name}" ({role})이(가) 시작되었습니다.',
  "common.notification.taskCompleted": '태스크를 완료했습니다: "{taskTitle}"',
  "common.notification.submittedForReview":
    '태스크 리뷰를 제출했습니다: "{taskTitle}"',
  "common.notification.agentError": '에이전트 "{name}" 오류: {error}',
  "common.notification.agentRestarted":
    '에이전트 "{name}"이(가) 재시작되었습니다.',

  // — worktree status pills (stores/worktreeStore) —
  "common.worktree.conflict": "충돌",
  "common.worktree.behind": "뒤처짐",
  "common.worktree.mergeable": "머지 가능",
  "common.worktree.idle": "작업중",

  // — collaboration conflict banner (components/collaboration/ConflictWarning) —
  "common.conflict.editing": "{names} 님이 이 파일을 수정 중입니다",

  // — "안 될 때" 의 어휘 (components/common/StateBlock · loadState) —
  // 정본: docs/design-tokens-and-failure-vocabulary-2026-08-22.md §3.
  // 한 벌로 박는다 — 화면마다 새로 쓰면 어휘가 다시 갈라진다.
  "common.state.loading.still": "계속 시도 중…",
  "common.state.empty.title": "아직 항목이 없습니다",
  "common.state.failed.title": "불러오지 못했습니다",
  "common.state.failed.label": "불러오지 못함",
  "common.state.failed.detail": "상세",
  "common.state.denied.title":
    "권한이 없어 읽지 못했습니다 — 0 이 아니라 알 수 없음입니다",
  "common.state.denied.ask": "{whom}에게 요청하세요",
  "common.state.notReady.label": "아직 수집되지 않음",
  "common.state.partial.title": "{shown}/{total} 만 그렸습니다",
  // 행동 라벨 — ★재시도 버튼은 이 키 하나다(지금 4종: 다시 시도 46 · 재시도 29 ·
  // Retry 49 · Try again 6). '다시 시도' 를 고른 이유: ko 최다 + 정본 §3-5 의 정정안.
  "common.state.action.retry": "다시 시도",
  "common.state.action.create": "첫 항목 만들기",
  "common.state.action.askOwner": "{whom}에게 요청",
  "common.state.action.showMore": "더 보기",
  // 사유 코드 — `reasonCode` 는 i18n 키다. err.message 원문은 여기 오지 않는다.
  "common.state.reason.network": "네트워크 연결을 확인하세요.",
  "common.state.reason.server": "서버가 응답하지 않았습니다.",
  "common.state.reason.unknown": "원인을 알 수 없습니다.",
  "common.state.reason.ownerOnly": "팀 오너만 볼 수 있는 정보입니다.",
  "common.state.reason.notCollected": "이 지표는 아직 수집을 시작하지 않았습니다.",
};
