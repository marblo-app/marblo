import { where, type Unsubscribe } from "firebase/firestore";
import type {
  Mission,
  MissionStatus,
  MissionStep,
  TimelineEvent,
} from "../types/mission";
import {
  getDocument,
  queryDocuments,
  createDocument,
  updateDocument,
  deleteDocument,
  subscribeToCollection,
  subscribeToDocument,
  toDate,
  toTimestamp,
  convertTimestamps,
} from "./firestore";
import { inMemEnabled, inMem } from "./missionService.inmem";

const COLLECTION = "missions";
const DATE_FIELDS = ["launchedAt", "lastActivityAt", "completedAt"];

// Nested Date 필드 (steps[].startedAt/completedAt, contextLog[].ts) 도 변환.
// convertTimestamps 는 top-level 만 처리하므로 직접 펴줘야 한다.
function toMission(raw: Record<string, unknown>): Mission {
  const m = convertTimestamps<Mission>(raw, DATE_FIELDS);
  if (Array.isArray(m.steps)) {
    m.steps = m.steps.map((step) => ({
      ...step,
      startedAt: step.startedAt ? toDate(step.startedAt) : undefined,
      completedAt: step.completedAt ? toDate(step.completedAt) : undefined,
    }));
  }
  if (Array.isArray(m.contextLog)) {
    m.contextLog = m.contextLog.map((evt) => ({
      ...evt,
      ts: toDate(evt.ts),
    }));
  }
  return m;
}

export async function getMissions(projectId: string): Promise<Mission[]> {
  if (inMemEnabled()) return inMem.getMissions(projectId);
  const docs = await queryDocuments<Record<string, unknown>>(
    COLLECTION,
    where("projectId", "==", projectId),
  );
  return docs
    .map(toMission)
    .sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
}

export async function getMission(missionId: string): Promise<Mission | null> {
  if (inMemEnabled()) return inMem.getMission(missionId);
  const raw = await getDocument<Record<string, unknown>>(COLLECTION, missionId);
  return raw ? toMission(raw) : null;
}

export async function createMission(
  data: Omit<Mission, "id" | "launchedAt" | "lastActivityAt" | "completedAt">,
): Promise<string> {
  if (inMemEnabled()) return inMem.createMission(data);
  const now = new Date();
  return createDocument(COLLECTION, {
    ...data,
    launchedAt: toTimestamp(now),
    lastActivityAt: toTimestamp(now),
    completedAt: null,
  });
}

export async function updateMission(
  missionId: string,
  data: Partial<Omit<Mission, "id" | "launchedAt">>,
): Promise<void> {
  if (inMemEnabled()) return inMem.updateMission(missionId, data);
  const payload: Record<string, unknown> = {
    ...data,
    lastActivityAt: toTimestamp(new Date()),
  };
  if (data.completedAt instanceof Date) {
    payload.completedAt = toTimestamp(data.completedAt);
  }
  await updateDocument(COLLECTION, missionId, payload);
}

export async function deleteMission(missionId: string): Promise<void> {
  if (inMemEnabled()) return inMem.deleteMission(missionId);
  await deleteDocument(COLLECTION, missionId);
}

export function subscribeToMissions(
  projectId: string,
  callback: (missions: Mission[]) => void,
): Unsubscribe {
  if (inMemEnabled()) return inMem.subscribeToMissions(projectId, callback);
  return subscribeToCollection<Record<string, unknown>>(
    COLLECTION,
    [where("projectId", "==", projectId)],
    (docs) =>
      callback(
        docs
          .map(toMission)
          .sort(
            (a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime(),
          ),
      ),
  );
}

export function subscribeToMission(
  missionId: string,
  callback: (mission: Mission | null) => void,
): Unsubscribe {
  if (inMemEnabled()) return inMem.subscribeToMission(missionId, callback);
  return subscribeToDocument<Record<string, unknown>>(
    COLLECTION,
    missionId,
    (raw) => callback(raw ? toMission(raw) : null),
  );
}

// Mission engine 은 owner orchestrator 세션 단독으로 timeline 을 쓰므로 실질 충돌은
// 드물다. Step 2 에서 동시 wakeup 경합이 발생하면 transaction 으로 갈아끼울 것.
export async function appendTimelineEvent(
  missionId: string,
  event: TimelineEvent,
): Promise<void> {
  const mission = await getMission(missionId);
  if (!mission) throw new Error(`Mission not found: ${missionId}`);
  await updateMission(missionId, {
    contextLog: [...mission.contextLog, event],
  });
}

export async function updateMissionStep(
  missionId: string,
  stepIndex: number,
  patch: Partial<MissionStep>,
): Promise<void> {
  const mission = await getMission(missionId);
  if (!mission) throw new Error(`Mission not found: ${missionId}`);
  if (stepIndex < 0 || stepIndex >= mission.steps.length) {
    throw new Error(`Step index out of bounds: ${stepIndex}`);
  }
  const steps = [...mission.steps];
  steps[stepIndex] = { ...steps[stepIndex], ...patch };
  await updateMission(missionId, { steps });
}

// 단순 status write. 전이 검증 (state-machine.ts) 은 Step 2 에서 별도 파일로 분리.
export async function setMissionStatus(
  missionId: string,
  status: MissionStatus,
  extras?: { completedAt?: Date; abandonedReason?: string },
): Promise<void> {
  const patch: Partial<Omit<Mission, "id" | "launchedAt">> = { status };
  if (extras?.completedAt) patch.completedAt = extras.completedAt;
  if (extras?.abandonedReason) patch.abandonedReason = extras.abandonedReason;
  await updateMission(missionId, patch);
}
