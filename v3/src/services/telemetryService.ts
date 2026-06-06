import { httpsCallable } from "firebase/functions";
import { auth, functions } from "../lib/firebase";
import { scrubValue } from "../lib/telemetry/scrub";

export type TelemetryEvent =
  | "agent:spawned"
  | "agent:stopped"
  | "agent:crashed"
  | "agent:restarted"
  | "agent:heartbeat"
  | "task:created"
  | "task:status_changed"
  | "task:completed"
  | "flow:started"
  | "flow:node_executed"
  | "flow:completed"
  | "token:usage"
  | "session:started"
  | "session:ended"
  | "chat:message_sent"
  | "chat:active_users";

interface TelemetryPayload {
  event: TelemetryEvent;
  projectId?: string;
  agentId?: string;
  taskId?: string;
  flowId?: string;
  model?: string;
  role?: string;
  status?: string;
  fromStatus?: string;
  toStatus?: string;
  durationMs?: number;
  tokensInput?: number;
  tokensOutput?: number;
  cost?: number;
  success?: boolean;
  exitCode?: number;
  nodeType?: string;
  nodeCount?: number;
  metadata?: Record<string, unknown>;
  // ML-ready columns mirrored from BigQuery `events` schema. The IPC bridge
  // in App.tsx passes these through verbatim, so adding them here keeps
  // type-safety on the renderer-side helper.
  promptHash?: string;
  promptLength?: number;
  parentAgentId?: string;
  retryOf?: string;
}

let telemetryEnabled = true;
const eventQueue: TelemetryPayload[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const FLUSH_INTERVAL = 10_000;
const MAX_QUEUE_SIZE = 50;

const logTelemetryBatch = httpsCallable(functions, "logTelemetryBatch");
const logHeartbeatFn = httpsCallable(functions, "logHeartbeat");

export function setTelemetryEnabled(enabled: boolean) {
  telemetryEnabled = enabled;
}

const CLIENT_ID_KEY = "marblo.telemetry.clientId";

/**
 * Stable, anonymous per-install identifier. Random UUID persisted in
 * localStorage and NEVER linked to the Firebase account — there is no
 * mapping table anywhere. This is what lets us honestly call the 1st-party
 * BigQuery telemetry 비식별(익명): rows carry this id, never the auth uid.
 * Clearing storage just mints a new id, which is fine for aggregate analytics.
 *
 * Shared with taskService so the task-outcome ML rows use the same anonymous
 * id instead of the account uid.
 */
export function getClientId(): string {
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    return "anon";
  }
}

/**
 * Strip identifying / PII fields from a telemetry payload before it ever
 * touches the queue. scrubValue() masks file paths, emails, phones and BYOK
 * keys and drops free-text user-input keys (prompt/message/…); on top of that
 * we explicitly drop the few account identifiers scrub.ts doesn't know about
 * (senderId/userId/uid/email in metadata). The result is de-identified — safe
 * for the always-on 1st-party sink without per-user consent.
 *
 * Applied at the single logTelemetry() choke point, so it also covers events
 * injected from the main process via the App.tsx IPC bridge.
 */
function anonymize(payload: TelemetryPayload): TelemetryPayload {
  const scrubbed = scrubValue(payload) as TelemetryPayload;
  if (scrubbed.metadata && typeof scrubbed.metadata === "object") {
    const m = { ...(scrubbed.metadata as Record<string, unknown>) };
    delete m.senderId;
    delete m.userId;
    delete m.uid;
    delete m.email;
    scrubbed.metadata = m;
  }
  return scrubbed;
}

// Separate heartbeat queue — goes to agent_heartbeats table, not events
const heartbeatQueue: TelemetryPayload[] = [];
let heartbeatFlushTimer: ReturnType<typeof setTimeout> | null = null;

export function logTelemetry(payload: TelemetryPayload) {
  if (!telemetryEnabled) return;

  // De-identify before anything is queued or sent. Single guarantee point —
  // every telemetry path (convenience helpers + IPC bridge) flows through here.
  const clean = anonymize(payload);

  // Route heartbeats to separate queue/table
  if (clean.event === "agent:heartbeat") {
    heartbeatQueue.push(clean);
    if (heartbeatQueue.length >= 10) {
      flushHeartbeats();
    } else if (!heartbeatFlushTimer) {
      heartbeatFlushTimer = setTimeout(flushHeartbeats, 30_000);
    }
    return;
  }

  eventQueue.push(clean);

  if (eventQueue.length >= MAX_QUEUE_SIZE) {
    flushTelemetry();
  } else if (!flushTimer) {
    flushTimer = setTimeout(flushTelemetry, FLUSH_INTERVAL);
  }
}

