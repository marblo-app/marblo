import { where, type Unsubscribe } from "firebase/firestore";
import {
  assertValidBotDefinition,
  BOT_MODELS,
  type BotDefinition,
  type BotDefinitionDraft,
  type BotModel,
} from "../lib/botDefinition";
import {
  convertTimestamps,
  createDocument,
  setDocument,
  subscribeToCollection,
  toTimestamp,
} from "./firestore";

const COLLECTION = "botDefinitions";
const DATE_FIELDS = ["createdAt", "updatedAt"];

interface BotDefinitionsTestHatch {
  create(draft: BotDefinitionDraft): Promise<string>;
  upsertSeed(draft: BotDefinitionDraft & { seedId: string }): Promise<string>;
  subscribe(
    projectId: string,
    callback: (bots: BotDefinition[]) => void,
  ): Unsubscribe;
}

function testHatch(): BotDefinitionsTestHatch | null {
  if (!window.electronAPI?.testMode?.bypassAuth) return null;
  return (
    window as unknown as {
      __marbloTest?: { botDefinitions?: BotDefinitionsTestHatch };
    }
  ).__marbloTest?.botDefinitions ?? null;
}

/**
 * Firestore 문서 → BotDefinition. ★경계 검증이다: 구버전·손상 문서에 `knowledge`
 * 나 `tools` 가 없으면 화면(`bot.knowledge.enabled`)이 렌더 중 터져 갤러리 전체가
 * 비어 버린다. 필수 형태를 기본값으로 채워 한 문서가 목록 전체를 죽이지 않게 한다.
 */
export function normalizeBotDefinitionDoc(
  raw: Record<string, unknown>,
): BotDefinition {
  const converted = convertTimestamps<Record<string, unknown>>(raw, DATE_FIELDS);
  const str = (value: unknown): string =>
    typeof value === "string" ? value : "";
  const knowledgeRaw =
    converted.knowledge && typeof converted.knowledge === "object"
      ? (converted.knowledge as Record<string, unknown>)
      : {};
  const model = str(converted.model);
  const date = (value: unknown): Date =>
    value instanceof Date && !Number.isNaN(value.getTime())
      ? value
      : new Date(0);
  return {
    id: str(converted.id),
    projectId: str(converted.projectId),
    ownerId: str(converted.ownerId),
    name: str(converted.name),
    persona: str(converted.persona),
    mission: str(converted.mission),
    model: (BOT_MODELS as readonly string[]).includes(model)
      ? (model as BotModel)
      : "claude",
    role: (str(converted.role) || "backend") as BotDefinition["role"],
    tools: Array.isArray(converted.tools)
      ? converted.tools.filter((tool): tool is string => typeof tool === "string")
      : [],
    knowledge: {
      enabled: knowledgeRaw.enabled === true,
      rootPath: str(knowledgeRaw.rootPath),
    },
    ...(typeof converted.seedId === "string" && converted.seedId
      ? { seedId: converted.seedId }
      : {}),
    createdAt: date(converted.createdAt),
    updatedAt: date(converted.updatedAt),
  };
}

function toBotDefinition(raw: Record<string, unknown>): BotDefinition {
  return normalizeBotDefinitionDoc(raw);
}

function storagePayload(draft: BotDefinitionDraft): Record<string, unknown> {
  const valid = assertValidBotDefinition(draft);
  return {
    ...valid,
    tools: [...valid.tools],
    knowledge: { ...valid.knowledge },
  };
}

export async function createBotDefinition(
  draft: BotDefinitionDraft,
): Promise<string> {
  const hatch = testHatch();
  if (hatch) return hatch.create(draft);

  const now = new Date();
  return createDocument(COLLECTION, {
    ...storagePayload(draft),
    createdAt: toTimestamp(now),
    updatedAt: toTimestamp(now),
  });
}

export async function upsertSeedBotDefinition(
  draft: BotDefinitionDraft & { seedId: string },
): Promise<string> {
  const hatch = testHatch();
  if (hatch) return hatch.upsertSeed(draft);

  const now = new Date();
  const id = `${draft.projectId}_${draft.seedId}`;
  await setDocument(COLLECTION, id, {
    ...storagePayload(draft),
    createdAt: toTimestamp(now),
    updatedAt: toTimestamp(now),
  });
  return id;
}

export function subscribeToBotDefinitions(
  projectId: string,
  callback: (bots: BotDefinition[]) => void,
): Unsubscribe {
  const hatch = testHatch();
  if (hatch) return hatch.subscribe(projectId, callback);

  return subscribeToCollection<Record<string, unknown>>(
    COLLECTION,
    [where("projectId", "==", projectId)],
    (docs) => {
      callback(docs.map(toBotDefinition));
    },
  );
}
