/**
 * Korean — `board.*` namespace (Kanban board: cards, columns, task detail
 * modal, body sections, diff viewer). UI chrome only — task/agent data text,
 * activity-log messages and user input stay untranslated. Keys keep their
 * dotted form.
 */
export const board = {
  // KanbanBoard
  "board.aiBreakdown": "AI 분해",

  // KanbanBoard — no-project empty state (clickable CTA → folder select).
  // Framed as the onboarding entry point: connecting a folder auto-creates the
  // project and boots the orchestrator.
  "board.noProjects.title": "폴더를 연결해 시작하세요",
  "board.noProjects.desc":
    "폴더를 연결하면 프로젝트가 자동으로 만들어지고, 오케스트레이터가 첫 대화를 엽니다.",
  "board.noProjects.cta": "폴더 연결 · 시작하기",
  "board.noProjects.hint": "폴더 연결이 온보딩의 첫걸음입니다.",

  // 보드를 읽지 못한 상태를 빈 보드로 위장하지 않는다.
  "board.authRequired.title": "보드를 읽으려면 로그인이 필요합니다",
  "board.authRequired.desc":
    "태스크가 없는 것이 아닙니다. 인증을 복구한 뒤 보드를 다시 열어 주세요.",
  "board.readFailed.title": "보드를 불러오지 못했습니다",
  "board.readFailed.desc":
    "태스크가 없는 것으로 표시하지 않았습니다. 연결을 확인한 뒤 다시 시도해 주세요.",

  // KanbanColumn — empty column
  "board.column.noTasks": "태스크 없음",
  "board.column.dropHere": "여기에 놓기",
  "board.column.todoHint": "+ 새 태스크로 시작",
  // 이 컬럼에서 정체 레인으로 빠져나간 티켓의 흔적. 판정이 카드를 조용히
  // 지우면 사용자는 "일이 없다" 로 읽는다 — 옮겨졌다는 사실을 남긴다.
  "board.column.stuckAway": "{count}건 정체 레인",
  "board.column.stuckAwayTip":
    "이 단계의 티켓이 정체로 판정돼 오른쪽 정체 레인에 있습니다. 눌러서 펼칩니다. 티켓 상태(status)는 그대로입니다.",

  // KanbanBoard — 칸반↔그래프 뷰 토글, TaskGraphView
  "board.view.kanban": "칸반",
  "board.view.graph": "그래프",
  "board.view.kanbanTip": "칸반 보기 — 상태별 컬럼",
  "board.view.graphTip": "그래프 보기 — 의존 관계(dependsOn) DAG",
  "board.graph.empty": "그릴 태스크가 없습니다",
  "board.graph.summary": "태스크 {nodes}개 · 의존 {edges}개",
  "board.graph.hint": "휠 확대 · 드래그 이동 · 노드를 누르면 상세",
  "board.graph.cycle": "순환 의존 — 점선 화살표",

  // TaskGraphView Phase 2 — 운영 레이어(크리티컬 패스·준비/대기 범례·호버 카드)
  "board.graph.critical": "크리티컬 패스",
  "board.graph.criticalTip":
    "최장 의존 사슬 — 남은 티켓 {count}개가 완료 시점을 결정합니다",
  "board.graph.criticalNone": "강조할 의존 사슬이 없습니다",
  "board.graph.fit": "화면에 맞추기",
  "board.graph.nodeListLabel": "의존 그래프 노드 {count}개",
  "board.graph.legend.ready": "준비 {count}",
  "board.graph.legend.waiting": "대기 {count}",
  "board.graph.legend.active": "진행 {count}",
  "board.graph.legend.stuck": "정체 {count}",
  "board.graph.legend.done": "완료 {count}",
  "board.graph.legend.critical": "크리티컬 {count}",
  "board.graph.readiness.ready": "지금 착수 가능 — 선행이 모두 끝났습니다",
  "board.graph.readiness.waiting": "선행 대기 중",
  "board.graph.readiness.active": "진행 중",
  "board.graph.readiness.stuck": "정체 — 사람이 봐야 합니다",
  "board.graph.readiness.done": "완료",
  "board.graph.tooltip.blocks": "이 티켓을 기다리는 {count}개",

  // TaskGraphView Phase 3 — 조율 레이어(scope 겹침·정체 여파·백로그 필드)
  "board.graph.conflict": "충돌위험",
  "board.graph.conflictTip":
    "scope 가 겹치는 열린 티켓 {count}쌍 · 충돌 클러스터 {clusters}개 — 병렬로 돌리면 머지 충돌",
  "board.graph.conflictNone": "겹치는 scope 가 없습니다",
  "board.graph.conflictTruncated": "충돌 {count}쌍까지만 표시",
  "board.graph.legend.conflict": "충돌위험 {count}",
  "board.graph.legend.blast": "정체 여파 {count}",
  "board.graph.legend.isolated": "독립 {count}",
  "board.graph.tooltip.conflicts": "scope 겹침 {count}건 — 같이 돌리면 충돌",
  "board.graph.tooltip.conflictPaths": "겹치는 경로: {paths}",
  "board.graph.tooltip.blast": "정체 티켓에 막혀 있음",
  "board.graph.tooltip.isolated": "연결 없음 — 백로그",

  // TaskCard — presence + assignee
  "board.presence.online": "온라인",
  "board.presence.idle": "유휴",
  "board.presence.offline": "오프라인",
  "board.taskCard.switchCodeRoot": "Code 탭 루트를 {path}(으)로 전환",
  "board.taskCard.viewWorktreeTip":
    "이 워크트리 보기 · 좌측 파일트리 전환 + 담당 에이전트 선택 ({branch})",
  "board.taskCard.viewingWorktree": "지금 이 워크트리를 보는 중",
  "board.taskCard.assignee": "담당자 {status}",
  "board.taskCard.unassigned": "미배정",
  // 비기너 미니 보드용 — BLOCKED/FAILED 를 별도 컬럼 대신 카드 위 한 칩으로.
  "board.taskCard.stuck": "막힘",

  // TaskBodySections — section headings
  "board.section.goal": "목표",
  "board.section.changes": "변경·접근",
  "board.section.acceptance": "완료 기준",
  "board.section.notes": "제약·주의",

  // TaskDetailModal
  "board.taskDetail.viewWorktree": "이 워크트리 보기",
  "board.taskDetail.viewingWorktree": "지금 이 워크트리를 보는 중",
  "board.taskDetail.viewWorktreeTip":
    "좌측 파일트리를 이 워크트리로 전환하고 담당 에이전트를 선택합니다 ({branch})",
  "board.taskDetail.noWorktree": "연결된 워크트리 없음",
  "board.taskDetail.noWorktreeTip":
    "이 태스크 ID와 매칭되는 워크트리가 없습니다 (워크트리의 taskId·경로·브랜치 어디에도 태스크 ID가 없음). 방금 생성됐다면 다시 찾기를 누르세요.",
  "board.taskDetail.worktreeSearching": "워크트리 확인 중...",
  "board.taskDetail.worktreeRefind": "다시 찾기",
  "board.taskDetail.worktreeStillMissing": "다시 찾아봤지만 없음",
  "board.taskDetail.worktreeRefindFailed": "워크트리 조회 실패",
  "board.taskDetail.viewTerminal": "{name} 터미널 보기",
  "board.taskDetail.connect": "(연결)",
  // 이 기기가 띄운 게 아닌 에이전트 — "(연결)" 대신 왜 안 보이는지 말한다.
  "board.taskDetail.remoteUser": "(다른 팀원의 기기)",
  "board.taskDetail.remoteMachine": "(다른 기기)",
  "board.taskDetail.edit": "수정",
  "board.taskDetail.titleLabel": "제목",
  "board.taskDetail.descriptionLabel": "설명",
  "board.taskDetail.descriptionPlaceholder":
    "태스크 설명, 에이전트에게 전달할 상세 프롬프트...",
  "board.taskDetail.priorityLabel": "우선순위",
  "board.taskDetail.priorityUrgent": "(긴급)",
  "board.taskDetail.priorityLow": "(낮음)",
  "board.taskDetail.deleting": "삭제 중...",
  "board.taskDetail.deleteTask": "태스크 삭제",
  "board.taskDetail.cancel": "취소",
  "board.taskDetail.save": "저장",
  "board.taskDetail.addDescription": "+ 설명 추가 (클릭하여 편집)",
  "board.taskDetail.diffTab": "변경 diff",
  "board.taskDetail.lookingUpWorktree": "연결된 worktree를 조회합니다.",
  "board.taskDetail.refresh": "새로고침",
  "board.taskDetail.worktreeNotFound":
    "이 태스크에 연결된 worktree를 찾을 수 없습니다.",
  "board.taskDetail.diffLoadFailed": "diff 로드 실패",

  // StuckLane — DONE 우측 가상 레인. status 가 아니라 화면 그룹이다.
  "board.stuck.title": "정체",
  "board.stuck.tooltip":
    "멈춘 티켓 모음 — BLOCKED/FAILED 와 파생 판정 STALE. 티켓 상태(status)는 바뀌지 않습니다.",
  "board.stuck.empty": "정체된 티켓이 없습니다.",
  "board.stuck.group.BLOCKED": "BLOCKED",
  "board.stuck.group.FAILED": "FAILED",
  "board.stuck.group.STALE": "STALE",
  "board.stuck.reason.agent-missing": "담당 에이전트가 목록에 없음",
  "board.stuck.reason.agent-dead": "담당 에이전트가 정지·오류 상태",
  // 임계는 우선순위별(P4+ 20분 · 그 외 45분, electron/agent-stall-policy.ts) —
  // 문구에 숫자를 박지 않는다. 경과 분은 stateTitle 이 보여준다.
  "board.stuck.reason.no-progress": "임계를 넘도록 진척 보고가 없음",
  "board.stuck.reason.worktree-idle": "워크트리가 하루 넘게 무변경",
  "board.stuck.idleFor": "{minutes}분째",
  // StateBlock(failed) 제목 — "멈춘 것 같다" 는 다음 행동(다시 시도)이 붙는 상태.
  "board.stuck.stateTitle": "{minutes}분째 보고 없음 — 확인이 필요합니다",
  "board.stuck.stateTitleNoClock": "진척 시각을 알 수 없음 — 확인이 필요합니다",
  "board.stuck.action.retry": "재시도",
  "board.stuck.action.archive": "보관",
  "board.stuck.action.delete": "삭제",
  "board.stuck.action.restore": "복구",
  "board.stuck.hiddenToggle": "🗄 보관·삭제됨 ({count})",
  "board.stuck.retryInjection":
    "정체 레인에서 재시도 요청이 들어왔습니다. 남은 작업을 이어서 진행하세요.",
  "board.stuck.msg.reused": "{agent} 재기동 — 하던 작업을 이어서 진행합니다.",
  "board.stuck.msg.redispatched":
    "담당을 회수하고 TODO 로 되돌렸습니다. 오케스트레이터가 다시 배정합니다.",
  "board.stuck.msg.archived": '"{title}" 보관됨 — 보드에서 숨겨집니다.',
  "board.stuck.msg.deleted": '"{title}" 삭제됨 (복구 가능).',
  "board.stuck.msg.restored": '"{title}" 복구됨 — 보드에 다시 표시됩니다.',
  "board.stuck.error.generic": "작업에 실패했습니다.",

  // DiffViewer
  "board.diff.loading": "변경 diff 불러오는 중...",
  "board.diff.retry": "다시 시도",
  "board.diff.empty": "표시할 변경 diff가 없습니다.",
  "board.diff.fileCount": "파일 {count}개",
};
