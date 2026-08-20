import type { MessageKey } from "../../locales/ko";

export interface SlashCommand {
  command: string;
  label: string;
  /** i18n key (orchestrator.*) — resolve with t() at render time. */
  description: MessageKey;
  category:
    | "project"
    | "project-step"
    | "agent"
    | "work"
    | "pause"
    | "review"
    | "deploy"
    | "sync"
    | "repeat"
    | "util";
}

export const SLASH_COMMANDS: SlashCommand[] = [
  // 프로젝트 시작 (빠른)
  {
    command: "/tf-plan",
    label: "tf-plan",
    description: "orchestrator.cmd.tf-plan.desc",
    category: "project",
  },
  {
    command: "/tf-start",
    label: "tf-start",
    description: "orchestrator.cmd.tf-start.desc",
    category: "project",
  },

  // 프로젝트 시작 (단계별)
  {
    command: "/tf-analyze",
    label: "tf-analyze",
    description: "orchestrator.cmd.tf-analyze.desc",
    category: "project-step",
  },
  {
    command: "/tf-create-tasks",
    label: "tf-create-tasks",
    description: "orchestrator.cmd.tf-create-tasks.desc",
    category: "project-step",
  },
  {
    command: "/tf-spawn-agents",
    label: "tf-spawn-agents",
    description: "orchestrator.cmd.tf-spawn-agents.desc",
    category: "project-step",
  },

  // 작업 진행
  {
    command: "/tf-work",
    label: "tf-work",
    description: "orchestrator.cmd.tf-work.desc",
    category: "work",
  },
  {
    command: "/tf-status",
    label: "tf-status",
    description: "orchestrator.cmd.tf-status.desc",
    category: "work",
  },
  {
    command: "/tf-add",
    label: "tf-add",
    description: "orchestrator.cmd.tf-add.desc",
    category: "work",
  },
  // 중단 / 재개
  {
    command: "/tf-hold",
    label: "tf-hold",
    description: "orchestrator.cmd.tf-hold.desc",
    category: "pause",
  },
  {
    command: "/tf-resume",
    label: "tf-resume",
    description: "orchestrator.cmd.tf-resume.desc",
    category: "pause",
  },

  // 리뷰 / 문제 해결
  {
    command: "/tf-review",
    label: "tf-review",
    description: "orchestrator.cmd.tf-review.desc",
    category: "review",
  },
  {
    command: "/tf-feedback",
    label: "tf-feedback",
    description: "orchestrator.cmd.tf-feedback.desc",
    category: "review",
  },
  {
    command: "/tf-fix",
    label: "tf-fix",
    description: "orchestrator.cmd.tf-fix.desc",
    category: "review",
  },
  {
    command: "/tf-handoff",
    label: "tf-handoff",
    description: "orchestrator.cmd.tf-handoff.desc",
    category: "review",
  },

  // 동기화 / 정리
  {
    command: "/tf-sync",
    label: "tf-sync",
    description: "orchestrator.cmd.tf-sync.desc",
    category: "sync",
  },
  {
    command: "/tf-done",
    label: "tf-done",
    description: "orchestrator.cmd.tf-done.desc",
    category: "sync",
  },

  // 반복 작업
  {
    command: "/tf-ralph",
    label: "tf-ralph",
    description: "orchestrator.cmd.tf-ralph.desc",
    category: "repeat",
  },

  // 유틸
  {
    command: "/tf-guide",
    label: "tf-guide",
    description: "orchestrator.cmd.tf-guide.desc",
    category: "util",
  },
];

export const SLASH_PROMPTS: Record<string, string> = {
  "/tf-plan":
    "요구사항을 분석하고 컴포넌트, 역할, 의존성을 파악해줘. 소크라틱 질문으로 구체화해줘.",
  "/tf-start":
    "분석 기반으로 create_tasks_bulk로 태스크 생성해줘. 먼저 확인받고",
  "/tf-analyze": "요구사항을 분석하고 컴포넌트, 역할, 의존성을 파악해줘.",
  "/tf-create-tasks":
    "분석 결과를 기반으로 create_tasks_bulk로 태스크를 생성해줘. 먼저 목록 보여주고 확인받고.",
  "/tf-spawn-agents":
    "태스크 확인하고 에이전트 라인업 제안해줘. 확인받고 spawn_agent로 물리 에이전트 스폰.",
  "/tf-work": "가능한 태스크를 확인하고 하나를 골라서 claim해줘. 코딩 시작.",
  "/tf-status": "전체 태스크 상태 확인하고 요약해줘",
  "/tf-add":
    "현재 태스크 목록을 확인하고 새 태스크를 추가하거나 기존 태스크를 수정해줘.",
  "/tf-hold": "작업을 멈추고 현황을 정리해줘. 다음 행동을 제안해줘.",
  "/tf-resume": "중단된 프로젝트의 전체 컨텍스트를 복원하고 이어서 진행해줘.",
  "/tf-review": "REVIEW 상태 태스크를 확인하고 코드 리뷰해줘",
  "/tf-feedback": "PM 피드백을 확인하고 답변/반영해줘.",
  "/tf-fix": "FAILED, BLOCKED 태스크를 확인하고 원인 분석 + 복구해줘",
  "/tf-handoff": "에이전트가 실패한 태스크를 직접 이어받아서 완료해줘.",
  "/tf-sync": "실제 코드 상태와 티켓 상태의 불일치를 감지하고 동기화해줘.",
  "/tf-done": "프로젝트를 마무리하고 결과 요약 + 아카이브해줘.",
  "/tf-ralph": "같은 작업을 여러 대상에 반복 적용해줘. 티켓 단위로 추적.",
  "/tf-guide": "Marblo 슬래시 명령어 가이드를 보여줘",
};

// `label` is an i18n key (orchestrator.cat.*) — resolve with t() at render
// time. `icon` is a language-neutral emoji and stays inline.
export const CATEGORY_LABELS: Record<
  string,
  { label: MessageKey; icon: string }
> = {
  project: { label: "orchestrator.cat.project", icon: "📌" },
  "project-step": { label: "orchestrator.cat.project-step", icon: "📋" },
  agent: { label: "orchestrator.cat.agent", icon: "🤖" },
  work: { label: "orchestrator.cat.work", icon: "🔧" },
  pause: { label: "orchestrator.cat.pause", icon: "⏸️" },
  review: { label: "orchestrator.cat.review", icon: "👀" },
  deploy: { label: "orchestrator.cat.deploy", icon: "🚀" },
  sync: { label: "orchestrator.cat.sync", icon: "🔄" },
  repeat: { label: "orchestrator.cat.repeat", icon: "🔁" },
  util: { label: "orchestrator.cat.util", icon: "📖" },
};
