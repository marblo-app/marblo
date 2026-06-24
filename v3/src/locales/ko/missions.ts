/**
 * Korean — `missions.*` namespace (Missions tab: launch dialog, list, detail,
 * orchestrator panel, timeline + the fixed template description set).
 *
 * Boundary note (see ../README.md): only the *static UI shell* lives here.
 * Mission goals, agent/server output, step output, task titles, repo/branch
 * names, error strings, and timeline payloads are runtime data — NOT
 * translated. Already-English UI labels (Pause/Resume/Launch Mission/Read
 * only/status badges…) are left in their components — identical in both
 * locales, no key needed.
 */
export const missions = {
  // shared confirms / actions
  "missions.cancel": "취소",
  "missions.confirmAbandon":
    "이 미션을 종료할까요? 진행 중인 task / agent 는 정리됩니다.",
  "missions.confirmDeleteTerminal":
    "이 미션 기록을 영구 삭제할까요? 되돌릴 수 없습니다.",
  "missions.confirmDeleteActive":
    "진행 중인 미션입니다. 영구 삭제하면 기록이 사라지고, 진행 중 task/agent 는 자동 정리되지 않을 수 있어요(먼저 🛑 Abandon 권장). 그래도 삭제할까요?",

  // template descriptions (fixed set — label/emoji stay in templates.ts)
  "missions.template.quick-fix.desc":
    "버그 하나를 빠르게 — 원인 추적부터 수정·리뷰·배포까지",
  "missions.template.polish.desc":
    "이미 있는 화면을 더 깔끔하게 — 디자인 점검 후 배포",
  "missions.template.feature.desc":
    "기획이 끝난 기능 구현 — 설계 검토 후 만들고 QA·배포",
  "missions.template.full-feature.desc":
    "아이디어부터 배포까지 통째로 — 기획·설계·디자인 검토를 거쳐 끝까지",
  "missions.template.research.desc":
    "코드는 그대로, 방향만 — 요구사항을 파고들어 기획·전략 정리",

  // launch dialog
  "missions.launch.subtitle":
    "한 줄 목표와 템플릿을 고르면 orchestrator 가 끝까지 책임지고 진행합니다.",
  "missions.launch.goalLabel": "목표 (한 줄)",
  "missions.launch.goalPlaceholder": '예: "로그인 페이지 만들어줘"',
  "missions.launch.templateLabel": "템플릿",
  "missions.launch.noConnectionHint": "연결된 repo가 없으면 미션만 생성됩니다.",
  "missions.launch.goalRequired": "미션의 목표를 한 줄로 적어주세요.",
  "missions.launch.submitting": "시작 중...",

  // list
  "missions.list.emptyTitle": "아직 진행 중인 미션이 없습니다.",
  "missions.list.emptyHint": "아래에서 템플릿을 골라 첫 미션을 시작하세요.",
  "missions.list.abandonTitle": "Abandon mission (정지 후 아카이브)",
  "missions.list.deleteTitle": "Delete mission (영구 삭제)",

  // relative time (list)
  "missions.time.justNow": "방금",
  "missions.time.secondsAgo": "{count}초 전",
  "missions.time.minutesAgo": "{count}분 전",
  "missions.time.hoursAgo": "{count}시간 전",
  "missions.time.daysAgo": "{count}일 전",

  // detail
  "missions.detail.startedAt": "시작 {date}",
  "missions.detail.completedAt": "완료 {date}",
  "missions.detail.restart": "🔄 다시 실행",
  "missions.detail.restartTitle": "같은 목표 + 템플릿으로 새 미션 시작",
  "missions.detail.delete": "🗑️ 삭제",
  "missions.detail.deleteTitle": "미션 영구 삭제",
  "missions.detail.needInput": "🙋 사용자 입력이 필요합니다.",
  "missions.detail.needAttention": "개입이 필요합니다.",
  "missions.detail.stepStalled":
    "Step {step} ({skill}) 가 멈췄습니다 — 미션 Orchestrator PTY 에서 직접 답하고 Resume 을 누르세요.",
  "missions.detail.stepFailed": "Step {step} ({skill}) 실패 · {error}",
  "missions.detail.checkLastStep":
    "마지막 step 결과를 확인하고 Resume 또는 Abandon 을 선택하세요.",
  "missions.detail.tasksHeading": "작업",
  "missions.detail.noTasks":
    "아직 디스패치된 작업이 없습니다. dispatch 스텝이 실행되면 여기와 칸반 보드에 미션 작업(🎯)이 나타납니다.",
  "missions.detail.unassigned": "미할당",
  "missions.detail.agentPty": "🖥️ 에이전트 PTY",
  "missions.detail.connect": "(연결)",
  "missions.detail.ptyView": "이 작업의 에이전트 PTY 보기",
  "missions.detail.ptyConnect": "에이전트 세션에 연결",
  "missions.detail.ptyNoSession": "실행 중인 PTY 세션이 없습니다",
  "missions.detail.ptyNoAgent": "담당 에이전트가 아직 없습니다",
  "missions.detail.timelineEmpty": "orchestrator 가 곧 시작합니다.",
  "missions.detail.resultCompleted": "📋 미션 결과",
  "missions.detail.resultWaiting": "⚠️ 현재까지의 진행 결과",
  "missions.detail.resultAbandoned": "🛑 중단된 미션 — 그동안의 결과",
  "missions.detail.synthesis": "종합 보고서",
  "missions.detail.expand": "펼치기",
  "missions.detail.collapse": "접기",
  "missions.detail.noStepOutput": "출력이 저장된 step 이 없습니다.",
  "missions.detail.outputChars": "출력 ({count}자)",
  "missions.detail.awaitingOutput": "출력 대기 중... (2초 간격으로 갱신)",
  "missions.detail.noOutput": "출력이 없습니다.",
  "missions.detail.minuteSuffix": "분",
  "missions.detail.secondSuffix": "초",

  // orchestrator panel
  "missions.orch.awaitingInput": "🙋 입력 대기",
  "missions.orch.preloadStale": "preload 옛 버전 (재시작 필요)",
  "missions.orch.restartTitle":
    "세션 종료 후 새로 시작 (PTY 가 비어있을 때 사용)",
  "missions.orch.restarting": "재시작 중...",
  "missions.orch.hide": "숨기기",
  "missions.orch.show": "PTY 보기",
  "missions.orch.starting": "Mission orchestrator 시작 중...",
  "missions.orch.ptyPreparing": "PTY 준비 중...",
  "missions.orch.stuckHintPrefix": "진행이 멈춘 것 같으면 위 입력창에 ",
  "missions.orch.stuckHintQuote": "다음 스텝 진행해줘",
  "missions.orch.stuckHintSuffix": " 라고 입력해 오케스트레이터를 재촉하세요.",

  // timeline
  "missions.timeline.empty": "아직 활동이 없습니다.",
  "missions.timeline.attempt": "시도 {attempt}",
  "missions.timeline.willRetry": "재시도 예정",
};
