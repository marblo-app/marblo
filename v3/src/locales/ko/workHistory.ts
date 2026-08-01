/**
 * Korean — `workHistory.*` namespace (components/work-history: WorkHistoryTab,
 * ShareCard, #259 lite 작업내역 탭).
 *
 * Only labels/chrome are translated: relative-time labels, the "보고" badge,
 * ProvenanceField labels (문제/접근/변경/검증), PR/diff actions, header counts,
 * empty/loading states, and the share-card subtitle.
 *
 * ★ NOT translated (data, not UI): the completion-report VALUES themselves
 *   (report.problem/approach/changes/verification), task titles, PR URLs,
 *   the "Shipped with Marblo" share markdown, and the agents/PRs/files/tests
 *   column labels (already language-neutral). Counts are interpolated via
 *   {count}/{percent} placeholders.
 */
export const workHistory = {
  // — relative time labels —
  "workHistory.time.justNow": "방금",
  "workHistory.time.minutesAgo": "{count}분 전",
  "workHistory.time.hoursAgo": "{count}시간 전",
  "workHistory.time.daysAgo": "{count}일 전",

  // — provenance field labels (report VALUES stay as data) —
  "workHistory.provenance.problem": "문제",
  "workHistory.provenance.approach": "접근",
  "workHistory.provenance.changes": "변경",
  "workHistory.provenance.verification": "검증",

  // — row —
  "workHistory.row.untitled": "(제목 없음)",
  "workHistory.badge.report": "보고",
  "workHistory.noReport":
    '이 완료 태스크에는 구조화된 "✅ 완료 보고" 가 없습니다.',
  "workHistory.reportNotLoaded":
    "완료 보고는 최신 {count}건만 불러옵니다 — 기간·역할·검색으로 좁히면 이 항목도 포함됩니다.",
  "workHistory.openPr": "PR 열기",
  "workHistory.openTicket": "티켓 보기",
  "workHistory.diff.view": "diff 보기",
  "workHistory.diff.loading": "로딩…",
  "workHistory.diff.loadFailed": "diff 로드 실패",

  // — header —
  "workHistory.title": "작업내역",
  "workHistory.doneCount": "완료 {count}건",
  "workHistory.filteredCount": "{period} · {count}건 / 전체 완료 {total}건",
  "workHistory.reportWindow": "· 완료 보고는 최신 {count}건만 로드",

  // — filter bar —
  "workHistory.filter.role": "역할",
  "workHistory.filter.roleAll": "전체",
  "workHistory.filter.searchPlaceholder": "제목·설명 검색",
  "workHistory.filter.reset": "필터 초기화",

  // — empty / select states —
  "workHistory.selectProject": "프로젝트를 선택하면 작업내역이 표시됩니다.",
  "workHistory.empty.title": "완료된 작업이 없습니다.",
  "workHistory.empty.hint":
    "작업이 DONE 으로 넘어가면 여기에 provenance 와 함께 쌓입니다.",
  "workHistory.empty.filtered.title":
    "이 필터에 해당하는 완료 작업이 없습니다.",
  "workHistory.empty.filtered.hint":
    "기간을 넓히거나 역할·검색어를 지우면 더 보입니다.",

  // — share card —
  "workHistory.share.subtitle":
    "완료 {count}건 집계 · 테스트통과/리스크는 완료 보고 키워드 추정값",
  "workHistory.share.subtitleWindowed":
    "완료 {count}건 집계 · 테스트통과/리스크는 완료 보고를 읽은 {scanned}건 기준 키워드 추정값",
  "workHistory.share.copyTitle": "공유용 markdown 복사",
  "workHistory.share.copied": "복사됨 ✓",
  "workHistory.share.copy": "markdown 복사",
};
