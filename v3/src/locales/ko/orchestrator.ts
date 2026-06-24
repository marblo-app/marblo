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
};
