/**
 * Korean — `board.*` namespace (Kanban board: cards, columns, task detail
 * modal, body sections, diff viewer). UI chrome only — task/agent data text,
 * activity-log messages and user input stay untranslated. Keys keep their
 * dotted form.
 */
export const board = {
  // KanbanBoard
  "board.aiBreakdown": "AI 분해",

  // TaskCard — presence + assignee
  "board.presence.online": "온라인",
  "board.presence.idle": "유휴",
  "board.presence.offline": "오프라인",
  "board.taskCard.switchCodeRoot": "Code 탭 루트를 {path}(으)로 전환",
  "board.taskCard.assignee": "담당자 {status}",
  "board.taskCard.unassigned": "미배정",

  // TaskBodySections — section headings
  "board.section.goal": "목표",
  "board.section.changes": "변경·접근",
  "board.section.acceptance": "완료 기준",
  "board.section.notes": "제약·주의",

  // TaskDetailModal
  "board.taskDetail.viewTerminal": "{name} 터미널 보기",
  "board.taskDetail.connect": "(연결)",
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

  // DiffViewer
  "board.diff.loading": "변경 diff 불러오는 중...",
  "board.diff.retry": "다시 시도",
  "board.diff.empty": "표시할 변경 diff가 없습니다.",
  "board.diff.fileCount": "파일 {count}개",
};
