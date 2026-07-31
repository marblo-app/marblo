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
  "common.team.inviteNotFound": "초대를 찾을 수 없습니다.",
  "common.team.inviteAlreadyHandled": "이미 처리된 초대입니다.",
  "common.team.inviteExpired": "만료된 초대입니다.",
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
};
