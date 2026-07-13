export type OrchestratorSwitchMode = "wait" | "takeover";
export type OrchestratorSwitchResumeMode = "fresh" | "previous";

export interface HandoffSourceSession {
  ptySessionId: string | null;
  claudeSessionId?: string;
  model?: string;
}

export interface RawHandoffDoc {
  id: string;
  data: Record<string, unknown>;
}

export interface HandoffTimelineEntry {
  ts: string;
  type: string;
  summary: string;
}

export interface OrchestratorHandoffSnapshot {
  projectId: string;
  rootPath: string;
  from: HandoffSourceSession & {
    stoppedAt: number;
  };
  to: {
    model: string;
    resumeSessionId: "new" | string;
  };
  activeMissions: Array<{
    id: string;
    goal: string;
    status: string;
    currentStepIndex: number;
    currentStep?: {
      index: number;
      type: string;
      status: string;
      skill?: string;
      args?: string;
      liveOutputTail?: string;
    };
    taskIds: string[];
    recentTimeline: HandoffTimelineEntry[];
    unresolvedDecisions: string[];
  }>;
  board: {
    inFlightTasks: Array<{
      id: string;
      title: string;
      status: string;
      role: string;
      claimedBy: string | null;
      missionId?: string;
      updatedAt?: string;
    }>;
    blockedTasks: Array<{
      id: string;
      title: string;
      comment?: string;
    }>;
    reviewTasks: Array<{
      id: string;
      title: string;
      prUrl?: string;
    }>;
  };
}

export interface HandoffSummary {
  activeMissionCount: number;
  inFlightTaskCount: number;
  unresolvedDecisionCount: number;
}

export interface BuildHandoffInput {
  projectId: string;
  rootPath: string;
  from: HandoffSourceSession;
  targetModel: string;
  resumeSessionId: "new" | string;
  missions: RawHandoffDoc[];
  tasks: RawHandoffDoc[];
  now?: number;
}

export interface ResolveSwitchHandoffResumeInput {
  resume: OrchestratorSwitchResumeMode;
  targetModel: string;
  hasSavedGptSession: () => boolean;
  resolvePreviousNonGptSession: () => string | null | undefined;
}

export function resolveSwitchHandoffResumeSessionId({
  resume,
  targetModel,
  hasSavedGptSession,
  resolvePreviousNonGptSession,
}: ResolveSwitchHandoffResumeInput): "new" | string {
  if (resume !== "previous") return "new";
  if (targetModel === "gpt") {
    return hasSavedGptSession() ? "latest" : "new";
  }
  return resolvePreviousNonGptSession() ?? "new";
}

const ACTIVE_MISSION_STATUSES = new Set([
  "planning",
  "active",
  "waiting_for_human",
  "sleeping",
]);
const IN_FLIGHT_TASK_STATUSES = new Set(["CLAIMED", "IN_PROGRESS"]);
const BLOCKED_TASK_STATUS = "BLOCKED";
const REVIEW_TASK_STATUS = "REVIEW";
const TIMELINE_LIMIT = 12;
const SUMMARY_LIMIT = 220;
const OUTPUT_TAIL_LIMIT = 1000;
const SECRET_KEY_RE = /api[_-]?key|token|secret|password|authorization|bearer/i;
const SECRET_VALUE_RE =
  /(sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,}|[A-Za-z0-9_-]{20,}\.[A-Za-z0-9._-]{20,})/g;

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((x): x is string => typeof x === "string")
    : [];
}

function toMillis(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : 0;
  }
  if (
    typeof value === "object" &&
    "toMillis" in value &&
    typeof (value as { toMillis?: unknown }).toMillis === "function"
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (
    typeof value === "object" &&
    "seconds" in value &&
    typeof (value as { seconds?: unknown }).seconds === "number"
  ) {
    return (value as { seconds: number }).seconds * 1000;
  }
  return 0;
}

function toIso(value: unknown): string {
  const ms = toMillis(value);
  return ms > 0 ? new Date(ms).toISOString() : "";
}

