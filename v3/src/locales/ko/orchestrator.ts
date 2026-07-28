/**
 * Korean — `orchestrator.*` namespace (orchestrator command panel + the slash
 * command catalog's display labels). The slash `command`/`label` (e.g.
 * `tf-plan`) stay as identifiers; only the human-facing `description` and the
 * category labels are translated here. One namespace per file so parallel i18n
 * PRs don't collide. Keys keep their dotted form.
 */
export const orchestrator = {
  // Command panel chrome
  "orchestrator.title": "오케스트레이터",
  "orchestrator.notRunning": "오케스트레이터가 실행 중이 아닙니다",
  "orchestrator.sending": "전송…",
  "orchestrator.board": "보드",
  "orchestrator.aiDecompose": "AI 태스크 분해",
  "orchestrator.addTask": "새 태스크 추가",
  "orchestrator.sessionPicker": "세션 선택",
  "orchestrator.autoStartHint": "(폴더를 열면 자동 시작)",
  // 스폰 차단 안내 — 로그인이 아니라 MCP 가용성으로 막힌 경우(#639 grok 게이트).
  "orchestrator.blocked.mcpTitle":
    "{model} 오케를 띄우지 못했습니다 — Marblo MCP 툴이 붙지 않습니다",
  "orchestrator.blocked.mcpHint":
    "로그인 문제가 아닙니다. 이 CLI 는 신뢰되지 않은 폴더에서 로컬 MCP 서버를 기동하지 않으므로, 해당 CLI 로 프로젝트 폴더를 한 번 신뢰(trust)해 준 뒤 다시 시작하세요. MCP 없이 뜬 오케는 보드·디스패치를 하나도 못 합니다.",
  // 스폰 차단 안내 — 로그인/설치로 막힌 경우. 위저드가 스스로를 억제해도(이미
  // claude 가 준비된 사용자가 grok 을 고른 경우) 이 배너는 항상 뜬다.
  "orchestrator.blocked.authTitle":
    "{model} 오케를 띄우지 못했습니다 — 이 CLI 의 로그인이 필요합니다",
  "orchestrator.blocked.authHint":
    "다른 CLI 가 로그인돼 있어도 오케로 고른 이 CLI 는 따로 로그인해야 합니다. 아래 조치를 실행한 뒤 다시 시작하세요.",
  "orchestrator.blocked.login": "{model} 로그인",
  "orchestrator.blocked.dismiss": "닫기",
  // Category labels
  "orchestrator.cat.project": "프로젝트 시작",
  "orchestrator.cat.project-step": "단계별 시작",
  "orchestrator.cat.agent": "에이전트",
  "orchestrator.cat.work": "작업",
  "orchestrator.cat.pause": "중단/재개",
  "orchestrator.cat.review": "리뷰",
  "orchestrator.cat.deploy": "배포",
  "orchestrator.cat.sync": "정리",
  "orchestrator.cat.repeat": "반복",
  "orchestrator.cat.util": "유틸",
  // Slash command descriptions (display labels — the command id stays English)
  "orchestrator.cmd.tf-plan.desc": "요구사항 분석 + 태스크 계획",
  "orchestrator.cmd.tf-start.desc": "태스크 일괄 생성 + 에이전트 스폰",
  "orchestrator.cmd.tf-analyze.desc": "요구사항 분석",
  "orchestrator.cmd.tf-create-tasks.desc": "분석 기반 태스크 생성",
  "orchestrator.cmd.tf-spawn-agents.desc": "에이전트 라인업 + 스폰",
  "orchestrator.cmd.tf-spawn.desc": "물리 에이전트 스폰 (터미널 탭)",
  "orchestrator.cmd.tf-agent.desc": "논리 서브에이전트 (빠른 조사)",
  "orchestrator.cmd.tf-work.desc": "태스크 claim + 코딩",
  "orchestrator.cmd.tf-status.desc": "현황 대시보드",
  "orchestrator.cmd.tf-add.desc": "태스크 추가/수정",
  "orchestrator.cmd.tf-flow.desc": "플로우 파이프라인 설계",
  "orchestrator.cmd.tf-hold.desc": "작업 중단 + 현황 정리",
  "orchestrator.cmd.tf-resume.desc": "중단된 작업 이어하기",
  "orchestrator.cmd.tf-review.desc": "PM 코드 리뷰",
  "orchestrator.cmd.tf-feedback.desc": "PM 피드백 확인 + 답변",
  "orchestrator.cmd.tf-fix.desc": "FAILED/BLOCKED 복구",
  "orchestrator.cmd.tf-handoff.desc": "에이전트 실패 → 직접 이어받기",
  "orchestrator.cmd.tf-deploy.desc": "GCP Cloud Run 배포",
  "orchestrator.cmd.tf-sync.desc": "코드 ↔ 티켓 동기화",
  "orchestrator.cmd.tf-done.desc": "프로젝트 완료 + 아카이브",
  "orchestrator.cmd.tf-ralph.desc": "같은 작업 N개 일괄 처리",
  "orchestrator.cmd.tf-guide.desc": "명령어 가이드",

  // OrchestratorChat (AI task-breakdown dialog) — UI shell only; projectName /
  // error.message are runtime data passed in as placeholders.
  "orchestrator.chat.decomposed":
    '"{project}" 프로젝트를 {count}개 태스크로 분해했습니다. {layers}개 레이어로 병렬 실행 가능합니다.',
  "orchestrator.chat.error": "오류가 발생했습니다: {error}. 다시 시도해주세요.",
  "orchestrator.chat.unknownError": "알 수 없는 오류",
  "orchestrator.chat.created": "{count}개 태스크가 칸반 보드에 생성되었습니다!",
  "orchestrator.chat.createError": "태스크 생성 중 오류: {error}",
  "orchestrator.chat.emptyTitle": "프로젝트 요구사항을 자연어로 입력하세요",
  "orchestrator.chat.emptySubtitle":
    "AI가 태스크를 분해하고 의존성 그래프를 생성합니다",
  "orchestrator.chat.decomposing": "태스크를 분해하고 있습니다...",
  "orchestrator.chat.inputPlaceholder":
    "프로젝트 요구사항을 입력하세요... (Shift+Enter로 줄바꿈)",

  // DecompositionResult — summary stat labels
  "orchestrator.decomp.title": "분해 결과",
  "orchestrator.decomp.tasks": "태스크",
  "orchestrator.decomp.layers": "레이어",
  "orchestrator.decomp.dependencies": "의존성",
  "orchestrator.decomp.estHours": "예상 시간",

  // TaskPreview — editable preview chrome (task title/description are data)
  "orchestrator.preview.newTaskTitle": "새 태스크",
  "orchestrator.preview.execLayers": "실행 레이어 (DAG)",
  "orchestrator.preview.descPlaceholder": "설명...",
  "orchestrator.preview.done": "완료",
  "orchestrator.preview.edit": "편집",
  "orchestrator.preview.delete": "삭제",
  "orchestrator.preview.addTask": "+ 태스크 추가",
  "orchestrator.preview.taskCount": "{count}개 태스크",
  "orchestrator.preview.creating": "생성 중...",
  "orchestrator.preview.createOnBoard": "칸반에 생성",
};
