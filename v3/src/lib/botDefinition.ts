import type { AgentRole } from "../types/task";
import type { MessageKey } from "../locales/ko";

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

/**
 * 저장된 봇에서 **고칠 수 있는 필드만** 모은 형태 (티켓 ddSiPtvknBaA4f1ptCh1).
 *
 * ★왜 전체 draft 가 아니라 허용 목록인가:
 *   - `projectId` 는 문서의 소속 그 자체다. firestore.rules 의 botDefinitions
 *     update 규칙이 `request.resource.data.projectId == resource.data.projectId`
 *     로 변경을 막고 있어, 넘겨봐야 규칙에서 튕긴다. 화면이 보내지 않는 게 맞다.
 *   - `ownerId` 는 "누가 만들었나"의 기록이다. 수정으로 바뀌면 감사 흔적이 사라진다.
 *   - `seedId` 는 시드 문서의 결정적 id(`{projectId}_{seedId}`)와 짝이다. 이것만
 *     바꾸면 id 와 seedId 가 어긋나 갤러리의 "저장됨" 판정이 깨진다.
 *   - `tools` 는 지금 어느 생성 경로에도 선택 UI 가 없다(커스텀은 고정 3종, 시드는
 *     시드 정의값). 수정에서만 열면 만들 때는 못 고르고 고칠 때만 고르는 비대칭이
 *     된다 — 도구 선택 UI 는 별도 건이다. 여기서는 기존 값을 보존한다.
 *   - 이 타입이 "무엇이 수정 가능한가"의 단일 사실이다. 화면이 실수로 범위를
 *     넓힐 수 없다. 앞으로 비밀값 필드가 생겨도 여기 넣지 않는 한 수정 경로로
 *     새어나가지 않는다(비밀값은 재노출이 아니라 별도 교체 경로가 원칙).
 */
export type BotDefinitionEdit = Pick<
  BotDefinition,
  "name" | "persona" | "mission" | "model" | "role" | "knowledge"
>;

/** 저장된 봇의 수정 폼 초기값. */
export function toBotDefinitionEdit(bot: BotDefinition): BotDefinitionEdit {
  return {
    name: bot.name,
    persona: bot.persona,
    mission: bot.mission,
    model: bot.model,
    role: bot.role,
    knowledge: { ...bot.knowledge },
  };
}

/**
 * 수정값을 기존 봇에 얹어 저장 가능한 draft 를 만든다. 허용 목록 밖 필드는
 * `edit` 가 무엇을 담고 있든 **원본 값이 이긴다**.
 */
export function applyBotDefinitionEdit(
  bot: BotDefinition,
  edit: BotDefinitionEdit,
): BotDefinitionDraft {
  return {
    name: edit.name,
    persona: edit.persona,
    mission: edit.mission,
    model: edit.model,
    role: edit.role,
    knowledge: {
      enabled: edit.knowledge.enabled,
      rootPath: edit.knowledge.enabled ? edit.knowledge.rootPath : "",
    },
    projectId: bot.projectId,
    ownerId: bot.ownerId,
    tools: [...bot.tools],
    ...(bot.seedId ? { seedId: bot.seedId } : {}),
  };
}

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
  nameKey: MessageKey;
  personaKey: MessageKey;
  missionKey: MessageKey;
  model: BotModel;
  role: AgentRole;
  tools: string[];
  evidenceKey: MessageKey;
  requiresKeys?: MessageKey[];
  knowledgeEnabled: boolean;
}

