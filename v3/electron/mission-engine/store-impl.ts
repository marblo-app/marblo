import { type FirebaseApp } from "firebase/app";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  Timestamp,
  type Firestore,
} from "firebase/firestore";
import type {
  Mission,
  MissionStatus,
  MissionStep,
  MissionTemplateId,
  TimelineEvent,
} from "./types";
import type { MissionStore } from "./ports";

// MissionStore — main process 의 Firestore client SDK 로 missionService.ts 와
// 동일한 시그니처를 재현. 양쪽이 동일한 missions 컬렉션에 쓰기 때문에
// renderer 의 subscribeToMissions 가 변경을 실시간으로 본다.
//
// Nested Timestamp/Date 변환:
//   - read:  steps[].startedAt|completedAt, contextLog[].ts 가 Firestore Timestamp.
//            missionService 의 toMission() 와 동일하게 펴준다.
//   - write: Firebase SDK 가 nested Date 를 자동 Timestamp 로 직렬화 — 추가 처리 X.

const COLLECTION = "missions";

interface MissionDoc {
  projectId: string;
  goal: string;
  templateId: MissionTemplateId;
  status: MissionStatus;
  ownerOrchestratorSessionId: string;
  steps: MissionStep[];
  currentStepIndex: number;
  taskIds: string[];
  contextLog: TimelineEvent[];
  launchedAt: Timestamp;
  lastActivityAt: Timestamp;
  completedAt: Timestamp | null;
  abandonedReason?: string;
}

function toDate(v: unknown): Date {
  if (v instanceof Timestamp) return v.toDate();
  if (v instanceof Date) return v;
  return new Date(v as string | number);
}

function rawToMission(id: string, raw: MissionDoc): Mission {
  return {
    id,
    projectId: raw.projectId,
    goal: raw.goal,
    templateId: raw.templateId,
    status: raw.status,
    ownerOrchestratorSessionId: raw.ownerOrchestratorSessionId,
    steps: (raw.steps ?? []).map((s) => ({
      ...s,
      startedAt: s.startedAt ? toDate(s.startedAt) : undefined,
      completedAt: s.completedAt ? toDate(s.completedAt) : undefined,
    })),
    currentStepIndex: raw.currentStepIndex ?? 0,
    taskIds: raw.taskIds ?? [],
    contextLog: (raw.contextLog ?? []).map((e) => ({
      ...e,
      ts: toDate(e.ts),
    })),
    launchedAt: raw.launchedAt ? toDate(raw.launchedAt) : new Date(),
    lastActivityAt: raw.lastActivityAt
      ? toDate(raw.lastActivityAt)
      : new Date(),
    completedAt: raw.completedAt ? toDate(raw.completedAt) : null,
    abandonedReason: raw.abandonedReason,
  };
}

export interface MissionStoreDeps {
  app: FirebaseApp;
  authReady?: Promise<void>;
}

export function createMissionStore(deps: MissionStoreDeps): MissionStore {
  const db: Firestore = getFirestore(deps.app);
  // 모든 호출 앞에 authReady 를 await — 첫 호출 race 방지.
  const ready = deps.authReady ?? Promise.resolve();

  async function getMission(missionId: string): Promise<Mission | null> {
    await ready;
    const snap = await getDoc(doc(db, COLLECTION, missionId));
    if (!snap.exists()) return null;
    return rawToMission(snap.id, snap.data() as MissionDoc);
  }

  async function createMission(
    data: Omit<Mission, "id" | "launchedAt" | "lastActivityAt" | "completedAt">
  ): Promise<string> {
    await ready;
    const now = Timestamp.now();
    const payload = {
      ...data,
      launchedAt: now,
      lastActivityAt: now,
      completedAt: null,
    };
    const ref = await addDoc(collection(db, COLLECTION), payload);
    return ref.id;
  }

  async function updateMission(
    missionId: string,
    patch: Partial<Omit<Mission, "id" | "launchedAt">>
  ): Promise<void> {
    await ready;
    const payload: Record<string, unknown> = {
      ...patch,
      lastActivityAt: Timestamp.now(),
    };
    if (patch.completedAt instanceof Date) {
      payload.completedAt = Timestamp.fromDate(patch.completedAt);
    }
    await updateDoc(doc(db, COLLECTION, missionId), payload);
  }

  async function appendTimelineEvent(
    missionId: string,
    event: TimelineEvent
  ): Promise<void> {
    // missionService 와 동일하게 단순 read-modify-write. owner orchestrator 단독
    // 쓰기 가정 — 다중 동시 쓰기가 필요해지면 transaction 으로 교체.
    const mission = await getMission(missionId);
    if (!mission) throw new Error(`Mission not found: ${missionId}`);
    await updateMission(missionId, {
      contextLog: [...mission.contextLog, event],
    });
  }

  async function updateMissionStep(
    missionId: string,
    stepIndex: number,
    patch: Partial<MissionStep>
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

  async function setMissionStatus(
    missionId: string,
    status: MissionStatus,
    extras?: { completedAt?: Date; abandonedReason?: string }
  ): Promise<void> {
    const patch: Partial<Omit<Mission, "id" | "launchedAt">> = { status };
    if (extras?.completedAt) patch.completedAt = extras.completedAt;
    if (extras?.abandonedReason) patch.abandonedReason = extras.abandonedReason;
    await updateMission(missionId, patch);
  }

  return {
    getMission,
    createMission,
    updateMission,
    appendTimelineEvent,
    updateMissionStep,
    setMissionStatus,
  };
}
