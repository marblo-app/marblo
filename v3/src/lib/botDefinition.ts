import type { AgentRole } from "../types/task";

export const BOT_MODELS = [
  "claude",
  "codex",
  "grok",
  "deepseek",
  "solar",
  "local",
] as const;

export type BotModel = (typeof BOT_MODELS)[number];

export interface BotKnowledgeConfig {
  enabled: boolean;
  rootPath: string;
}

export interface BotDefinition {
  id: string;
  projectId: string;
  ownerId: string;
  name: string;
  persona: string;
  mission: string;
  model: BotModel;
  role: AgentRole;
  tools: string[];
  knowledge: BotKnowledgeConfig;
  seedId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type BotDefinitionDraft = Omit<
  BotDefinition,
  "id" | "createdAt" | "updatedAt"
>;

export type BotValidationIssue =
  | "missing_project"
  | "missing_owner"
  | "missing_name"
  | "missing_persona"
  | "empty_mission"
  | "unknown_model"
  | "knowledge_root_required";

export interface BotValidationResult {
  ok: boolean;
  issues: BotValidationIssue[];
}

const BOT_MODEL_SET = new Set<string>(BOT_MODELS);

function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function isBotModel(value: string): value is BotModel {
  return BOT_MODEL_SET.has(value);
}

export function validateBotDefinition(
  draft: Partial<BotDefinitionDraft>,
): BotValidationResult {
  const issues: BotValidationIssue[] = [];
  if (!hasText(draft.projectId)) issues.push("missing_project");
  if (!hasText(draft.ownerId)) issues.push("missing_owner");
  if (!hasText(draft.name)) issues.push("missing_name");
  if (!hasText(draft.persona)) issues.push("missing_persona");
  if (!hasText(draft.mission)) issues.push("empty_mission");
  if (!draft.model || !isBotModel(draft.model)) issues.push("unknown_model");
  if (draft.knowledge?.enabled && !hasText(draft.knowledge.rootPath)) {
    issues.push("knowledge_root_required");
  }
  return { ok: issues.length === 0, issues };
}

export function assertValidBotDefinition(
  draft: BotDefinitionDraft,
): BotDefinitionDraft {
  const result = validateBotDefinition(draft);
  if (!result.ok) {
    throw new Error(`Invalid bot definition: ${result.issues.join(", ")}`);
  }
  return draft;
}

export interface SeedBotDefinition {
  seedId: string;
  name: string;
  persona: string;
  mission: string;
  model: BotModel;
  role: AgentRole;
  tools: string[];
  evidence: string;
  requires?: string[];
  knowledgeEnabled: boolean;
}

export const SEED_BOTS: SeedBotDefinition[] = [
  {
    seedId: "knowledge-assistant",
    name: "지식 비서",
    persona:
      "프로젝트 위키를 먼저 확인하고, 근거와 한계를 짧게 분리해 말하는 실무 비서",
    mission:
      "사용자의 질문을 프로젝트 지식위키에 근거해 답하고, 모호한 부분은 추가 확인 항목으로 정리한다.",
    model: "claude",
    role: "backend",
    tools: ["wiki_query"],
    evidence:
      "MCP 서버에 wiki_query가 등록되어 있고, .claude/skills/wiki-init·wiki-note·wiki-ingest가 있다.",
    knowledgeEnabled: true,
  },
  {
    seedId: "fullstack-developer",
    name: "풀스택 개발",
    persona:
      "기존 코드 패턴을 읽고 작은 PR 단위로 구현·검증하는 제품 개발 에이전트",
    mission:
      "요구사항을 보드 티켓으로 만들고, 기존 dispatch 경로로 작업 에이전트를 띄워 구현과 검증을 진행한다.",
    model: "codex",
    role: "frontend",
    tools: ["create_task", "dispatch_task", "add_activity", "submit_for_review"],
    evidence:
      "MCP 서버에 create_task, dispatch_task, add_activity, submit_for_review가 등록되어 있다.",
    knowledgeEnabled: false,
  },
  {
    seedId: "daily-briefing",
    name: "일일 브리핑",
    persona:
      "정해진 시간에 일정·메일·열린 할일만 짧게 확인하고 Slack/Telegram으로 밀어주는 비서",
    mission:
      "오늘 일정, 새 메일, 진행 중인 할일을 확인해 한 화면 분량의 브리핑으로 정리하고 선택된 채널로 보낸다.",
    model: "claude",
    role: "backend",
    tools: [
      "calendar_list",
      "gmail_search",
      "send_slack_message",
      "send_telegram_message",
    ],
    evidence:
      "트리거 엔진 프롬프트와 MCP 서버에 calendar_list, gmail_search, send_slack_message, send_telegram_message가 등록되어 있다.",
    requires: ["Google Calendar/Gmail 연결", "Slack 또는 Telegram 채널"],
    knowledgeEnabled: true,
  },
  {
    seedId: "mail-calendar-followup",
    name: "메일·일정 팔로업",
    persona:
      "새 메일이나 임박 일정이 들어오면 중요도와 다음 행동만 추려 알려주는 조건 반응 비서",
    mission:
      "최근 메일과 임박 일정을 확인하고, 답장 필요 여부·준비물·후속 태스크 후보를 짧게 정리한다.",
    model: "claude",
    role: "backend",
    tools: [
      "gmail_search",
      "calendar_list",
      "send_slack_message",
      "send_telegram_message",
    ],
    evidence:
      "assistant-triggers 엔진이 Gmail/Calendar 조건을 폴링하고 같은 전송 MCP 도구로 푸시하도록 main.ts에 배선되어 있다.",
    requires: ["Google Calendar/Gmail 연결", "Slack 또는 Telegram 채널"],
    knowledgeEnabled: true,
  },
];

export interface OmittedSeedBot {
  name: string;
  reason: string;
}

export const OMITTED_SEED_BOTS: OmittedSeedBot[] = [
  {
    name: "유튜브 리서치",
    reason:
      "유튜브 전용 커넥터나 검증된 브라우저/검색 MCP가 현재 시드 재료로 확인되지 않아 첫 화면 실행 신뢰도를 해친다.",
  },
  {
    name: "웹 리서치",
    reason:
      "브라우저/검색 MCP가 현재 Marblo MCP 표면에 등록된 실행 재료로 확인되지 않았다.",
  },
];

export function defaultWikiRootPath(projectFolderPath?: string): string {
  return projectFolderPath
    ? `${projectFolderPath.replace(/\/+$/, "")}/docs/wiki`
    : "";
}

export function seedToDraft(input: {
  seed: SeedBotDefinition;
  projectId: string;
  ownerId: string;
  wikiRootPath: string;
}): BotDefinitionDraft {
  const { seed, projectId, ownerId, wikiRootPath } = input;
  return {
    projectId,
    ownerId,
    name: seed.name,
    persona: seed.persona,
    mission: seed.mission,
    model: seed.model,
    role: seed.role,
    tools: seed.tools,
    knowledge: {
      enabled: seed.knowledgeEnabled,
      rootPath: seed.knowledgeEnabled ? wikiRootPath : "",
    },
    seedId: seed.seedId,
  };
}

export interface BuildBotDispatchInstructionInput {
  bot: BotDefinition;
  userMission: string;
  projectRootPath?: string;
}

export function buildBotDispatchInstruction({
  bot,
  userMission,
  projectRootPath,
}: BuildBotDispatchInstructionInput): string {
  const mission = userMission.trim();
  const tools = bot.tools.length > 0 ? bot.tools.join(", ") : "기본 Marblo MCP";
  const cwdLine = projectRootPath?.trim()
    ? `- cwd: ${projectRootPath.trim()}`
    : "- cwd: 프로젝트 기본 경로";
  const knowledgeLine = bot.knowledge.enabled
    ? [
        "- Knowledge: enabled",
        `- wiki root_path: ${bot.knowledge.rootPath}`,
        "- Before answering or changing files, call wiki_query with that exact root_path when project knowledge can affect the answer.",
      ].join("\n")
    : "- Knowledge: disabled";

  return [
    "[Marblo Bot Gallery Dispatch]",
    "Use the existing MCP dispatch path. Do not call spawn_agent or create a separate spawn route.",
    "Create a board ticket first, then dispatch that ticket to a physical agent.",
    "",
    "Bot definition",
    `- name: ${bot.name}`,
    `- persona: ${bot.persona}`,
    `- reusable mission: ${bot.mission}`,
    `- model: ${bot.model}`,
    `- role: ${bot.role}`,
    `- tools: ${tools}`,
    knowledgeLine,
    cwdLine,
    "",
    "User mission for this run",
    mission,
    "",
    "Required MCP sequence",
    "1. create_task with the title, description, role, priority, and project scope for this run.",
    "2. dispatch_task with the created task_id, role, instruction, model, cwd, and name from this bot definition.",
    "3. The dispatched worker must use wiki_query(root_path) when Knowledge is enabled.",
  ].join("\n");
}
