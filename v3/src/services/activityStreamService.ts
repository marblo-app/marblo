/**
 * Activity Stream service — subscribes to Firestore `audit_logs` (every MCP
 * tool call lands here) and translates each row into a typed activity event
 * for the right-side ActivityStreamPanel.
 *
 * Source-of-truth contract with electron/mcp-server/tools.ts auditLog():
 *   { projectId, agentId, toolName, params, result, duration, success, createdAt }
 *
 * The renderer-side stream is read-only — writes happen exclusively in the
 * main process via the auditedTool wrapper. This file is intentionally
 * separate from `activityService.ts` (which serves the per-task `activities`
 * Firestore collection — a different concept).
 */
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import type { MessageKey } from "../locales/ko";

export type ActivityType =
  | "task:created"
  | "task:claimed"
  | "task:progress"
  | "task:completed"
  | "task:blocked"
  | "agent:spawned"
  | "pm:feedback"
  | "activity:note"
  | "mission:step"
  | "mission:state"
  | "mission:note"
  | "error"
  | "other";

export interface ActivityEntry {
  id: string;
  type: ActivityType;
  toolName: string;
  agentId: string;
  projectId: string;
  params: Record<string, unknown>;
  result: string;
  duration: number;
  success: boolean;
  createdAt: Date;
}

/**
 * Activity type → `activity.*` 번역 키. 화면 표시명은 정적 UI 라벨이라
 * locale 테이블에서 해석한다. 소비처(ActivityStreamPanel/MacroView)는
 * `t(ACTIVITY_TYPE_LABEL[type])` 로 현재 로케일 문자열을 얻는다.
 */
export const ACTIVITY_TYPE_LABEL: Record<ActivityType, MessageKey> = {
  "task:created": "activity.type.taskCreated",
  "task:claimed": "activity.type.taskClaimed",
  "task:progress": "activity.type.taskProgress",
  "task:completed": "activity.type.taskCompleted",
  "task:blocked": "activity.type.taskBlocked",
  "agent:spawned": "activity.type.agentSpawned",
  "pm:feedback": "activity.type.pmFeedback",
  "activity:note": "activity.type.activityNote",
  "mission:step": "activity.type.missionStep",
  "mission:state": "activity.type.missionState",
  "mission:note": "activity.type.missionNote",
  error: "activity.type.error",
  other: "activity.type.other",
};

export const ACTIVITY_TYPE_ICON: Record<ActivityType, string> = {
  "task:created": "📝",
  "task:claimed": "🤝",
  "task:progress": "🔄",
  "task:completed": "✅",
  "task:blocked": "⚠️",
  "agent:spawned": "🚀",
  "pm:feedback": "💬",
  "activity:note": "📌",
  "mission:step": "🎯",
  "mission:state": "🚦",
  "mission:note": "📋",
  error: "❌",
  other: "•",
};

/** Errors override every other category. Otherwise map by tool name. */
function classify(
  toolName: string,
  params: Record<string, unknown>,
  success: boolean,
): ActivityType {
  if (!success) return "error";
  switch (toolName) {
    case "create_task":
    case "create_tasks_bulk":
      return "task:created";
    case "claim_task":
      return "task:claimed";
    case "update_task_status": {
      const status =
        typeof params.status === "string" ? params.status.toUpperCase() : "";
      if (status === "DONE") return "task:completed";
      if (status === "BLOCKED" || status === "FAILED") return "task:blocked";
      return "task:progress";
    }
    case "submit_for_review":
      return "task:progress";
    case "spawn_agent":
      return "agent:spawned";
    case "acknowledge_feedback":
    case "check_feedback":
      return "pm:feedback";
    case "add_activity":
      return "activity:note";
    default:
      // mission engine 이 audit_logs 에 미러링한 timeline 이벤트.
      // toolName 패턴: "mission.step.started", "mission.step.completed",
      // "mission.supervisor.note", "mission.mission.paused" 등.
      if (toolName.startsWith("mission.step.")) return "mission:step";
      if (toolName.startsWith("mission.supervisor")) return "mission:note";
      if (
        toolName.startsWith("mission.mission.") ||
        toolName.startsWith("mission.agent.")
      ) {
        return "mission:state";
      }
      if (toolName.startsWith("mission.")) return "mission:state";
      return "other";
  }
}

interface AuditLogRaw {
  id: string;
  toolName?: string;
  agentId?: string;
  projectId?: string;
  params?: Record<string, unknown>;
  result?: string;
  duration?: number;
  success?: boolean;
  createdAt?: { toDate: () => Date } | Date | null;
}

function toEntry(raw: AuditLogRaw): ActivityEntry {
  const created =
    raw.createdAt &&
    typeof (raw.createdAt as { toDate?: () => Date }).toDate === "function"
      ? (raw.createdAt as { toDate: () => Date }).toDate()
      : raw.createdAt instanceof Date
        ? raw.createdAt
        : new Date();
  const params = raw.params ?? {};
  const success = raw.success ?? true;
  const toolName = raw.toolName ?? "unknown";
  return {
    id: raw.id,
    type: classify(toolName, params, success),
    toolName,
    agentId: raw.agentId ?? "unknown",
    projectId: raw.projectId ?? "",
    params,
    result: raw.result ?? "",
    duration: raw.duration ?? 0,
    success,
    createdAt: created,
  };
}

/**
 * Live-subscribe to the most recent audit log entries for a project.
 * `max` caps the row count so the panel stays snappy on busy days.
 */
export function subscribeToActivityStream(
  projectId: string,
  callback: (entries: ActivityEntry[]) => void,
  max = 100,
): Unsubscribe {
  const ref = collection(db, "audit_logs");
  const constraints = projectId
    ? [
        where("projectId", "==", projectId),
        orderBy("createdAt", "desc"),
        limit(max),
      ]
    : [orderBy("createdAt", "desc"), limit(max)];
  const q = query(ref, ...constraints);
  return onSnapshot(
    q,
    (snap) => {
      const entries = snap.docs.map((d) =>
        toEntry({ id: d.id, ...(d.data() as Omit<AuditLogRaw, "id">) }),
      );
      callback(entries);
    },
    (err) => {
      console.warn("[ActivityStream] subscribe error:", err);
      callback([]);
    },
  );
}