async function flushHeartbeats() {
  if (heartbeatFlushTimer) {
    clearTimeout(heartbeatFlushTimer);
    heartbeatFlushTimer = null;
  }
  if (heartbeatQueue.length === 0) return;
  if (!auth.currentUser) return;

  const batch = heartbeatQueue.splice(0, 50);
  const clientId = getClientId();
  try {
    await logHeartbeatFn({
      beats: batch.map((b) => ({
        agentId: b.agentId,
        projectId: b.projectId,
        status: b.status,
        tokensAccumulated: b.tokensInput ?? 0,
        costAccumulated: b.cost ?? 0,
        clientId,
        timestamp: new Date().toISOString(),
      })),
    });
  } catch (error) {
    console.warn("[Telemetry] Heartbeat flush failed:", error);
  }
}

async function flushTelemetry() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  if (eventQueue.length === 0) return;
  if (!auth.currentUser) return;

  const clientId = getClientId();
  const batch = eventQueue
    .splice(0, MAX_QUEUE_SIZE)
    .map((e) => ({ ...e, clientId }));

  try {
    await logTelemetryBatch({ events: batch });
  } catch (error) {
    console.warn("[Telemetry] Flush failed:", error);
    if (eventQueue.length < MAX_QUEUE_SIZE * 2) {
      eventQueue.unshift(...batch);
    }
  }
}

// Convenience functions
export const telemetry = {
  agentSpawned(
    agentId: string,
    name: string,
    model: string,
    role: string,
    projectId?: string,
  ) {
    logTelemetry({
      event: "agent:spawned",
      agentId,
      model,
      role,
      projectId,
      metadata: { name },
    });
  },

  agentStopped(agentId: string, exitCode?: number) {
    logTelemetry({
      event: "agent:stopped",
      agentId,
      exitCode,
      success: exitCode === 0,
    });
  },

  agentCrashed(agentId: string, exitCode: number) {
    logTelemetry({ event: "agent:crashed", agentId, exitCode, success: false });
  },

  agentRestarted(agentId: string, attempt: number) {
    logTelemetry({ event: "agent:restarted", agentId, metadata: { attempt } });
  },

  taskCreated(
    taskId: string,
    projectId: string,
    role: string,
    priority?: number,
  ) {
    logTelemetry({
      event: "task:created",
      taskId,
      projectId,
      role,
      metadata: { priority },
    });
  },

  taskStatusChanged(
    taskId: string,
    fromStatus: string,
    toStatus: string,
    agentId?: string,
  ) {
    logTelemetry({
      event: "task:status_changed",
      taskId,
      fromStatus,
      toStatus,
      agentId,
    });
  },

  taskCompleted(taskId: string, durationMs?: number, agentId?: string) {
    logTelemetry({
      event: "task:completed",
      taskId,
      durationMs,
      agentId,
      success: true,
    });
  },

  flowStarted(flowId: string, nodeCount: number) {
    logTelemetry({ event: "flow:started", flowId, nodeCount });
  },

  flowNodeExecuted(
    flowId: string,
    nodeType: string,
    durationMs: number,
    success: boolean,
  ) {
    logTelemetry({
      event: "flow:node_executed",
      flowId,
      nodeType,
      durationMs,
      success,
    });
  },

  flowCompleted(
    flowId: string,
    status: string,
    durationMs: number,
    nodeCount: number,
  ) {
    logTelemetry({
      event: "flow:completed",
      flowId,
      status,
      durationMs,
      nodeCount,
      success: status === "completed",
    });
  },

  tokenUsage(
    agentId: string,
    model: string,
    tokensInput: number,
    tokensOutput: number,
    cost: number,
    projectId?: string,
  ) {
    logTelemetry({
      event: "token:usage",
      agentId,
      model,
      tokensInput,
      tokensOutput,
      cost,
      projectId,
    });
  },

  sessionStarted(projectId?: string) {
    logTelemetry({ event: "session:started", projectId });
  },

  sessionEnded(durationMs: number) {
    logTelemetry({ event: "session:ended", durationMs });
  },

  chatMessageSent(projectId: string, type: string, senderId: string) {
    logTelemetry({
      event: "chat:message_sent",
      projectId,
      metadata: { type, senderId },
    });
  },

  chatActiveUsers(projectId: string, count: number) {
    logTelemetry({
      event: "chat:active_users",
      projectId,
      metadata: { count },
    });
  },

  flush: flushTelemetry,
};

export default telemetry;