function redactString(value: string): string {
  return value.replace(SECRET_VALUE_RE, "[redacted]");
}

export function sanitizeHandoffValue(value: unknown, key = ""): unknown {
  if (SECRET_KEY_RE.test(key)) return "[redacted]";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeHandoffValue(item));
  }
  if (value && typeof value === "object") {
    if (value instanceof Date) return value.toISOString();
    if (
      "toDate" in value &&
      typeof (value as { toDate?: unknown }).toDate === "function"
    ) {
      return (value as { toDate: () => Date }).toDate().toISOString();
    }
    const out: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(
      value as Record<string, unknown>,
    ).slice(0, 30)) {
      out[childKey] = sanitizeHandoffValue(childValue, childKey);
    }
    return out;
  }
  return value;
}

function compactSummary(value: unknown): string {
  const sanitized = sanitizeHandoffValue(value);
  const text =
    typeof sanitized === "string" ? sanitized : JSON.stringify(sanitized);
  return text.length > SUMMARY_LIMIT
    ? `${text.slice(0, SUMMARY_LIMIT)}...`
    : text;
}

function timelineEvents(
  mission: Record<string, unknown>,
): HandoffTimelineEntry[] {
  const raw = Array.isArray(mission.contextLog) ? mission.contextLog : [];
  return raw
    .map((entry) => {
      const e = entry as Record<string, unknown>;
      return {
        tsMs: toMillis(e.ts),
        event: {
          ts: toIso(e.ts),
          type: asString(e.type, "unknown"),
          summary: compactSummary(e.payload ?? {}),
        },
      };
    })
    .sort((a, b) => a.tsMs - b.tsMs)
    .slice(-TIMELINE_LIMIT)
    .map((x) => x.event);
}

function currentStep(mission: Record<string, unknown>) {
  const steps = Array.isArray(mission.steps) ? mission.steps : [];
  const idx = asNumber(mission.currentStepIndex, 0);
  const raw = steps[idx] as Record<string, unknown> | undefined;
  if (!raw) return undefined;
  const liveOutput = asString(raw.liveOutput);
  return {
    index: asNumber(raw.index, idx),
    type: asString(raw.type, "unknown"),
    status: asString(raw.status, "unknown"),
    ...(typeof raw.skill === "string" ? { skill: raw.skill } : {}),
    ...(typeof raw.args === "string" ? { args: redactString(raw.args) } : {}),
    ...(liveOutput
      ? {
          liveOutputTail: redactString(liveOutput).slice(-OUTPUT_TAIL_LIMIT),
        }
      : {}),
  };
}

function unresolvedDecisions(
  mission: Record<string, unknown>,
  recentTimeline: HandoffTimelineEntry[],
): string[] {
  const out: string[] = [];
  if (mission.status === "waiting_for_human") {
    out.push("Mission is waiting for human input.");
  }
  for (const event of recentTimeline) {
    if (
      event.type === "user.input" ||
      event.type === "user.decision" ||
      event.type === "agent.stuck"
    ) {
      out.push(`${event.type}: ${event.summary}`);
    }
  }
  return out.slice(-6);
}

function sortedTasks(tasks: RawHandoffDoc[]): RawHandoffDoc[] {
  return [...tasks].sort(
    (a, b) => toMillis(b.data.updatedAt) - toMillis(a.data.updatedAt),
  );
}

export function summarizeHandoff(
  snapshot: OrchestratorHandoffSnapshot,
): HandoffSummary {
  return {
    activeMissionCount: snapshot.activeMissions.length,
    inFlightTaskCount: snapshot.board.inFlightTasks.length,
    unresolvedDecisionCount: snapshot.activeMissions.reduce(
      (sum, mission) => sum + mission.unresolvedDecisions.length,
      0,
    ),
  };
}

