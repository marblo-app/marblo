#!/usr/bin/env node

import { collection, doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import { authReady, db } from "./firebase.js";
import { resolveContextForWrite, isLaneContextId } from "./context.js";
import { applyProjection, type TaskStatus } from "./projection.js";
import { selectProjectId } from "./project-resolve.js";
import {
  taskBodyStorageFields,
  validateTaskBodyInput,
  type TaskBodyFields,
} from "./task-body.js";

type TaskRole = "backend" | "frontend" | "test" | "devops";

interface CreateTaskPayload extends TaskBodyFields {
  title?: unknown;
  role?: unknown;
  priority?: unknown;
  depends_on?: unknown;
  project_id?: unknown;
  context?: unknown;
  scope?: unknown;
}

interface DispatchTaskPayload {
  role?: unknown;
  instruction?: unknown;
  task_id?: unknown;
  complexity?: unknown;
  model?: unknown;
  name?: unknown;
  cwd?: unknown;
  tags?: unknown;
}

interface BridgeDispatchResponse {
  success?: boolean;
  action?: string;
  agentId?: string;
  agentName?: string;
  agentRole?: string;
  model?: string;
  reason?: string;
  taskId?: string | null;
  error?: string;
}

const TASK_ROLES: ReadonlySet<string> = new Set([
  "backend",
  "frontend",
  "test",
  "devops",
]);
const COMPLEXITIES = new Set(["simple", "standard", "complex"]);

function usage(): string {
  return [
    "Marblo MCP fallback CLI",
    "",
    "Commands:",
    "  health",
    "  create-task --json '<json>'",
    "  add-activity --task-id <id> --message <text> [--agent-id <id>]",
    "  dispatch-task --json '<json>'",
    "",
    "This is a narrow fallback for Codex orchestrator sessions when MCP tools are not attached.",
  ].join("\n");
}

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

function parseJsonArg<T extends object>(name: string): T {
  const raw = getArg(name);
  if (!raw) throw new Error(`Missing ${name}`);
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object`);
  }
  return parsed as T;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function optionalString(value: unknown): string | undefined {
  const s = stringValue(value);
  return s ? s : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function priorityValue(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return 0;
  if (value < 1 || value > 5) {
    throw new Error("priority must be an integer from 1 to 5");
  }
  return value;
}

function roleValue(value: unknown): TaskRole {
  const role = stringValue(value);
  if (!TASK_ROLES.has(role)) {
    throw new Error("role must be one of backend, frontend, test, devops");
  }
  return role as TaskRole;
}

function bridgeHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  const token = process.env.MARBLO_BRIDGE_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function notifyOrchestrator(
  message: string,
  contextId?: string,
): Promise<void> {
  const bridgePort = process.env.MARBLO_BRIDGE_PORT;
  if (!bridgePort) return;
  await fetch(`http://127.0.0.1:${bridgePort}/notify-orchestrator`, {
    method: "POST",
    headers: bridgeHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      message,
      projectId: process.env.MARBLO_PROJECT || "",
      contextId: contextId ?? "",
    }),
  }).catch(() => undefined);
}

async function createTask(): Promise<void> {
  const payload = parseJsonArg<CreateTaskPayload>("--json");
  const title = stringValue(payload.title);
  if (!title) throw new Error("title is required");
  const role = roleValue(payload.role);
  const priority = priorityValue(payload.priority);
  const dependsOn = stringArray(payload.depends_on);
  const bodyInput: TaskBodyFields = {
    goal: optionalString(payload.goal),
    changes: stringArray(payload.changes),
    acceptance: stringArray(payload.acceptance),
    notes: stringArray(payload.notes),
    description: optionalString(payload.description),
  };
  const validation = validateTaskBodyInput(bodyInput);
  if (validation.error) throw new Error(validation.error);

  const selectedProject = selectProjectId(
    optionalString(payload.project_id),
    process.env.MARBLO_PROJECT,
  );
  if (!selectedProject.projectId) {
    throw new Error(
      "No project context. Set MARBLO_PROJECT or pass project_id.",
    );
  }

  const now = Timestamp.now();
  const ref = doc(collection(db, "tasks"));
  await setDoc(ref, {
    title,
    ...taskBodyStorageFields(bodyInput),
    role,
    priority,
    status: "TODO" satisfies TaskStatus,
    dependsOn,
    dependsOnCompleted: dependsOn.length === 0,
    claimedBy: null,
    claimedAt: null,
    scope: stringArray(payload.scope),
    comment: optionalString(payload.context) ?? "",
    prUrl: "",
    hasPmFeedback: false,
    createdAt: now,
    updatedAt: now,
    projectId: selectedProject.projectId,
    contextId: resolveContextForWrite(),
    projection: {
      currentStatus: "TODO" satisfies TaskStatus,
      lastAgentId: "",
      lastActivityAt: now,
      lastActivitySummary: "",
      milestonesPassed: [],
    },
  });

  const warnings = [validation.warning, selectedProject.warning].filter(
    Boolean,
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        taskId: ref.id,
        title,
        role,
        priority,
        projectId: selectedProject.projectId,
        warnings,
      },
      null,
      2,
    ),
  );
}

