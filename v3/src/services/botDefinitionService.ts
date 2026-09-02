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
  deleteDocument,
  setDocument,
  subscribeToCollection,
  toTimestamp,
  updateDocument,
} from "./firestore";

const COLLECTION = "botDefinitions";
const DATE_FIELDS = ["createdAt", "updatedAt"];

interface BotDefinitionsTestHatch {
  create(draft: BotDefinitionDraft): Promise<string>;
  upsertSeed(draft: BotDefinitionDraft & { seedId: string }): Promise<string>;
  update?(id: string, draft: BotDefinitionDraft): Promise<void>;
  remove?(id: string): Promise<void>;
  subscribe(
    projectId: string,
    callback: (bots: BotDefinition[]) => void,
  ): Unsubscribe;
}

function testHatch(): BotDefinitionsTestHatch | null {
  if (!window.electronAPI?.testMode?.bypassAuth) return null;
  return (
    (
      window as unknown as {
        __marbloTest?: { botDefinitions?: BotDefinitionsTestHatch };
      }
    ).__marbloTest?.botDefinitions ?? null
  );
}

/**
 * Firestore 문서 → BotDefinition. ★경계 검증이다: 구버전·손상 문서에 `knowledge`
 * 나 `tools` 가 없으면 화면(`bot.knowledge.enabled`)이 렌더 중 터져 갤러리 전체가
 * 비어 버린다. 필수 형태를 기본값으로 채워 한 문서가 목록 전체를 죽이지 않게 한다.
 */
export function normalizeBotDefinitionDoc(
  raw: Record<string, unknown>,
): BotDefinition {
  const converted = convertTimestamps<Record<string, unknown>>(
    raw,
    DATE_FIELDS,
  );
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
      ? converted.tools.filter(
          (tool): tool is string => typeof tool === "string",
        )
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

/**
 * 저장된 봇 수정 (티켓 ddSiPtvknBaA4f1ptCh1).
 *
 * ★`createdAt` 을 다시 쓰지 않는다: updateDoc 은 보낸 필드만 건드리므로 생성
 * 시각이 수정 때마다 갱신되는 사고를 막는다. `updatedAt` 만 새로 찍는다.
 * ★`knowledge` 를 통째 객체로 보내는 건 의도다 — updateDoc 은 중첩 맵을 교체
 * 하므로, Knowledge 를 끌 때 `rootPath` 가 남는 일이 없다.
 * ★draft 는 반드시 `applyBotDefinitionEdit` 로 만들어라. projectId 를 바꾼
 * draft 는 여기서 통과해도 firestore.rules 에서 튕긴다.
 */
export async function updateBotDefinition(
  id: string,
  draft: BotDefinitionDraft,
): Promise<void> {
  if (!id) throw new Error("updateBotDefinition: missing id");

  const hatch = testHatch();
  if (hatch?.update) return hatch.update(id, draft);

  await updateDocument(COLLECTION, id, {
    ...storagePayload(draft),
    updatedAt: toTimestamp(new Date()),
  });
}

/**
 * 저장된 봇 삭제 (티켓 ddSiPtvknBaA4f1ptCh1).
 *
 * ★되돌릴 수 없다. 확인 절차는 호출부(갤러리)의 책임이다.
 * ★남는 것 / 남지 않는 것을 분명히 해 둔다:
 *   - 이 봇으로 이미 dispatch 된 태스크·에이전트는 **영향받지 않는다**. 지시문과
 *     scope 태그(`marblo-bot:{seedId||id}`)가 태스크에 문자열로 복사돼 있어서
 *     봇 문서가 사라져도 실행 중인 일이 조용히 끊기지 않는다(botAgentSource 참고).
 *   - 이 봇을 가리키는 폴러·트리거·로컬 파일은 없다. BotDefinition 은 Firestore
 *     `botDefinitions` 문서가 전부다 — 지우면 그것으로 끝이고 뒤에 도는 루프가
 *     남지 않는다.
 *   - 시드에서 온 봇(seedId 있음)은 갤러리 시드 카드에서 다시 담을 수 있다.
 *     사용자가 직접 만든 봇은 복구 경로가 없다.
 */
export async function deleteBotDefinition(id: string): Promise<void> {
  if (!id) throw new Error("deleteBotDefinition: missing id");

  const hatch = testHatch();
  if (hatch?.remove) return hatch.remove(id);

  await deleteDocument(COLLECTION, id);
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