export function buildOrchestratorHandoffSnapshot({
  projectId,
  rootPath,
  from,
  targetModel,
  resumeSessionId,
  missions,
  tasks,
  now = Date.now(),
}: BuildHandoffInput): OrchestratorHandoffSnapshot {
  const activeMissions = missions
    .filter((doc) => ACTIVE_MISSION_STATUSES.has(asString(doc.data.status)))
    .sort(
      (a, b) =>
        toMillis(b.data.lastActivityAt) - toMillis(a.data.lastActivityAt),
    )
    .map((doc) => {
      const recentTimeline = timelineEvents(doc.data);
      return {
        id: doc.id,
        goal: asString(doc.data.goal, "(no goal)"),
        status: asString(doc.data.status, "unknown"),
        currentStepIndex: asNumber(doc.data.currentStepIndex, 0),
        ...(currentStep(doc.data)
          ? { currentStep: currentStep(doc.data) }
          : {}),
        taskIds: asStringArray(doc.data.taskIds),
        recentTimeline,
        unresolvedDecisions: unresolvedDecisions(doc.data, recentTimeline),
      };
    });

  const orderedTasks = sortedTasks(tasks);
  const inFlightTasks = orderedTasks
    .filter((doc) => IN_FLIGHT_TASK_STATUSES.has(asString(doc.data.status)))
    .map((doc) => ({
      id: doc.id,
      title: asString(doc.data.title, "(untitled task)"),
      status: asString(doc.data.status, "unknown"),
      role: asString(doc.data.role, "unknown"),
      claimedBy:
        typeof doc.data.claimedBy === "string" ? doc.data.claimedBy : null,
      ...(typeof doc.data.missionId === "string"
        ? { missionId: doc.data.missionId }
        : {}),
      ...(toIso(doc.data.updatedAt)
        ? { updatedAt: toIso(doc.data.updatedAt) }
        : {}),
    }));
  const blockedTasks = orderedTasks
    .filter((doc) => asString(doc.data.status) === BLOCKED_TASK_STATUS)
    .map((doc) => ({
      id: doc.id,
      title: asString(doc.data.title, "(untitled task)"),
      ...(typeof doc.data.comment === "string"
        ? { comment: redactString(doc.data.comment) }
        : {}),
    }));
  const reviewTasks = orderedTasks
    .filter((doc) => asString(doc.data.status) === REVIEW_TASK_STATUS)
    .map((doc) => ({
      id: doc.id,
      title: asString(doc.data.title, "(untitled task)"),
      ...(typeof doc.data.prUrl === "string" ? { prUrl: doc.data.prUrl } : {}),
    }));

  return {
    projectId,
    rootPath,
    from: {
      ptySessionId: from.ptySessionId,
      ...(from.claudeSessionId
        ? { claudeSessionId: from.claudeSessionId }
        : {}),
      ...(from.model ? { model: from.model } : {}),
      stoppedAt: now,
    },
    to: {
      model: targetModel,
      resumeSessionId,
    },
    activeMissions,
    board: {
      inFlightTasks,
      blockedTasks,
      reviewTasks,
    },
  };
}

export function formatHandoffPrompt(
  snapshot: OrchestratorHandoffSnapshot,
  mode: OrchestratorSwitchMode,
): string {
  const summary = summarizeHandoff(snapshot);
  const compact = JSON.stringify(snapshot, null, 2);
  return [
    "System handoff update: the UI switched the board orchestrator model/session.",
    "Firestore missions/* and tasks/* are the source of truth.",
    "Do not redispatch CLAIMED or IN_PROGRESS tasks.",
    "Do not advance a waiting_for_human mission without user input.",
    `Mode: ${mode}.`,
    mode === "wait"
      ? "Summarize what you inherited and wait for the user."
      : "Inspect current state first, then continue only the next safe action.",
    `Summary: ${summary.activeMissionCount} active mission(s), ${summary.inFlightTaskCount} in-flight task(s), ${summary.unresolvedDecisionCount} unresolved decision(s).`,
    "Handoff snapshot:",
    compact,
  ].join("\n");
}