export interface LocalizedSeedBotDefinition {
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
    nameKey: "agents.marbloBots.seed.knowledge.name",
    personaKey: "agents.marbloBots.seed.knowledge.persona",
    missionKey: "agents.marbloBots.seed.knowledge.mission",
    model: "claude",
    role: "backend",
    tools: ["wiki_query"],
    evidenceKey: "agents.marbloBots.seed.knowledge.evidence",
    knowledgeEnabled: true,
  },
  {
    seedId: "fullstack-developer",
    nameKey: "agents.marbloBots.seed.fullstack.name",
    personaKey: "agents.marbloBots.seed.fullstack.persona",
    missionKey: "agents.marbloBots.seed.fullstack.mission",
    model: "codex",
    role: "frontend",
    tools: [
      "create_task",
      "dispatch_task",
      "add_activity",
      "submit_for_review",
    ],
    evidenceKey: "agents.marbloBots.seed.fullstack.evidence",
    knowledgeEnabled: false,
  },
  {
    seedId: "daily-briefing",
    nameKey: "agents.marbloBots.seed.dailyBriefing.name",
    personaKey: "agents.marbloBots.seed.dailyBriefing.persona",
    missionKey: "agents.marbloBots.seed.dailyBriefing.mission",
    model: "claude",
    role: "backend",
    tools: [
      "calendar_list",
      "gmail_search",
      "send_slack_message",
      "send_telegram_message",
    ],
    evidenceKey: "agents.marbloBots.seed.dailyBriefing.evidence",
    requiresKeys: [
      "agents.marbloBots.require.google",
      "agents.marbloBots.require.outputChannel",
    ],
    knowledgeEnabled: true,
  },
  {
    seedId: "mail-calendar-followup",
    nameKey: "agents.marbloBots.seed.mailCalendar.name",
    personaKey: "agents.marbloBots.seed.mailCalendar.persona",
    missionKey: "agents.marbloBots.seed.mailCalendar.mission",
    model: "claude",
    role: "backend",
    tools: [
      "gmail_search",
      "calendar_list",
      "send_slack_message",
      "send_telegram_message",
    ],
    evidenceKey: "agents.marbloBots.seed.mailCalendar.evidence",
    requiresKeys: [
      "agents.marbloBots.require.google",
      "agents.marbloBots.require.outputChannel",
    ],
    knowledgeEnabled: true,
  },
  {
    seedId: "marketer",
    nameKey: "agents.marbloBots.seed.marketer.name",
    personaKey: "agents.marbloBots.seed.marketer.persona",
    missionKey: "agents.marbloBots.seed.marketer.mission",
    model: "claude",
    role: "backend",
    tools: [
      "wiki_query",
      "create_task",
      "dispatch_task",
      "send_slack_message",
      "send_telegram_message",
    ],
    evidenceKey: "agents.marbloBots.seed.marketer.evidence",
    requiresKeys: ["agents.marbloBots.require.outputChannel"],
    knowledgeEnabled: true,
  },
  {
    seedId: "designer",
    nameKey: "agents.marbloBots.seed.designer.name",
    personaKey: "agents.marbloBots.seed.designer.persona",
    missionKey: "agents.marbloBots.seed.designer.mission",
    model: "codex",
    role: "frontend",
    tools: ["wiki_query", "create_task", "dispatch_task", "add_activity"],
    evidenceKey: "agents.marbloBots.seed.designer.evidence",
    knowledgeEnabled: true,
  },
  {
    seedId: "jarvis",
    nameKey: "agents.marbloBots.seed.jarvis.name",
    personaKey: "agents.marbloBots.seed.jarvis.persona",
    missionKey: "agents.marbloBots.seed.jarvis.mission",
    model: "claude",
    role: "backend",
    tools: [
      "wiki_query",
      "create_task",
      "dispatch_task",
      "gmail_search",
      "calendar_list",
      "send_slack_message",
      "send_telegram_message",
    ],
    evidenceKey: "agents.marbloBots.seed.jarvis.evidence",
    requiresKeys: [
      "agents.marbloBots.require.google",
      "agents.marbloBots.require.outputChannel",
    ],
    knowledgeEnabled: true,
  },
];

export function localizeSeedBot(
  seed: SeedBotDefinition,
  translate: (key: MessageKey) => string,
): LocalizedSeedBotDefinition {
  return {
    seedId: seed.seedId,
    name: translate(seed.nameKey),
    persona: translate(seed.personaKey),
    mission: translate(seed.missionKey),
    model: seed.model,
    role: seed.role,
    tools: seed.tools,
    evidence: translate(seed.evidenceKey),
    requires: seed.requiresKeys?.map(translate),
    knowledgeEnabled: seed.knowledgeEnabled,
  };
}

export function localizeSeedBots(
  translate: (key: MessageKey) => string,
): LocalizedSeedBotDefinition[] {
  return SEED_BOTS.map((seed) => localizeSeedBot(seed, translate));
}

export function defaultWikiRootPath(projectFolderPath?: string): string {
  return projectFolderPath
    ? `${projectFolderPath.replace(/\/+$/, "")}/docs/wiki`
    : "";
}

export function seedToDraft(input: {
  seed: LocalizedSeedBotDefinition;
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

export const BOT_DISPATCH_SOURCE = "marblo_bot_gallery";
export const BOT_TASK_SCOPE_PREFIX = "marblo-bot:";

export function botTaskScopeTag(bot: Pick<BotDefinition, "id" | "seedId">) {
  return `${BOT_TASK_SCOPE_PREFIX}${bot.seedId || bot.id}`;
}

export function buildBotDispatchInstruction({
  bot,
  userMission,
  projectRootPath,
}: BuildBotDispatchInstructionInput): string {
  const mission = userMission.trim();
  const tools = bot.tools.length > 0 ? bot.tools.join(", ") : "기본 Marblo MCP";
  const scopeTag = botTaskScopeTag(bot);
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
    `- source: ${BOT_DISPATCH_SOURCE}`,
    `- bot_id: ${bot.id}`,
    `- bot_seed_id: ${bot.seedId ?? ""}`,
    `- task scope tag: ${scopeTag}`,
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
    `1. create_task with the title, description, role, priority, and project scope for this run. The task scope MUST include "${scopeTag}" and the task description MUST keep source=${BOT_DISPATCH_SOURCE}.`,
    `2. dispatch_task with the created task_id, role, instruction, model, cwd, and name from this bot definition. If passing tags, include "${scopeTag}".`,
    "3. The dispatched worker must use wiki_query(root_path) when Knowledge is enabled.",
  ].join("\n");
}