async function addActivity(): Promise<void> {
  const taskId = getArg("--task-id");
  const message = getArg("--message");
  if (!taskId) throw new Error("Missing --task-id");
  if (!message) throw new Error("Missing --message");

  const taskRef = doc(db, "tasks", taskId);
  const snap = await getDoc(taskRef);
  if (!snap.exists()) throw new Error(`Task ${taskId} not found`);
  const task = snap.data() as {
    title?: string;
    status?: string;
    contextId?: string;
  };
  const agentId =
    getArg("--agent-id") || process.env.MARBLO_AGENT_ID || "orchestrator";

  if (task.status === "CLAIMED") {
    await applyProjection(db, taskId, {
      newStatus: "IN_PROGRESS",
      lastAgentId: agentId,
      lastActivitySummary: message,
      validateFrom: (status) => status === "CLAIMED",
    }).catch(() => undefined);
  }
  await applyProjection(db, taskId, {
    lastAgentId: agentId,
    lastActivitySummary: message,
    activityPayload: { agentId, message },
  });

  if (!isLaneContextId(task.contextId)) {
    const preview =
      message.length > 300 ? `${message.slice(0, 300)}...` : message;
    await notifyOrchestrator(
      `[Task Activity] "${task.title || taskId}" progress update (fallback, id=${taskId}, agent=${agentId}): ${preview}`,
      task.contextId,
    );
  }

  console.log(
    JSON.stringify({ ok: true, taskId, activityLogged: true }, null, 2),
  );
}

async function dispatchTask(): Promise<void> {
  const payload = parseJsonArg<DispatchTaskPayload>("--json");
  const bridgePort = process.env.MARBLO_BRIDGE_PORT;
  if (!bridgePort) {
    throw new Error("MARBLO_BRIDGE_PORT not set. Bridge server not available.");
  }
  const role = roleValue(payload.role);
  const instruction = stringValue(payload.instruction);
  if (!instruction) throw new Error("instruction is required");
  const complexity = stringValue(payload.complexity, "standard");
  if (!COMPLEXITIES.has(complexity)) {
    throw new Error("complexity must be simple, standard, or complex");
  }

  const response = await fetch(`http://127.0.0.1:${bridgePort}/dispatch-task`, {
    method: "POST",
    headers: bridgeHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      role,
      instruction,
      taskId: optionalString(payload.task_id),
      complexity,
      model: optionalString(payload.model),
      nameHint: optionalString(payload.name),
      cwd: optionalString(payload.cwd),
      tags: stringArray(payload.tags),
      projectId: process.env.MARBLO_PROJECT || "",
      parentAgentId: process.env.MARBLO_AGENT_ID || "",
      contextId: process.env.MARBLO_CONTEXT || "",
    }),
  });
  const result = (await response.json()) as BridgeDispatchResponse;
  if (!response.ok || !result.success) {
    throw new Error(
      result.error || `dispatch failed with HTTP ${response.status}`,
    );
  }
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

function health(): void {
  console.log(
    JSON.stringify(
      {
        ok: true,
        marbloMcpFallback: true,
        bridgeConnected: Boolean(process.env.MARBLO_BRIDGE_PORT),
        projectId: process.env.MARBLO_PROJECT || "",
        contextId: process.env.MARBLO_CONTEXT || "",
        tokenPresent: Boolean(process.env.MARBLO_BRIDGE_TOKEN),
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!command || command === "--help" || command === "-h") {
    console.log(usage());
    return;
  }

  if (command === "health") {
    health();
    return;
  }

  await authReady;
  if (command === "create-task") {
    await createTask();
    return;
  }
  if (command === "add-activity") {
    await addActivity();
    return;
  }
  if (command === "dispatch-task") {
    await dispatchTask();
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
