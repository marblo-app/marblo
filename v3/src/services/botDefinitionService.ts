import { where, type Unsubscribe } from "firebase/firestore";
import {
  assertValidBotDefinition,
  type BotDefinition,
  type BotDefinitionDraft,
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

function toBotDefinition(raw: Record<string, unknown>): BotDefinition {
  return convertTimestamps<BotDefinition>(raw, DATE_FIELDS);
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
