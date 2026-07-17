/**
 * Korean — `worktree.*` namespace (Worktrees tab: status filters, status
 * pills, row actions, merge-history audit trail, action result banners). UI
 * chrome only — branch names, paths, task ids, sha and store error strings
 * stay as data. Keys keep their dotted form.
 */
export const worktree = {
  // Status filter dropdown
  "worktree.filter.all": "전체 상태",
  "worktree.filter.ready": "🟢 머지 가능",
  "worktree.filter.behind": "🟡 뒤처짐",
  "worktree.filter.warning": "⚠️ stale",
  "worktree.filter.danger": "🔴 충돌",
  "worktree.filter.idle": "⚪ 작업중",

  // Conflict summary
  "worktree.conflict.rebaseNeeded": "rebase 필요",
  "worktree.conflict.none": "충돌없음",

  // Row actions
  "worktree.action.resolveOnlyConflict": "충돌 상태에서만 Resolve 가능",
  "worktree.action.openInCode": "Code 탭에서 이 worktree 열기",
  "worktree.action.removeCleanup": "워크트리 제거 및 브랜치 cleanup",
  "worktree.row.aheadTip": "ahead (base 대비 앞선 커밋)",
  "worktree.row.behindTip": "behind (base 대비 뒤처진 커밋)",

  // Relative time (merge history)
  "worktree.time.justNow": "방금",
  "worktree.time.minutesAgo": "{min}분 전",
  "worktree.time.hoursAgo": "{hr}시간 전",
  "worktree.time.daysAgo": "{day}일 전",

  // Merge mode badge
  "worktree.merge.autoTip": "오케스트레이터 자동머지",
  "worktree.merge.humanTip": "사람이 머지",
  "worktree.merge.auto": "🤖 자동",
  "worktree.merge.human": "🙂 사람",

  // Merge history row
  "worktree.history.rowTip": "클릭하면 머지된 diff (git show)",
  "worktree.history.shaTip": "{sha} — 클릭하면 diff",
  "worktree.history.diffLoading": "diff 불러오는 중…",
  "worktree.diffLoadFailed": "diff 로드 실패",

  // Header toolbar
  "worktree.exceptionsTip":
    "자동머지 안 되고 사람이 봐야 하는 것만 (충돌/머지불가 또는 stale)",
  "worktree.exceptionsLabel": "⚠️ 예외만",
  "worktree.historyToggleTip":
    "완료(머지)되어 사라진 워크트리의 감사 이력 — sha 클릭 시 diff",
  "worktree.historyToggleLabel": "📜 완료 이력",
  "worktree.cleanupStaleTip":
    "이미 머지됨/장기 무활동인 워크트리를 일괄 제거 (브랜치 cleanup)",
  "worktree.cleaningStale": "정리 중…",
  "worktree.cleanupStaleLabel": "⚠️ 정리 가능 일괄 cleanup ({count})",
  "worktree.refreshing": "새로고침 중…",
  "worktree.refresh": "새로고침",

  // Error / empty states
  "worktree.error.loadFailed": "워크트리 로드 실패: {error}",
  "worktree.error.actionFailed": "워크트리 액션 실패: {error}",
  "worktree.history.loading": "완료 이력을 불러오는 중…",
  "worktree.history.emptyTitle": "완료된 머지 이력이 없습니다.",
  "worktree.history.emptyHint":
    "워크트리가 머지되면 여기에 감사 이력으로 쌓입니다. (sha 클릭 시 diff)",
  "worktree.loading": "워크트리를 불러오는 중…",
  "worktree.emptyTitle": "워크트리가 없습니다.",
  "worktree.emptyHint":
    "에이전트가 태스크용 워크트리를 만들면 여기에 표시됩니다.",
  "worktree.noMatches": "필터 조건에 맞는 워크트리가 없습니다.",

  // Action result banners / confirms
  "worktree.msg.opened": "{branch} worktree를 Code 탭에 열었습니다.",
  "worktree.confirm.delete":
    "{branch} worktree를 제거하고 브랜치도 cleanup할까요?",
  "worktree.msg.rebased": "{branch} rebase 완료",
  "worktree.msg.merged": "{branch} squash-merge 완료",
  "worktree.msg.resolveStarted": "{branch} resolve agent 시작",
  "worktree.msg.removed": "{branch} worktree 제거 완료",
  "worktree.confirm.cleanupStale":
    "정리 가능(stale) 워크트리 {count}개를 제거하고 브랜치도 cleanup할까요?",
  "worktree.msg.cleanupPartial": "{removed}개 정리, {failed}개 실패 — {detail}",
  "worktree.msg.cleanupDone": "stale 워크트리 {removed}개 정리 완료",
  "worktree.error.cleanupFailed": "stale cleanup 실패",

  // Archive (숨김) / restore — 기본 뷰는 활성/온고잉만, 아카이브는 별도 뷰
  "worktree.archivedToggleLabel": "🗄 아카이브 ({count})",
  "worktree.archivedToggleTip":
    "머지/stale(자동) 또는 수동 보관된 워크트리 — 기본 목록에서 숨겨집니다. 여기서 복원 가능",
  "worktree.action.archive": "이 워크트리를 아카이브(기본 목록에서 숨김)",
  "worktree.action.restore": "아카이브 해제(기본 목록에 다시 표시)",
  "worktree.archiveAction": "보관",
  "worktree.restoreAction": "복원",
  "worktree.msg.archived": "{branch} 아카이브됨",
  "worktree.msg.restored": "{branch} 복원됨",
  "worktree.archivedEmptyTitle": "아카이브된 워크트리가 없습니다.",
  "worktree.archivedEmptyHint":
    "머지되거나 오래 무활동이면 자동으로 여기로 이동합니다.",
  "worktree.archivedReason.merged": "머지됨",
  "worktree.archivedReason.stale": "stale",
  "worktree.archivedReason.mergedTip": "이미 base에 머지되어 자동 아카이브됨",
  "worktree.archivedReason.staleTip": "장기 무활동으로 자동 아카이브됨",
};
