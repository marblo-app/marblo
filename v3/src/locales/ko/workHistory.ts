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
  // — view toggle (태스크 단위 ↔ 미션 Replay) —
  "workHistory.view.tasks": "태스크",
  "workHistory.view.missions": "미션 Replay",

  // — first-mission → Replay/공유 널지 (1회성, chatReadWatermark 패턴) —
  "workHistory.firstMissionNudge.message":
    "첫 미션을 완료했어요! Replay로 이 순간을 다시 보고, 원하면 살짝 공유해보세요.",
  "workHistory.firstMissionNudge.cta": "Replay 보기",
  "workHistory.firstMissionNudge.dismiss": "닫기",

  // — Mission Replay (Phase 1 인앱 뷰) —
  // ★공유/공개/익스포트/remix 문구는 없다 — Phase 2(레닭션) 전에는 그 경로 자체를
  //   만들지 않기 때문에 라벨도 존재하지 않는다.
  "workHistory.replay.list.loading": "완료 미션을 불러오는 중…",
  "workHistory.replay.list.denied":
    "이 프로젝트의 미션을 읽을 권한이 없습니다. (완료 미션이 없는 것과 다릅니다)",
  "workHistory.replay.list.error":
    "미션 목록을 불러오지 못했습니다 — {message}",
  "workHistory.replay.list.retry": "다시 시도",
  "workHistory.replay.list.count": "완료 미션 {count}건",
  "workHistory.replay.list.tasks": "태스크 {count}개",
  "workHistory.replay.list.untitled": "(목표 없음)",
  "workHistory.replay.list.empty.title": "완료된 미션이 없습니다.",
  "workHistory.replay.list.empty.hint":
    "미션이 완료되면 여기에서 그 미션의 Replay 를 볼 수 있습니다.",
  "workHistory.replay.list.empty.createHint":
    "Missions 탭에서 Quick Fix, Polish, Feature 같은 템플릿을 골라 첫 미션을 시작하세요.",
  "workHistory.replay.list.empty.cta": "첫 미션 만들기",
  "workHistory.replay.list.lightweight.title":
    "완료 작업 요약 Replay 를 먼저 보여줍니다.",
  "workHistory.replay.list.lightweight.hint":
    "아직 완료 미션 문서가 없어도 DONE 작업과 완료 보고를 묶어 공유 가능한 경량 Replay 로 볼 수 있습니다.",

  "workHistory.replay.back": "← 미션 목록",
  "workHistory.replay.reload": "새로고침",
  "workHistory.replay.loading": "Replay 를 조립하는 중…",
  "workHistory.replay.error": "Replay 를 만들지 못했습니다 — {message}",
  "workHistory.replay.unavailable.notFound": "미션을 찾을 수 없습니다.",
  "workHistory.replay.unavailable.notCompleted":
    "완료된 미션만 Replay 로 볼 수 있습니다.",
  "workHistory.replay.unavailable.denied":
    "이 미션을 읽을 권한이 없습니다. (미션이 없는 것과 다릅니다)",
  "workHistory.replay.privateNotice":
    "이 Replay 는 앱 안에서만 보입니다 — 공유·내보내기 경로가 없습니다.",

  "workHistory.replay.headline.template": "템플릿",
  "workHistory.replay.headline.launched": "시작",
  "workHistory.replay.headline.completed": "완료",
  "workHistory.replay.headline.duration": "소요",

  "workHistory.replay.duration.none": "—",
  "workHistory.replay.duration.days": "{count}일",
  "workHistory.replay.duration.hours": "{count}시간",
  "workHistory.replay.duration.minutes": "{count}분",
  "workHistory.replay.duration.seconds": "{count}초",

  "workHistory.replay.provenance.title": "데이터 출처",
  "workHistory.replay.provenance.ok": "읽음",
  "workHistory.replay.provenance.empty": "기록 없음",
  "workHistory.replay.provenance.denied": "권한 없음",
  "workHistory.replay.provenance.failed": "불러오지 못함",
  "workHistory.replay.provenance.deniedNote":
    "권한이 없어 읽지 못한 소스가 있습니다 — 화면에서 빠진 것이지, 그런 일이 없었다는 뜻이 아닙니다.",
  "workHistory.replay.provenance.errorNote":
    "일부 소스를 불러오지 못했습니다 — 빠진 항목은 '기록 없음'이 아닙니다.",

  "workHistory.replay.stats.agents": "에이전트",
  "workHistory.replay.stats.tasks": "태스크(완료/전체)",
  "workHistory.replay.stats.merges": "머지",
  "workHistory.replay.stats.prs": "PR",
  "workHistory.replay.stats.files": "변경 파일",
  "workHistory.replay.stats.lines": "라인 +/-",
  "workHistory.replay.stats.tests": "테스트 통과",
  "workHistory.replay.stats.risk": "리스크",
  "workHistory.replay.stats.retries": "재작업",
  "workHistory.replay.stats.interventions": "사람 개입",
  "workHistory.replay.stats.interventionsHint":
    "사람이 직접 남긴 기록(스폰·선점·상태변경) 수입니다.",
  "workHistory.replay.stats.deniedHint":
    "권한이 없어 이 소스를 읽지 못했습니다 — 0 이 아니라 '알 수 없음'입니다.",
  "workHistory.replay.stats.reportsNote":
    "테스트/리스크는 완료 보고의 키워드 추정값입니다.",
  "workHistory.replay.stats.reportsNoteWindowed":
    "테스트/리스크는 완료 보고를 읽은 {scanned}/{total}건 기준 키워드 추정값입니다.",

  "workHistory.replay.lane.all": "전체",
  "workHistory.replay.lane.human": "사람",
  "workHistory.replay.lane.orchestrator": "오케스트레이터",
  "workHistory.replay.lane.agent": "에이전트",
  "workHistory.replay.lane.system": "시스템",

  "workHistory.replay.sensitivity.private": "비공개",
  "workHistory.replay.sensitivity.process": "과정",
  "workHistory.replay.sensitivity.summary": "요약",
  "workHistory.replay.sensitivity.detail": "상세",
  "workHistory.replay.sensitivity.hint":
    "이 항목이 나중에 공개될 수 있는 등급입니다.",
  "workHistory.replay.sensitivity.privateHint":
    "이 항목은 앱 안에서만 보입니다 — 어떤 공개 등급에서도 나가지 않습니다.",

  "workHistory.replay.timeline.title": "타임라인",
  "workHistory.replay.timeline.showing": "{shown}/{total} 비트",
  "workHistory.replay.timeline.more": "더 보기 ({count}건 남음)",
  "workHistory.replay.timeline.empty": "표시할 기록이 없습니다.",
  "workHistory.replay.timeline.laneDenied":
    "'{lane}' 레인은 권한이 없어 읽지 못했습니다 — 비어 있는 것이 아닙니다.",

  "workHistory.replay.outcome.title": "최종 결과",
  "workHistory.replay.outcome.tasksDone": "완료 티켓",
  "workHistory.replay.outcome.files": "변경 파일",
  "workHistory.replay.outcome.tests": "테스트",
  "workHistory.replay.outcome.testsValue":
    "{count} (보고 {scanned}/{total}건 기준)",
  "workHistory.replay.outcome.retries": "재작업",
  "workHistory.replay.outcome.interventions": "사람 개입",
  "workHistory.replay.outcome.prs": "PR",
  "workHistory.replay.outcome.noPrs": "기록된 PR 이 없습니다.",

  "workHistory.replay.cast.title": "에이전트별 기여",
  "workHistory.replay.cast.empty": "에이전트 기여 기록이 없습니다.",
  "workHistory.replay.cast.agent": "에이전트",
  "workHistory.replay.cast.model": "모델",
  "workHistory.replay.cast.role": "역할",
  "workHistory.replay.cast.tasks": "완료 태스크",
  "workHistory.replay.cast.beats": "기록 수",
};
