import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { getRequiredAgentMachineId } from "./agentMachineId";

const ORCH_DOC_ID = (projectId: string) => `orchestrator-${projectId}`;

/**
 * Upsert the single canonical orchestrator agent doc for a project.
 * Stable doc ID = `orchestrator-${projectId}` so manual Start, auto-reconnect
 * and Stop all converge on the same row (instead of leaking a new doc per launch).
 */
export async function upsertOrchestratorAgentDoc(
  projectId: string,
  status: "working" | "stopped" | "idle",
): Promise<string> {
  const id = ORCH_DOC_ID(projectId);
  const machineId = await getRequiredAgentMachineId();
  await setDoc(
    doc(db, "agents", id),
    {
      projectId,
      ownerId: "system",
      name: "Orchestrator",
      model: "claude",
      role: "orchestrator",
      status,
      currentTaskId: null,
      command: "claude",
      skillFile: "",
      machineId,
      createdAt: serverTimestamp(),
    },
    { merge: true },
  );
  return id;
}

/**
 * Delete legacy orchestrator-<timestamp> agent docs that accumulated before
 * the stable-ID migration. Run once per project on app start. The canonical
 * `orchestrator-${projectId}` doc is preserved.
 */
export async function cleanupLegacyOrchestratorDocs(
  projectId: string,
): Promise<number> {
  const keepId = ORCH_DOC_ID(projectId);
  const q = query(
    collection(db, "agents"),
    where("projectId", "==", projectId),
    where("role", "==", "orchestrator"),
  );
  const snap = await getDocs(q);
  const stale = snap.docs.filter((d) => d.id !== keepId);
  await Promise.all(stale.map((d) => deleteDoc(d.ref).catch(() => undefined)));
  return stale.length;
}
