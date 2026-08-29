import { where } from "firebase/firestore";
import type { Agent } from "../types/agent";
import {
  getDocument,
  queryDocuments,
  createDocument,
  updateDocument,
  deleteDocument,
  toTimestamp,
  convertTimestamps,
} from "./firestore";
import { recordProjectAuditEvent } from "./projectAuditService";
import { agentSpawnAuditMetadata } from "../lib/projectAudit";
import { getRequiredAgentMachineId } from "./agentMachineId";

const COLLECTION = "agents";
const DATE_FIELDS = ["createdAt"];

function toAgent(raw: Record<string, unknown>): Agent {
  return convertTimestamps<Agent>(raw, DATE_FIELDS);
}

export async function getAgents(projectId: string): Promise<Agent[]> {
  const docs = await queryDocuments<Record<string, unknown>>(
    COLLECTION,
    where("projectId", "==", projectId),
  );
  return docs.map(toAgent);
}

export async function getAgent(agentId: string): Promise<Agent | null> {
  const raw = await getDocument<Record<string, unknown>>(COLLECTION, agentId);
  return raw ? toAgent(raw) : null;
}

export async function createAgent(
  data: Omit<Agent, "id" | "createdAt">,
): Promise<string> {
  if (!data.projectId.trim()) {
    throw new Error("Cannot create agent without projectId.");
  }
  const machineId =
    data.machineId?.trim() || (await getRequiredAgentMachineId());
  const agentId = await createDocument(COLLECTION, {
    ...data,
    machineId,
    createdAt: toTimestamp(new Date()),
  });

  // 스폰 감사 귀속. 여기가 렌더러의 단일 스폰 초크포인트라 UI 표면(Agents 탭 /
  // 카드 ▶ Start / Lanes / 재시작)이 몇 개든 한 번만 잡힌다 — 각 컴포넌트를
  // 계측하면 표면이 늘 때마다 누락되거나 중복된다.
  recordProjectAuditEvent({
    projectId: data.projectId,
    type: "agent.spawned",
    taskId: data.currentTaskId ?? null,
    targetId: agentId,
    metadata: agentSpawnAuditMetadata(data.name, data.model, data.role),
  });

  return agentId;
}

/**
 * 이 launch 가 실제로 쓴 구체 모델(`model@effort`)을 agent doc 에 스탬프한다.
 *
 * UI 에서 띄운 에이전트(Agents 탭 / 카드 ▶ Start / Lanes / 재시작)는 브릿지의
 * agent:spawned 훅을 타지 않아서, main 이 돌려준 launch 결과가 구체 모델을 얻는
 * 유일한 지점이다. 값이 없으면(모델을 핀하지 않은 launch) 아무것도 쓰지 않는다 —
 * 빈 값을 써서 기존 스탬프를 지우면 배지만 사라지고 얻는 게 없다.
 *
 * best-effort: 실패해도 에이전트는 이미 돌고 있으므로 배지만 벤더로 남는다.
 */
export function stampSpawnedModel(
  agentId: string,
  spawnedModel?: string,
): void {
  if (!spawnedModel) return;
  updateAgent(agentId, { spawnedModel }).catch((err) => {
    console.warn("[agentService] spawnedModel stamp failed:", agentId, err);
  });
}

export async function updateAgent(
  agentId: string,
  data: Partial<Omit<Agent, "id" | "createdAt">>,
): Promise<void> {
  await updateDocument(COLLECTION, agentId, data);
}

export async function deleteAgent(agentId: string): Promise<void> {
  await deleteDocument(COLLECTION, agentId);
}
