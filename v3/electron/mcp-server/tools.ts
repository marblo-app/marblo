import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  query,
  where,
  Timestamp,
  type QueryConstraint,
} from "firebase/firestore";
import { db } from "./firebase.js";
import {
  resolveContext,
  resolveContextForWrite,
  resolveMissionContextForWrite,
  contextReadFilter,
  isLaneContextId,
  isOrchestratorAgentId,
  isTaskInReadContext,
  buildMissionStepReportedEvent,
  type MissionStepReportedEvent,
} from "./context.js";
import {
  applyProjection,
  resolveDependentIfReady,
  type ApplyProjectionInput,
} from "./projection.js";
import { validateTaskBodyInput, taskBodyStorageFields } from "./task-body.js";
import {
  formatAgentTaskRoleLabel,
  normalizeFirestoreFallbackAgentStatus,
} from "./agent-status-labels.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";

// ── State Machine ────────────────────────────────────────────

type TaskStatus =
  | "TODO"
  | "CLAIMED"
  | "IN_PROGRESS"
  | "REVIEW"
  | "BLOCKED"
  | "FAILED"
  | "DONE";

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  // CLAIMED → TODO is the manual claim-recall path (renderer's
  // `unclaimTask`). Kept in sync with src/services/stateMachine.ts.
  TODO: ["CLAIMED", "IN_PROGRESS"],
  CLAIMED: ["IN_PROGRESS", "REVIEW", "DONE", "FAILED", "TODO"],
  IN_PROGRESS: ["REVIEW", "DONE", "BLOCKED", "FAILED"],
  REVIEW: ["DONE", "TODO", "IN_PROGRESS"],
  BLOCKED: ["IN_PROGRESS", "TODO"],
  FAILED: ["TODO", "IN_PROGRESS"],
  DONE: [],
};

function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Helpers ──────────────────────────────────────────────────

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TASK_NNN_RE = /^TASK-(\d+)$/i;

const DEFAULT_PROJECT = process.env.MARBLO_PROJECT || "";
const SKILLS_DIR =
  process.env.MARBLO_SKILLS_DIR ||
  path.resolve(
    new URL(".", import.meta.url).pathname,
    "..",
    "..",
    "..",
    "skills",
  );

/**
 * Send a notification to the orchestrator via the bridge server.
 * Fire-and-forget — errors are silently ignored.
 *
 * `contextId` scopes the notification to the right orchestrator (Quick Lanes
 * 눈/브레인 분리). The board orchestrator only owns context="board" tasks;
 * mission tasks carry contextId=missionId. Without this, every mission task's
 * status/activity/review notification was routed to the board orchestrator
 * (the only one the bridge's projectId lookup knew), flooding the main orch
 * PTY with mission progress. The bridge uses contextId to route mission-context
 * notifications to the mission orchestrator instead (and drop them from board).
 * Empty/"board" stays on the board orchestrator (unchanged behavior).
 */
function notifyOrchestrator(message: string, contextId?: string): void {
  const bridgePort = process.env.MARBLO_BRIDGE_PORT;
  if (!bridgePort) return;
  // Forward MARBLO_PROJECT so the bridge routes to the right per-project
  // orchestrator in multi-window mode. Each MCP server is launched with
  // MARBLO_PROJECT set by the agent / orchestrator config generator, so
  // this scopes notifications correctly without renderer involvement.
  const projectId = process.env.MARBLO_PROJECT || "";
  fetch(`http://127.0.0.1:${bridgePort}/notify-orchestrator`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, projectId, contextId: contextId ?? "" }),
  }).catch(() => {
    /* best-effort */
  });
}

/**
 * B안 Phase 2 보고 채널 — 오케스트레이터의 `mission_step_done` 을 미션 지휘자
 * (Conductor) 로 전달한다.
 *
 * MCP 서버는 별도 프로세스라 메인 프로세스의 in-process `MissionEventBus` 에 직접
 * emit 할 수 없다(spawn/dispatch 와 동일 제약). 그래서 bridge 로 POST 하면, 메인
 * 프로세스가 이 요청을 받아
 *   eventBus.emit({ type: "mission.step_reported", missionId, payload: { stepIndex, result } })
 * 로 변환한다. 계약: P2-A 지휘자가 이 이벤트를 구독해 `onStepReport` 로 처리.
 *
 * ── 통합 seam (P2-C 스코프 밖 — 메인 프로세스 1줄 배선) ──
 *   bridge-server: `POST /mission-step-report` 핸들러가 body `{missionId, stepIndex,
 *   result}` 를 파싱해 주입된 콜백 호출 → main.ts 가 그 콜백을 위 `eventBus.emit` 로
 *   연결. 이 엔드포인트가 아직 없으면 아래 fetch 는 조용히 무시된다(best-effort).
 *
 * Fire-and-forget — 보고 유실이 미션 진행을 막지 않도록 에러를 삼킨다.
 */
function emitMissionStepReport(event: MissionStepReportedEvent): void {
  const bridgePort = process.env.MARBLO_BRIDGE_PORT;
  if (!bridgePort) return;
  fetch(`http://127.0.0.1:${bridgePort}/mission-step-report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      missionId: event.missionId,
      stepIndex: event.payload.stepIndex,
      result: event.payload.result,
    }),
  }).catch(() => {
    /* best-effort */
  });
}

// Firestore document IDs are 20-char alphanumeric strings
const FIRESTORE_ID_RE = /^[A-Za-z0-9]{15,}$/;

function resolveProject(projectId?: string): string {
  // Always prefer the injected DEFAULT_PROJECT (Firestore document ID from Electron)
  if (DEFAULT_PROJECT) return DEFAULT_PROJECT;
  // Only accept explicit project_id if it looks like a Firestore document ID
  if (projectId && FIRESTORE_ID_RE.test(projectId)) return projectId;
  // Reject human-readable names like "stockai-platform" — they cause projectId mismatch
  if (projectId) {
    console.warn(
      `[MCP] Ignoring non-Firestore project_id="${projectId}". Use MARBLO_PROJECT env var.`,
    );
  }
  return "";
}

interface TaskDoc {
  id: string;
  projectId: string;
  contextId: string;
  missionId?: string;
  title: string;
  description: string;
  goal?: string;
  changes?: string[];
  acceptance?: string[];
  notes?: string[];
  status: TaskStatus;
  role: string;
  priority: number;
  dependsOn: string[];
  dependsOnCompleted: boolean;
  claimedBy: string | null;
  scope: string[];
  comment: string;
  prUrl: string;
  hasPmFeedback: boolean;
}

async function fetchTask(taskId: string): Promise<TaskDoc | null> {
  const ref = doc(db, "tasks", taskId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as TaskDoc;
}

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

async function fetchAgentRole(agentId: string): Promise<string | null> {
  if (!agentId || agentId === "unknown" || isOrchestratorAgentId(agentId)) {
    return null;
  }
  try {
    const snap = await getDoc(doc(db, "agents", agentId));
    if (!snap.exists()) return null;
    const role = snap.data().role;
    return typeof role === "string" && role.trim() ? role : null;
  } catch (err) {
    console.warn("[MCP] Failed to fetch agent role:", err);
    return null;
  }
}

async function markAgentStoppedInFirestore(agentId: string): Promise<void> {
  if (!agentId) return;
  try {
    await updateDoc(doc(db, "agents", agentId), {
      status: "stopped",
      currentTaskId: null,
      updatedAt: Timestamp.now(),
    });
  } catch (err) {
    console.warn("[MCP] Failed to mark killed agent stopped:", err);
  }
}

function applyMissionContextTags(
  data: Record<string, unknown>,
  missionId: string | null = resolveMissionContextForWrite(),
): string | null {
  if (!missionId) return null;

  const existingMissionId = data.missionId;
  if (
    typeof existingMissionId === "string" &&
    existingMissionId.length > 0 &&
    existingMissionId !== missionId
  ) {
    return `missionId mismatch: existing '${existingMissionId}' does not match MARBLO_CONTEXT '${missionId}'.`;
  }

  const existingContextId = data.contextId;
  if (
    typeof existingContextId === "string" &&
    existingContextId.length > 0 &&
    existingContextId !== missionId
  ) {
    return `contextId mismatch: existing '${existingContextId}' does not match mission context '${missionId}'.`;
  }

  data.missionId = missionId;
  data.contextId = missionId;
  return null;
}

async function ensureTaskMissionContext(
  taskId: string,
  task: TaskDoc,
  missionId: string | null = resolveMissionContextForWrite(),
): Promise<string | null> {
  if (!missionId) return null;

  if (task.missionId && task.missionId !== missionId) {
    return `Task ${taskId} belongs to missionId '${task.missionId}', not current mission context '${missionId}'.`;
  }
  if (task.contextId && task.contextId !== missionId) {
    return `Task ${taskId} has contextId '${task.contextId}', not current mission context '${missionId}'.`;
  }

  const patch: Record<string, unknown> = {};
  if (!task.missionId) patch.missionId = missionId;
  if (!task.contextId) patch.contextId = missionId;
  if (Object.keys(patch).length > 0) {
    patch.updatedAt = Timestamp.now();
    await updateDoc(doc(db, "tasks", taskId), patch);
  }

  return null;
}

// ── Audit Logging ─────────────────────────────────────────────

const MARBLO_AGENT_ID = process.env.MARBLO_AGENT_ID || "unknown";

/**
 * 작업자 귀속(claimedBy / projection.lastAgentId)에 쓸 agent id.
 *
 * 오케스트레이터가 task 를 대신 갱신(상태 전이/auto-claim)할 때 자기 공유
 * id(`orchestrator-<projectId>`)를 담당자로 찍으면 get_all_tasks/보드가 다수
 * task 의 담당자를 그 단일 id 로 표시해 부하분산이 과부하로 오인한다. 오케·
 * unknown 은 "" 로 떨어뜨려 — applyProjection 의 `lastAgentId || prev` 규칙이
 * 직전 실제 작업자 값을 보존하고, claimedBy auto-claim 은 `&& WORKER_AGENT_ID`
 * 가드로 건너뛴다. (작업자가 자기 id 로 직접 호출하면 그대로 귀속된다.)
 */
function workerAgentId(rawId: string): string {
  if (!rawId || rawId === "unknown" || isOrchestratorAgentId(rawId)) return "";
  return rawId;
}
const WORKER_AGENT_ID = workerAgentId(MARBLO_AGENT_ID);

function auditLog(entry: {
  projectId: string;
  agentId: string;
  toolName: string;
  params: Record<string, unknown>;
  result: string;
  duration: number;
  success: boolean;
}): void {
  addDoc(collection(db, "audit_logs"), {
    ...entry,
    createdAt: Timestamp.now(),
  }).catch((err) => {
    console.error("[Audit] Failed to write audit log:", err);
  });
}

function sanitizeParams(
  params: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value.length > 200) {
      sanitized[key] = value.slice(0, 200) + "...";
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function truncateResult(result: unknown): string {
  const t = typeof result === "string" ? result : JSON.stringify(result);
  return t.length > 500 ? t.slice(0, 500) + "..." : t;
}

// ── Tool Registration ────────────────────────────────────────

// ── 토큰 절감: list 도구 결과 cap + 안내 footer ──
// MCP 도구 결과는 호출 세션의 컨텍스트에 끝까지 잔존한다(오케/에이전트 비용의 큰
// 축). list 도구가 무제한 덤프하면 컨텍스트가 불어나므로 기본 cap 을 둔다.
const LIST_LIMIT_DEFAULT = 50;
const TITLE_MAX = 80;
function truncTitle(title: unknown, max = TITLE_MAX): string {
  const s = typeof title === "string" ? title : String(title ?? "");
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
function capLines(lines: string[], limit: number, hint: string): string {
  if (lines.length <= limit) return lines.join("\n");
  const hidden = lines.length - limit;
  return `${lines.slice(0, limit).join("\n")}\n… (+${hidden} more hidden — ${hint})`;
}
function isTerminalTaskStatus(s: unknown): boolean {
  return s === "DONE" || s === "FAILED";
}

export function registerTools(server: McpServer): void {
  // Wrap server.tool to add automatic audit logging
  const originalTool = server.tool.bind(server);
  function auditedTool(
    name: string,
    description: string,
    schema: any,
    handler: (...args: any[]) => Promise<any>,
    opts: { userFacing?: boolean } = {},
  ): void {
    const userFacing = opts.userFacing ?? true;
    if (!userFacing) {
      // 사용자 액티비티 스트림에 노출하지 않는 read-only 조회 툴.
      // 감사 로그 자체를 쓰지 않는다 — 시스템 페이로드(스킬 본문 등) 노이즈 방지.
      originalTool(name, description, schema, handler);
      return;
    }
    originalTool(name, description, schema, async (...args: any[]) => {
      const start = Date.now();
      let success = true;
      let resultText = "";

      try {
        const result = await handler(...args);
        resultText = result?.content?.[0]?.text || "";
        return result;
      } catch (err) {
        success = false;
        resultText = err instanceof Error ? err.message : String(err);
        throw err;
      } finally {
        const duration = Date.now() - start;
        const params = args[0] || {};
        const projectId = resolveProject(params.project_id);

        auditLog({
          projectId,
          agentId: MARBLO_AGENT_ID,
          toolName: name,
          params: sanitizeParams(params),
          result: truncateResult(resultText),
          duration,
          success,
        });
      }
    });
  }

  // 1. get_all_tasks
  auditedTool(
    "get_all_tasks",
    "List tasks (open/non-terminal first, completed hidden at the tail). Filter by project/role; all_projects=true to span projects. Capped to `limit` (default 50) to keep results lean — raise limit or filter to see more.",
    {
      project_id: z.string().optional().describe("Project ID"),
      role: z
        .string()
        .optional()
        .describe("Filter by role (backend/frontend/test/devops)"),
      all_projects: z
        .boolean()
        .optional()
        .describe(
          "Ignore default project filter, show all projects (default: false)",
        ),
      all_contexts: z
        .boolean()
        .optional()
        .describe(
          "Ignore default context filter, show all contexts in the project (default: false)",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe("Max rows to return (default 50; open tasks shown first)"),
    },
    async ({ project_id, role, all_projects, all_contexts, limit }) => {
      const projectId = all_projects ? "" : resolveProject(project_id);
      const contextId = contextReadFilter(!!all_contexts);
      const filterContextInMemory = contextId === "board";
      const constraints: QueryConstraint[] = [];
      if (projectId) constraints.push(where("projectId", "==", projectId));
      if (contextId && !filterContextInMemory)
        constraints.push(where("contextId", "==", contextId));
      if (role) constraints.push(where("role", "==", role));

      const q = query(collection(db, "tasks"), ...constraints);
      const snap = await getDocs(q);

      if (snap.empty) return text("No tasks found.");

      // 열린(비terminal) task 를 먼저, 같은 그룹 내에선 priority 내림차순. 완료/실패
      // 다수가 컨텍스트를 먹던 것을 cap 으로 꼬리에서 잘라낸다.
      const docs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as TaskDoc)
        .filter(
          (t) => !filterContextInMemory || isTaskInReadContext(t, contextId),
        )
        .sort((a, b) => {
          const ta = isTerminalTaskStatus(a.status) ? 1 : 0;
          const tb = isTerminalTaskStatus(b.status) ? 1 : 0;
          if (ta !== tb) return ta - tb; // open first
          return (b.priority ?? 0) - (a.priority ?? 0);
        });
      const lines = docs.map((t) => {
        const claimed = t.claimedBy ? ` → ${t.claimedBy}` : "";
        const proj = all_projects ? ` project=${t.projectId || "(none)"}` : "";
        const ctx = all_contexts ? ` ctx=${t.contextId || "(none)"}` : "";
        return `- [${t.status}] ${truncTitle(t.title)} (role=${t.role}, id=${t.id}${proj}${ctx})${claimed}`;
      });
      return text(
        capLines(
          lines,
          limit ?? LIST_LIMIT_DEFAULT,
          "raise limit or filter by role; completed tasks are at the tail",
        ),
      );
    },
    { userFacing: false },
  );

  // 2. get_available_tasks
  auditedTool(
    "get_available_tasks",
    "Get TODO tasks available for the given role. Returns tasks whose dependencies are satisfied.",
    {
      role: z.string().describe("Agent role (backend/frontend/test/devops)"),
      project_id: z.string().optional().describe("Project ID"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Max rows (default 50)"),
    },
    async ({ role, project_id, limit }) => {
      const projectId = resolveProject(project_id);
      // Context scope — mirror get_all_tasks so the board orchestrator's
      // dispatch feed only surfaces its own context. Only the board orch sets
      // MARBLO_CONTEXT="board" (orchestrator-manager → contextForKind), so it
      // alone becomes scoped to board tasks; plain worker agents and the
      // mission orchestrator leave it unset → unscoped (zero behavior change).
      // Without this, mission(contextId=missionId)/lane(contextId=lane:*) TODOs
      // leaked into the board orchestrator's awareness and got dispatched/
      // discussed there — the surviving PTY-contamination path after P3.
      const contextId = resolveContext();
      // The board context must also surface legacy/externally-created TODOs that
      // were stored without a contextId. Firestore can't OR "contextId=='board'"
      // with "contextId unset" in a single `==`, so for board we drop the
      // Firestore context filter and match on the effective (backfilled)
      // contextId in memory below. Non-board contexts (lane:* / mission) always
      // carry an explicit contextId on write, so they keep the strict Firestore
      // `==` and never leak into the board feed.
      const filterContextInMemory = contextId === "board";
      const constraints: QueryConstraint[] = [
        where("status", "==", "TODO"),
        where("role", "==", role),
      ];
      if (projectId) constraints.push(where("projectId", "==", projectId));
      if (contextId && !filterContextInMemory)
        constraints.push(where("contextId", "==", contextId));

      const q = query(collection(db, "tasks"), ...constraints);
      const snap = await getDocs(q);

      const tasks = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as TaskDoc)
        .filter(
          (t) => !filterContextInMemory || isTaskInReadContext(t, contextId),
        )
        .filter((t) => t.dependsOnCompleted)
        .sort((a, b) => b.priority - a.priority);

      if (tasks.length === 0)
        return text(`No available tasks for role '${role}'.`);

      const lines = tasks.map((t) => {
        const deps = t.dependsOn?.length
          ? ` (depends_on: ${t.dependsOn.join(", ")})`
          : "";
        return `- [${t.id}] ${truncTitle(t.title)} (priority=${t.priority})${deps}`;
      });
      return text(
        capLines(lines, limit ?? LIST_LIMIT_DEFAULT, "raise limit to see more"),
      );
    },
    { userFacing: false },
  );

  // 3. create_task
  auditedTool(
    "create_task",
    "Create a task. Use STRUCTURED fields: goal (1-2 sentences), changes[] (bullets), acceptance[] (verifiable done-criteria), notes[] (optional). Put file paths in scope, not prose. role: backend/frontend/test/devops.",
    {
      title: z.string().describe("Task title (한 줄)"),
      goal: z
        .string()
        .optional()
        .describe("목표: 무엇을/왜 1-2문장. 핵심. 파일 경로 금지(→scope)."),
      changes: z
        .array(z.string())
        .optional()
        .describe(
          "변경·접근: 추가/수정할 함수·동작을 짧은 불릿으로. 줄글/중복 금지.",
        ),
      acceptance: z
        .array(z.string())
        .optional()
        .describe(
          "완료 기준: 검증 가능한 체크 항목(예: 'tests/unit/foo.test.ts 통과').",
        ),
      notes: z
        .array(z.string())
        .optional()
        .describe("제약·주의(선택): 롤백/재사용 규칙 등."),
      description: z
        .string()
        .optional()
        .describe("[legacy] 자유서술. 구조화 필드(goal 등)를 쓰면 생략."),
      role: z.string().describe("Agent role (backend/frontend/test/devops)"),
      priority: z
        .number()
        .optional()
        .describe("Priority 1-5 (higher = more urgent)"),
      depends_on: z
        .array(z.string())
        .optional()
        .describe("Task IDs this depends on"),
      project_id: z.string().optional().describe("Project ID"),
      context: z.string().optional().describe("Environment constraints"),
      scope: z.array(z.string()).optional().describe("File paths to modify"),
    },
    async ({
      title,
      goal,
      changes,
      acceptance,
      notes,
      description,
      role,
      priority,
      depends_on,
      project_id,
      context,
      scope,
    }) => {
      const projectId = resolveProject(project_id);
      if (!projectId) {
        return text(
          "Error: No project context. Set MARBLO_PROJECT env var or pass project_id parameter.\n" +
            "In Electron: agents get this automatically. For external CLI: set MARBLO_PROJECT in MCP config.",
        );
      }

      const bodyInput = { goal, changes, acceptance, notes, description };
      const { error, warning } = validateTaskBodyInput(bodyInput);
      if (error) return text(`Error: ${error}`);

      const now = Timestamp.now();
      const deps = depends_on ?? [];

      const data: Record<string, unknown> = {
        title,
        ...taskBodyStorageFields(bodyInput),
        role,
        priority: priority ?? 0,
        status: "TODO",
        dependsOn: deps,
        dependsOnCompleted: deps.length === 0,
        claimedBy: null,
        claimedAt: null,
        scope: scope ?? [],
        comment: context ?? "",
        prUrl: "",
        hasPmFeedback: false,
        createdAt: now,
        updatedAt: now,
        projectId,
        contextId: resolveContextForWrite(),
      };
      const missionContextError = applyMissionContextTags(data);
      if (missionContextError) return text(`Error: ${missionContextError}`);

      const ref = await addDoc(collection(db, "tasks"), data);
      return text(
        `Task created successfully!\nID: ${
          ref.id
        }\nTitle: ${title}\nRole: ${role}\nPriority: ${priority ?? 0}` +
          (warning ? `\n⚠️ ${warning}` : ""),
      );
    },
  );

  // 4. create_tasks_bulk
  auditedTool(
    "create_tasks_bulk",
    "Create multiple tasks at once. Pass tasks_json (JSON string) or tasks (array). Each item: title, goal, changes[], acceptance[], notes?, role, priority?, depends_on?, context?, scope?, alias?. Use structured fields (goal/changes/acceptance), not a single description blob. depends_on supports TASK-NNN (1-based index), alias, or UUID.",
    {
      tasks_json: z
        .string()
        .optional()
        .describe("JSON array of task objects (string)"),
      tasks: z
        .array(z.record(z.unknown()))
        .optional()
        .describe("Array of task objects (alternative to tasks_json)"),
    },
    async ({ tasks_json, tasks }) => {
      let taskList: Record<string, unknown>[];

      if (tasks && Array.isArray(tasks)) {
        // 배열 직접 전달
        taskList = tasks;
      } else if (tasks_json) {
        // JSON 문자열 전달
        try {
          taskList = JSON.parse(tasks_json);
        } catch (e: unknown) {
          return text(`Error: Invalid JSON — ${(e as Error).message}`);
        }
        if (!Array.isArray(taskList))
          return text("Error: tasks_json must be a JSON array.");
      } else {
        return text(
          "Error: Either tasks_json (string) or tasks (array) is required.",
        );
      }

      const project = resolveProject("");
      if (!project) {
        return text(
          "Error: No project context. Set MARBLO_PROJECT env var or include project_id in each task.\n" +
            "In Electron: agents get this automatically. For external CLI: set MARBLO_PROJECT in MCP config.",
        );
      }

      // Phase 1: Build alias map (symbolic name → array index)
      const aliasMap: Record<string, number> = {};
      for (let i = 0; i < taskList.length; i++) {
        aliasMap[`TASK-${String(i + 1).padStart(3, "0")}`.toUpperCase()] = i;
        const alias = taskList[i].alias as string | undefined;
        if (alias) aliasMap[alias] = i;
      }

      // Phase 2: Sequential creation with dependency resolution
      const indexToId: Record<number, string> = {};
      const results: string[] = [];
      let successCount = 0;

      for (let i = 0; i < taskList.length; i++) {
        const t = taskList[i];
        let resolvedDeps: string[] | null = null;
        let depError: string | null = null;
        const rawDeps = t.depends_on as string[] | undefined;

        if (rawDeps && rawDeps.length > 0) {
          resolvedDeps = [];
          for (const depRef of rawDeps) {
            if (UUID_RE.test(depRef)) {
              resolvedDeps.push(depRef);
              continue;
            }

            const taskMatch = TASK_NNN_RE.exec(depRef);
            if (taskMatch) {
              const idx = parseInt(taskMatch[1], 10) - 1;
              if (idx in indexToId) {
                resolvedDeps.push(indexToId[idx]);
                continue;
              }
              depError =
                idx >= i
                  ? `depends_on '${depRef}' references a task not yet created (forward reference)`
                  : `depends_on '${depRef}' — task at index ${idx} failed or out of range`;
              break;
            }

            if (depRef in aliasMap) {
              const idx = aliasMap[depRef];
              if (idx in indexToId) {
                resolvedDeps.push(indexToId[idx]);
                continue;
              }
              depError =
                idx >= i
                  ? `depends_on alias '${depRef}' references a task not yet created`
                  : `depends_on alias '${depRef}' — referenced task failed`;
              break;
            }

            depError = `depends_on '${depRef}' is not a valid UUID, TASK-NNN, or known alias`;
            break;
          }
        }

        if (depError) {
          results.push(
            `  [FAILED] ${(t.title as string) || `task #${i}`} — ${depError}`,
          );
          continue;
        }

        const now = Timestamp.now();
        const deps = resolvedDeps ?? [];
        const data: Record<string, unknown> = {
          title: (t.title as string) || "",
          ...taskBodyStorageFields({
            goal: t.goal as string | undefined,
            changes: t.changes as string[] | undefined,
            acceptance: t.acceptance as string[] | undefined,
            notes: t.notes as string[] | undefined,
            description: t.description as string | undefined,
          }),
          role: (t.role as string) || "backend",
          priority: (t.priority as number) ?? 0,
          status: "TODO",
          dependsOn: deps,
          dependsOnCompleted: deps.length === 0,
          claimedBy: null,
          claimedAt: null,
          scope: (t.scope as string[]) || [],
          comment: (t.context as string) || "",
          prUrl: "",
          hasPmFeedback: false,
          createdAt: now,
          updatedAt: now,
        };
        // Always use the resolved project (Firestore doc ID from MARBLO_PROJECT env)
        // Ignore per-task project_id overrides — they cause ID mismatch with the board
        data.projectId = project;
        data.contextId = resolveContextForWrite();
        const missionContextError = applyMissionContextTags(data);
        if (missionContextError) {
          results.push(
            `  [FAILED] ${
              (t.title as string) || `task #${i}`
            } — ${missionContextError}`,
          );
          continue;
        }

        try {
          const ref = await addDoc(collection(db, "tasks"), data);
          indexToId[i] = ref.id;
          results.push(
            `  [${ref.id}] ${data.title} (role=${data.role}, priority=${data.priority})`,
          );
          successCount++;
        } catch (e: unknown) {
          results.push(
            `  [FAILED] ${(t.title as string) || `task #${i}`} — ${
              (e as Error).message
            }`,
          );
        }
      }

      const depMappings: string[] = [];
      for (const [label, idx] of Object.entries(aliasMap)) {
        if (idx in indexToId)
          depMappings.push(`    ${label} -> ${indexToId[idx]}`);
      }

      let output = `Created ${successCount}/${
        taskList.length
      } tasks:\n${results.join("\n")}`;
      if (depMappings.length > 0)
        output += `\n\nDependency ID mappings:\n${depMappings.join("\n")}`;
      return text(output);
    },
  );

  // 5. claim_task
  auditedTool(
    "claim_task",
    "Claim a specific task by ID. The task must be in TODO status with dependencies met.",
    {
      task_id: z.string().describe("Task ID to claim"),
      agent_id: z.string().describe("ID of the agent claiming the task"),
    },
    async ({ task_id, agent_id }) => {
      const task = await fetchTask(task_id);
      if (!task) return text(`Error: Task ${task_id} not found.`);

      if (task.status !== "TODO") {
        return text(
          "Error: Task is not available for claiming (not in TODO status).",
        );
      }

      if (task.claimedBy) {
        return text(
          `Error: Task is not available for claiming (already claimed by ${task.claimedBy}).`,
        );
      }

      if (!task.dependsOnCompleted) {
        return text("Error: Task dependencies are not yet met.");
      }

      // Status update + Firestore projection in one transaction (Layer A).
      // Spec: docs/specs/2026-05-28-orch-live-awareness-design.md §13.3
      await applyProjection(db, task_id, {
        newStatus: "CLAIMED",
        lastAgentId: agent_id,
        lastActivitySummary: `claimed by ${agent_id}`,
        extraTaskFields: { claimedBy: agent_id, claimedAt: Timestamp.now() },
        // Re-check inside the transaction — closes the claim race the
        // outside-the-txn `task.status !== "TODO"` check above can't.
        validateFrom: (s) => s === "TODO",
        validateTask: (t) => t.claimedBy == null,
      });

      const lines = [
        `Successfully claimed task: ${task.title}`,
        `ID: ${task_id}`,
        `Status: CLAIMED`,
        `Role: ${task.role}`,
      ];
      if (task.comment) lines.push(`Context: ${task.comment}`);
      if (task.scope?.length)
        lines.push(`Scope (files): ${task.scope.join(", ")}`);
      return text(lines.join("\n"));
    },
  );

  // 6. update_task_status
  auditedTool(
    "update_task_status",
    "Update a task status. Valid: TODO, CLAIMED, IN_PROGRESS, REVIEW, BLOCKED, FAILED, DONE. State machine rules enforced. Use force=true to skip validation (e.g., marking already-completed tasks as DONE).",
    {
      task_id: z.string().describe("Task ID"),
      status: z.string().describe("New status"),
      comment: z.string().optional().describe("Comment for the status change"),
      force: z
        .boolean()
        .optional()
        .describe("Skip state machine validation (default: false)"),
    },
    async ({ task_id, status, comment, force }) => {
      const task = await fetchTask(task_id);
      if (!task) return text(`Error: Task ${task_id} not found.`);

      const newStatus = status as TaskStatus;
      if (!force && !canTransition(task.status, newStatus)) {
        const validTargets = VALID_TRANSITIONS[task.status] ?? [];
        return text(
          `Error: Cannot transition from ${
            task.status
          } to ${newStatus}. Valid targets: ${validTargets.join(
            ", ",
          )}\nTip: Use force=true to skip validation.`,
        );
      }

      // Status update + Firestore projection in one transaction (Layer A).
      // Spec: docs/specs/2026-05-28-orch-live-awareness-design.md §13.3
      const projMut: ApplyProjectionInput = {
        newStatus,
        // 오케가 대신 상태를 바꿔도 작업자 귀속은 직전 실제 작업자를 보존
        // ("" → applyProjection 의 `|| prev`). 부하분산 오인 방지.
        lastAgentId: WORKER_AGENT_ID,
        lastActivitySummary: comment || `status → ${newStatus}`,
        // Re-validate the transition inside the txn against the real status —
        // but force=true is the documented escape hatch, so it must skip the
        // in-txn re-check too. Leaving validateFrom undefined turns
        // applyProjection's TOCTOU guard into a no-op, mirroring the outer
        // `!force` gate above. Previously this predicate was set unconditionally,
        // so force=true cleared the outer check yet still threw inside the
        // transaction (projection.ts) — the escape hatch was effectively dead.
        validateFrom: force ? undefined : (s) => canTransition(s, newStatus),
      };
      if (comment) projMut.extraTaskFields = { comment };
      if (newStatus === "BLOCKED")
        projMut.blockerSummary = comment || "blocked";
      await applyProjection(db, task_id, projMut);

      // Signal agent is now free when task leaves active work state
      const doneStatuses = ["DONE", "REVIEW", "BLOCKED", "FAILED"];
      if (doneStatuses.includes(newStatus) && MARBLO_AGENT_ID) {
        const bridgePort = process.env.MARBLO_BRIDGE_PORT;
        if (bridgePort) {
          fetch(`http://127.0.0.1:${bridgePort}/set-agent-status`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agentId: MARBLO_AGENT_ID, status: "idle" }),
          }).catch(() => {});
        }
      }

      // Notify orchestrator about status change. Lane tasks are silent on
      // progress (P4): their update_status is a board-card + Firestore-activity
      // event only — never an orch PTY wake — so the board orch isn't flooded
      // with Quick Lane churn. Only submit_for_review routes a lane to the orch
      // (the final review gate). board/mission progress is unaffected.
      if (!isLaneContextId(task.contextId)) {
        const commentNote = comment ? ` — ${comment}` : "";
        const roleLabel = formatAgentTaskRoleLabel(
          task.role,
          await fetchAgentRole(MARBLO_AGENT_ID),
        );
        notifyOrchestrator(
          `[Task Update] "${task.title}" ${task.status} → ${newStatus} (${roleLabel}, id=${task_id})${commentNote}`,
          task.contextId,
        );
      }

      // ── Inline dependency resolution (atomic, idempotent — N4) ──
      // When a task completes, resolve every task that depends on it. The
      // per-dependent flip (dependsOnCompleted -> true) runs inside a
      // transaction (resolveDependentIfReady) that re-checks the flag and all
      // upstream statuses atomically, so two dependencies completing
      // concurrently cannot both observe a stale false and double-notify the
      // orchestrator (-> duplicate dispatch of the same task). Each dependent
      // is isolated in its own try/catch so one transient failure does not
      // strand the rest. notify fires only for the transaction that actually
      // performed the flip -> exactly once per unblocked task.
      let unblocked = 0;
      if (newStatus === "DONE") {
        let depDocs: Array<{ id: string }> = [];
        try {
          const depQ = query(
            collection(db, "tasks"),
            where("dependsOn", "array-contains", task_id),
          );
          depDocs = (await getDocs(depQ)).docs;
        } catch (err) {
          console.error("[MCP] Dependency query error:", err);
        }

        for (const depDoc of depDocs) {
          try {
            const res = await resolveDependentIfReady(db, depDoc.id, task_id);
            if (res.unblocked) {
              unblocked++;
              // Notify orchestrator about newly unblocked task. Scope to the
              // completed task's context — a mission's dependents share its
              // contextId, so this routes to the same (mission/board) orch.
              // Lane dependents stay silent (P4): a Quick Lane's readiness is
              // not an orch wake event — board orch picks lane work up via the
              // board card, not a PTY inject.
              if (!isLaneContextId(task.contextId)) {
                notifyOrchestrator(
                  `[Dependency Resolved] "${res.title}" is now ready (all dependencies met, id=${depDoc.id}, role=${res.role})`,
                  task.contextId,
                );
              }
            }
          } catch (err) {
            console.error(
              `[MCP] Dependency resolution error for ${depDoc.id}:`,
              err,
            );
          }
        }
      }

      const unblockedNote =
        unblocked > 0 ? ` Unblocked ${unblocked} dependent task(s).` : "";
      return text(
        `Task '${task.title}' status updated to ${newStatus}.${unblockedNote}`,
      );
    },
  );

  // 7. add_activity
  auditedTool(
    "add_activity",
    "Add an activity log entry to a task. Use to record work progress, decisions, or events. Also notifies the orchestrator PTY.",
    {
      task_id: z.string().describe("Task ID"),
      message: z.string().describe("Activity message"),
      agent_id: z.string().optional().describe("Agent ID"),
    },
    async ({ task_id, message, agent_id }) => {
      const task = await fetchTask(task_id);
      if (!task) return text(`Error: Task ${task_id} not found.`);

      // Fall back to the MARBLO_AGENT_ID env var (injected by Marblo when
      // the MCP server is spawned for an agent) before "unknown". The
      // Agents tab Activity feed filters by `agentId in [our agents]`, so
      // logging "unknown" makes the activity invisible.
      const resolvedAgentId = agent_id || MARBLO_AGENT_ID;
      // Activity doc + Firestore projection (lastActivity*) in one transaction.
      // No status change. Spec: docs/specs/2026-05-28-orch-live-awareness-design.md §13.3
      // 작업자 귀속(lastAgentId)에는 오케/unknown 을 빼서(workerAgentId) 직전
      // 실제 작업자를 보존하되, activity 로그 자체의 agentId 는 누가 남겼는지
      // 보여주려 resolvedAgentId 그대로 유지한다.
      await applyProjection(db, task_id, {
        lastAgentId: workerAgentId(resolvedAgentId),
        lastActivitySummary: message,
        activityPayload: { agentId: resolvedAgentId, message },
      });

      // Lane activity is silent on the orch PTY (P4) — the comment lives on the
      // board card + Firestore activity stream only. board/mission unchanged.
      if (!isLaneContextId(task.contextId)) {
        const preview =
          message.length > 300 ? `${message.slice(0, 300)}...` : message;
        const roleLabel = formatAgentTaskRoleLabel(
          task.role,
          await fetchAgentRole(resolvedAgentId),
        );
        notifyOrchestrator(
          `[Task Activity] "${task.title}" progress update (${roleLabel}, id=${task_id}, agent=${resolvedAgentId}): ${preview}`,
          task.contextId,
        );
      }
      return text(`Activity logged: ${message}`);
    },
  );

  // 8. submit_for_review
  auditedTool(
    "submit_for_review",
    "Submit a task for review. Moves the task to REVIEW status.",
    {
      task_id: z.string().describe("Task ID"),
      pr_url: z.string().optional().describe("Pull request URL"),
    },
    async ({ task_id, pr_url }) => {
      const task = await fetchTask(task_id);
      if (!task) return text(`Error: Task ${task_id} not found.`);

      // Allow submit from any pre-DONE status (auto-skip intermediate states)
      if (task.status === "DONE") {
        return text(`Task '${task.title}' is already DONE.`);
      }

      // Status → REVIEW + milestone + Firestore projection in one transaction.
      // Spec: docs/specs/2026-05-28-orch-live-awareness-design.md §13.3
      const projMut: ApplyProjectionInput = {
        newStatus: "REVIEW",
        lastAgentId: WORKER_AGENT_ID,
        lastActivitySummary: pr_url
          ? `submitted for review — ${pr_url}`
          : "submitted for review",
        appendMilestone: true,
        // submit auto-claims from any non-terminal state (incl. TODO), so the
        // guard only blocks an already-DONE task — mirrors the check above,
        // re-checked inside the txn to close the race.
        validateFrom: (s) => s !== "DONE",
      };
      const extra: Record<string, unknown> = {};
      if (pr_url) extra.prUrl = pr_url;
      // Auto-claim if the task was never claimed — but never to the
      // orchestrator's shared id (WORKER_AGENT_ID is "" for orchestrator),
      // else the board shows the orch as assignee for every task it submits
      // on a worker's behalf and load-balancing reads it as overload.
      if (!task.claimedBy && WORKER_AGENT_ID) {
        extra.claimedBy = WORKER_AGENT_ID;
        extra.claimedAt = Timestamp.now();
      }
      if (Object.keys(extra).length) projMut.extraTaskFields = extra;
      await applyProjection(db, task_id, projMut);

      // Signal agent is now free
      if (MARBLO_AGENT_ID) {
        const bridgePort = process.env.MARBLO_BRIDGE_PORT;
        if (bridgePort) {
          fetch(`http://127.0.0.1:${bridgePort}/set-agent-status`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agentId: MARBLO_AGENT_ID, status: "idle" }),
          }).catch(() => {});
        }
      }

      // Notify orchestrator about review submission. UNCONDITIONAL across all
      // contexts — this is the single orch wake a lane task gets (its final
      // verification gate), and board/mission always notify on review too. The
      // bridge routes lane(contextId=lane:*) and board here to the BOARD orch
      // (resolveNotifyTarget); missions go to the mission orch. Do NOT add a
      // lane gate here — that would silence the lane review gate entirely.
      const prNote = pr_url ? ` PR: ${pr_url}` : "";
      const roleLabel = formatAgentTaskRoleLabel(
        task.role,
        await fetchAgentRole(MARBLO_AGENT_ID),
      );
      notifyOrchestrator(
        `[Review Submitted] "${task.title}" is ready for review (${roleLabel}, id=${task_id})${prNote}`,
        task.contextId,
      );

      return text(`Task '${task.title}' submitted for review. Status: REVIEW`);
    },
  );

  // 9. get_task_dependencies
  auditedTool(
    "get_task_dependencies",
    "Check dependency status for a task. Shows which dependent tasks are completed and which are pending.",
    {
      task_id: z.string().describe("Task ID"),
    },
    async ({ task_id }) => {
      const task = await fetchTask(task_id);
      if (!task) return text(`Error: Task ${task_id} not found.`);

      if (!task.dependsOn || task.dependsOn.length === 0) {
        return text("This task has no dependencies.");
      }

      const details: string[] = [];
      let allCompleted = true;

      for (const depId of task.dependsOn) {
        const dep = await fetchTask(depId);
        if (!dep) {
          details.push(`- [unknown] (ID: ${depId} — not found)`);
          allCompleted = false;
        } else {
          const completed = dep.status === "DONE";
          if (!completed) allCompleted = false;
          details.push(
            `- [${completed ? "done" : "pending"}] ${dep.title} (${dep.status})`,
          );
        }
      }

      return text(`All completed: ${allCompleted}\n${details.join("\n")}`);
    },
    { userFacing: false },
  );

  // 10. get_agent_skill
  auditedTool(
    "get_agent_skill",
    "Get skill/instruction file for a given agent role. Available: backend, frontend, test, devops, merge, team_leader, flutter.",
    {
      role: z.string().describe("Agent role name"),
    },
    async ({ role }) => {
      const safeRole = role.replace(/[^a-zA-Z0-9_]/g, "");
      if (!safeRole || safeRole !== role) {
        return text(
          `Error: Invalid role name '${role}'. Use alphanumeric and underscore only.`,
        );
      }

      const skillsDir = path.resolve(SKILLS_DIR);
      for (const filename of [`${safeRole}_agent.md`, `${safeRole}.md`]) {
        const filePath = path.resolve(skillsDir, filename);
        if (!filePath.startsWith(skillsDir)) continue; // path traversal guard
        if (fs.existsSync(filePath)) {
          return text(fs.readFileSync(filePath, "utf-8"));
        }
      }

      return text(`Error: No skill file found for role '${role}'.`);
    },
    { userFacing: false },
  );

  // 11. get_task_activities
  auditedTool(
    "get_task_activities",
    "Get activity log entries for a task. Set pm_only=true to see only PM feedback.",
    {
      task_id: z.string().describe("Task ID"),
      pm_only: z
        .boolean()
        .optional()
        .default(false)
        .describe("Show only PM feedback"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Max entries (default 30)"),
    },
    async ({ task_id, pm_only, limit }) => {
      const task = await fetchTask(task_id);
      if (!task) return text(`Error: Task ${task_id} not found.`);

      const constraints: QueryConstraint[] = [where("taskId", "==", task_id)];
      if (pm_only) constraints.push(where("type", "==", "pm"));

      const q = query(collection(db, "activities"), ...constraints);
      const snap = await getDocs(q);

      if (snap.empty)
        return text(pm_only ? "No PM feedback found." : "No activities found.");

      const lines = snap.docs.map((d) => {
        const a = d.data();
        const ts = a.createdAt?.toDate?.()?.toISOString?.() || "unknown";
        const agent = a.agentId || "system";
        return `[${ts}] ${agent}: ${a.message}`;
      });
      return text(
        capLines(lines, limit ?? 30, "raise limit for older entries"),
      );
    },
    { userFacing: false },
  );

  // 12. check_feedback
  auditedTool(
    "check_feedback",
    "Check for tasks that have unread PM feedback. Filter by role and optionally by project.",
    {
      role: z.string().describe("Agent role (backend/frontend/test/devops)"),
      project_id: z.string().optional().describe("Project ID"),
    },
    async ({ role, project_id }) => {
      const projectId = resolveProject(project_id);
      const constraints: QueryConstraint[] = [
        where("role", "==", role),
        where("hasPmFeedback", "==", true),
      ];
      if (projectId) constraints.push(where("projectId", "==", projectId));

      const q = query(collection(db, "tasks"), ...constraints);
      const snap = await getDocs(q);

      if (snap.empty)
        return text(`No tasks with pending PM feedback for role '${role}'.`);

      const lines = [`Tasks with PM feedback (${snap.size}):`];
      snap.docs.forEach((d) => {
        const t = d.data();
        lines.push(
          `- [${d.id}] ${t.title} (status=${t.status}, priority=${t.priority})`,
        );
      });
      return text(lines.join("\n"));
    },
    { userFacing: false },
  );

  // 13. acknowledge_feedback
  auditedTool(
    "acknowledge_feedback",
    "Mark PM feedback as read/acknowledged for a task. Clears the feedback badge.",
    {
      task_id: z.string().describe("Task ID"),
    },
    async ({ task_id }) => {
      const task = await fetchTask(task_id);
      if (!task) return text(`Error: Task ${task_id} not found.`);

      await updateDoc(doc(db, "tasks", task_id), {
        hasPmFeedback: false,
        updatedAt: Timestamp.now(),
      });
      return text(
        `Feedback acknowledged for task '${task.title}'. Badge cleared.`,
      );
    },
  );

  // 15. spawn_agent — HTTP bridge to Electron AgentManager
  auditedTool(
    "spawn_agent",
    "Spawn a new agent via the Electron bridge. The agent gets its own PTY session and terminal tab. Requires MARBLO_BRIDGE_PORT env var.",
    {
      name: z.string().describe('Agent display name (e.g., "backend-auth")'),
      model: z
        .enum(["claude", "codex", "gpt", "antigravity", "local", "custom"])
        .describe(
          "AI model to use. 'codex' and 'gpt' are the same OpenAI Codex CLI " +
            "(there is no separate 'gpt' CLI) — both spawn the `codex` binary. " +
            "Fleet: claude (Claude Code) / codex (OpenAI Codex) / antigravity (agy).",
        ),
      role: z.string().describe("Agent role (backend/frontend/test/devops)"),
      command: z
        .string()
        .optional()
        .describe("CLI command override (default: auto-detected from model)"),
      cwd: z
        .string()
        .optional()
        .describe("Working directory (default: project root)"),
      initial_prompt: z
        .string()
        .optional()
        .describe("Initial prompt to send to the agent after boot"),
      task_id: z
        .string()
        .optional()
        .describe(
          "Marblo task ID for completion reporting. When provided, the bridge appends the same completion protocol used by dispatch_task.",
        ),
    },
    async ({
      name,
      model: rawModel,
      role,
      command,
      cwd,
      initial_prompt,
      task_id,
    }) => {
      // "codex" is the user-facing name for the Codex CLI; the internal
      // ModelType is "gpt". Fold it here so the Firestore agent doc and the
      // renderer's Record<ModelType> icon maps stay consistent. (The bridge
      // also normalizes, but the doc is written from this var.)
      const model = rawModel === "codex" ? "gpt" : rawModel;
      const bridgePort = process.env.MARBLO_BRIDGE_PORT;
      if (!bridgePort) {
        return text(
          "Error: MARBLO_BRIDGE_PORT not set. Bridge server not available.",
        );
      }

      try {
        const body = JSON.stringify({
          name,
          model,
          role,
          command,
          cwd,
          initialPrompt: initial_prompt,
          taskId: task_id,
          // Forward MARBLO_PROJECT so bridge scopes the new agent to the
          // correct window in multi-window mode.
          projectId: process.env.MARBLO_PROJECT || "",
          // Forward MARBLO_AGENT_ID so bridge can fall back to the parent
          // agent's project / owner when projectId is empty (e.g., when
          // an external Claude Code session calls Marblo MCP without a
          // project context).
          parentAgentId: process.env.MARBLO_AGENT_ID || "",
          contextId: process.env.MARBLO_CONTEXT || "",
        });

        const response = await fetch(
          `http://127.0.0.1:${bridgePort}/spawn-agent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          },
        );

        const result = (await response.json()) as {
          success: boolean;
          agentId?: string;
          ptySessionId?: string;
          error?: string;
          // Board task the bridge bound the agent to — the supplied task_id, or
          // an ad-hoc task the WorktreeCoordinator created when none was given.
          taskId?: string | null;
        };

        if (!result.success) {
          return text(
            `Error spawning agent: ${result.error || "Unknown error"}`,
          );
        }

        // Write agent document to Firestore so it appears in Agents tab.
        // Use setDoc(...,{merge:true}) with the bridge's agentId as the
        // doc id so this write is idempotent — the renderer's
        // onAgentSpawned listener also writes the same doc, both writers
        // converge on the same id without creating duplicates.
        const projectId = resolveProject(undefined);
        if (projectId && result.agentId) {
          await setDoc(
            doc(db, "agents", result.agentId),
            {
              projectId,
              ownerId: "orchestrator",
              name,
              model,
              role,
              status: "idle",
              // Link the agent to its board task — the supplied task_id, or the
              // ad-hoc worktree task the bridge auto-created (result.taskId).
              currentTaskId: result.taskId ?? task_id ?? null,
              command: command || model,
              skillFile: "",
              createdAt: Timestamp.now(),
            },
            { merge: true },
          );
        }

        return text(
          `Agent spawned successfully!\n` +
            `  Name: ${name}\n` +
            `  Model: ${model}\n` +
            `  Role: ${role}\n` +
            `  Agent ID: ${result.agentId}\n` +
            `  PTY Session: ${result.ptySessionId}`,
        );
      } catch (err: unknown) {
        return text(
          `Error: Failed to reach bridge server — ${(err as Error).message}`,
        );
      }
    },
  );

  // 14. search_tasks (bonus)
  auditedTool(
    "search_tasks",
    "Search tasks by keyword in title or description. Optionally filter by project.",
    {
      keyword: z.string().describe("Search keyword"),
      project_id: z.string().optional().describe("Project ID"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Max rows (default 50)"),
    },
    async ({ keyword, project_id, limit }) => {
      const projectId = resolveProject(project_id);
      const constraints: QueryConstraint[] = [];
      if (projectId) constraints.push(where("projectId", "==", projectId));

      const q = query(collection(db, "tasks"), ...constraints);
      const snap = await getDocs(q);

      const lowerKeyword = keyword.toLowerCase();
      const matches = snap.docs.filter((d) => {
        const t = d.data();
        return (
          t.title?.toLowerCase().includes(lowerKeyword) ||
          t.description?.toLowerCase().includes(lowerKeyword)
        );
      });

      if (matches.length === 0)
        return text(`No tasks found matching '${keyword}'.`);

      const taskLines = matches.map((d) => {
        const t = d.data();
        return `- [${t.status}] ${truncTitle(t.title)} (role=${t.role}, id=${d.id})`;
      });
      const body = capLines(
        taskLines,
        limit ?? LIST_LIMIT_DEFAULT,
        "narrow the keyword or raise limit",
      );
      return text(
        `Found ${matches.length} task(s) matching '${keyword}':\n${body}`,
      );
    },
    { userFacing: false },
  );

  // 16. get_task — Get single task detail (including description)
  auditedTool(
    "get_task",
    "Get full details of a single task by ID, including description, scope, dependencies, and comments.",
    {
      task_id: z.string().describe("Task ID"),
    },
    async ({ task_id }) => {
      const task = await fetchTask(task_id);
      if (!task) return text(`Error: Task ${task_id} not found.`);

      const lines = [
        `ID: ${task.id}`,
        `Title: ${task.title}`,
        `Status: ${task.status}`,
        `Role: ${task.role}`,
        `Priority: ${task.priority}`,
        `Description: ${task.description || "(empty)"}`,
        `Claimed by: ${task.claimedBy || "(none)"}`,
        `Depends on: ${
          task.dependsOn?.length ? task.dependsOn.join(", ") : "(none)"
        }`,
        `Dependencies met: ${task.dependsOnCompleted}`,
        `Scope: ${task.scope?.length ? task.scope.join(", ") : "(none)"}`,
        `Comment: ${task.comment || "(none)"}`,
        `PR URL: ${task.prUrl || "(none)"}`,
        `Has PM feedback: ${task.hasPmFeedback}`,
      ];
      return text(lines.join("\n"));
    },
    { userFacing: false },
  );

  // 16b. get_projection — Layer A read path. Lets the orchestrator answer
  // "what's happening now?" with a single read instead of waking an LLM.
  // Spec: docs/specs/2026-05-28-orch-live-awareness-design.md §13.3, §7
  auditedTool(
    "get_projection",
    "Get the live projection snapshot for a task (current status, last agent/activity, milestones passed, blocker) and/or a mission (per-status task counts). Read-only; reflects the latest MCP tool call without waking an LLM.",
    {
      task_id: z
        .string()
        .optional()
        .describe(
          "Task ID — returns the task projection (and its mission rollup)",
        ),
      mission_id: z
        .string()
        .optional()
        .describe("Mission ID — returns the mission's per-status task counts"),
    },
    async ({ task_id, mission_id }) => {
      if (!task_id && !mission_id) {
        return text("Error: provide task_id and/or mission_id.");
      }
      const lines: string[] = [];
      let missionId = mission_id;

      if (task_id) {
        const snap = await getDoc(doc(db, "tasks", task_id));
        if (!snap.exists()) return text(`Error: Task ${task_id} not found.`);
        const data = snap.data() as {
          title?: string;
          status?: string;
          missionId?: string;
          projection?: {
            currentStatus?: string;
            lastAgentId?: string;
            lastActivityAt?: Timestamp;
            lastActivitySummary?: string;
            milestonesPassed?: string[];
            blockerSummary?: string;
          };
        };
        missionId = missionId || data.missionId;
        const p = data.projection;
        if (!p) {
          lines.push(
            `Task ${task_id} ("${
              data.title ?? ""
            }") has no projection yet (status=${
              data.status ?? "?"
            }); it updates on the next MCP tool call.`,
          );
        } else {
          const when =
            p.lastActivityAt?.toDate?.().toISOString?.() ?? "(unknown)";
          lines.push(
            `Task: ${data.title ?? task_id} (id=${task_id})`,
            `Current status: ${p.currentStatus ?? data.status ?? "?"}`,
            `Last agent: ${p.lastAgentId || "(none)"}`,
            `Last activity: ${p.lastActivitySummary || "(none)"} @ ${when}`,
            `Milestones passed: ${
              p.milestonesPassed?.length
                ? p.milestonesPassed.join(", ")
                : "(none)"
            }`,
          );
          if (p.blockerSummary) lines.push(`Blocker: ${p.blockerSummary}`);
        }
      }

      if (missionId) {
        const mSnap = await getDoc(doc(db, "missions", missionId));
        if (mSnap.exists()) {
          const mp = (
            mSnap.data() as {
              projection?: { statusCounts?: Record<string, number> };
            }
          ).projection;
          const counts = mp?.statusCounts
            ? Object.entries(mp.statusCounts)
                .filter(([, n]) => n > 0)
                .map(([s, n]) => `${s}=${n}`)
                .join(", ")
            : "";
          lines.push(`Mission ${missionId} task counts: ${counts || "(none)"}`);
        } else {
          lines.push(`Mission ${missionId} not found.`);
        }
      }

      return text(lines.join("\n"));
    },
    { userFacing: false },
  );

  // 17. get_agents — Real-time agent list (Bridge first, Firestore fallback)
  auditedTool(
    "get_agents",
    "Get all agents with real-time status from AgentManager. Falls back to Firestore if bridge is unavailable.",
    {
      project_id: z
        .string()
        .optional()
        .describe("Project ID (only used for Firestore fallback)"),
    },
    async ({ project_id }) => {
      const bridgePort = process.env.MARBLO_BRIDGE_PORT;

      // Try Bridge first — real-time data from AgentManager. Pass our
      // project so multi-window mode returns only this project's agents.
      if (bridgePort) {
        try {
          const projectId = process.env.MARBLO_PROJECT || "";
          const url = projectId
            ? `http://127.0.0.1:${bridgePort}/agents?projectId=${encodeURIComponent(
                projectId,
              )}`
            : `http://127.0.0.1:${bridgePort}/agents`;
          const response = await fetch(url);
          const data = (await response.json()) as {
            agents: Array<{
              id: string;
              name: string;
              model: string;
              role: string;
              status: string;
              ptySessionId: string;
              restartCount: number;
            }>;
          };

          if (data.agents.length === 0) return text("No agents found.");

          const lines = data.agents.map((a) => {
            const restart =
              a.restartCount > 0 ? ` restarts=${a.restartCount}` : "";
            return `- [${a.status}] ${a.name} (model=${a.model}, role=${a.role}, id=${a.id}${restart})`;
          });
          return text(
            `Agents (${data.agents.length}, real-time):\n${capLines(
              lines,
              LIST_LIMIT_DEFAULT,
              "many agents — cleanup idle ones",
            )}`,
          );
        } catch {
          // Bridge unavailable — fall through to Firestore
        }
      }

      // Firestore fallback
      const projectId = resolveProject(project_id);
      const constraints: QueryConstraint[] = [];
      if (projectId) constraints.push(where("projectId", "==", projectId));

      const q = query(collection(db, "agents"), ...constraints);
      const snap = await getDocs(q);

      if (snap.empty) return text("No agents found.");

      const lines = snap.docs.map((d) => {
        const a = d.data();
        const statusInfo = normalizeFirestoreFallbackAgentStatus(a.status);
        const task =
          !statusInfo.staleActive && a.currentTaskId
            ? ` → task=${a.currentTaskId}`
            : "";
        const stale = statusInfo.staleActive
          ? ` stale=${String(a.status)}`
          : "";
        return `- [${statusInfo.status}] ${a.name} (model=${a.model}, role=${a.role}, id=${d.id}${stale})${task}`;
      });
      return text(
        `Agents (${snap.size}, Firestore fallback):\n${capLines(
          lines,
          LIST_LIMIT_DEFAULT,
          "many agents — cleanup idle ones",
        )}`,
      );
    },
    { userFacing: false },
  );

  // ── reuse_agent — Send a new instruction to an existing idle agent
  auditedTool(
    "reuse_agent",
    "Send a new task instruction to an existing idle agent via its PTY session. Use this BEFORE spawn_agent to check if an idle agent with the matching role already exists. The agent will receive the message in its terminal stdin.",
    {
      agent_name: z.string().describe("Name of the existing agent to reuse"),
      instruction: z
        .string()
        .describe("New instruction/task to send to the agent"),
      task_id: z
        .string()
        .optional()
        .describe(
          "Marblo task ID to bind to the reused agent. When set, the task's " +
            "claimedBy is rebound to this agent (mirrors dispatch_task) so the " +
            "board shows the REAL worker immediately instead of a stale assignee.",
        ),
    },
    async ({ agent_name, instruction, task_id }) => {
      const bridgePort = process.env.MARBLO_BRIDGE_PORT;
      if (!bridgePort) {
        return text(
          "Error: MARBLO_BRIDGE_PORT not set. Bridge server not available.",
        );
      }

      try {
        const response = await fetch(
          `http://127.0.0.1:${bridgePort}/reuse-agent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              agentName: agent_name,
              instruction,
              taskId: task_id || "",
              projectId: process.env.MARBLO_PROJECT || "",
              contextId: process.env.MARBLO_CONTEXT || "",
            }),
          },
        );

        const result = (await response.json()) as {
          success: boolean;
          agentId?: string;
          error?: string;
        };

        if (!result.success) {
          return text(
            `Cannot reuse agent '${agent_name}': ${
              result.error || "Unknown error"
            }. Consider using spawn_agent instead.`,
          );
        }

        // Bind the board task to the reused agent so the kanban shows the REAL
        // worker immediately — and overwrite any stale claimedBy left by a
        // previous owner. Without this, reuse_agent only nudged the PTY and the
        // task's claimedBy stayed pinned to whoever last auto-claimed it, so the
        // board showed the wrong/uniform assignee until the agent happened to
        // call update_task_status. Same pattern as dispatch_task's task binding.
        if (result.agentId && task_id) {
          try {
            await updateDoc(doc(db, "tasks", task_id), {
              claimedBy: result.agentId,
              claimedAt: Timestamp.now(),
            });
          } catch (err) {
            // Non-fatal — the instruction is already delivered; the board just
            // keeps showing the stale assignee. Surface for diagnosis.
            console.error("[reuse_agent] Failed to bind task claimedBy:", err);
          }
        }

        return text(
          `Instruction sent to existing agent '${agent_name}'.\n` +
            `  Agent ID: ${result.agentId}\n` +
            (task_id ? `  Bound task: ${task_id}\n` : "") +
            `  Instruction: ${instruction.slice(0, 100)}${
              instruction.length > 100 ? "..." : ""
            }`,
        );
      } catch (err: unknown) {
        return text(
          `Error: Failed to reach bridge server — ${(err as Error).message}`,
        );
      }
    },
  );

  // ── dispatch_task — Smart agent dispatch (reuse/restart/spawn/logical)
  auditedTool(
    "dispatch_task",
    "Smart agent dispatch: automatically decides whether to reuse an idle agent, restart a stopped one, spawn a new one, or recommend a logical (internal) sub-agent. Preferred over manual spawn_agent/reuse_agent calls.",
    {
      role: z.string().describe("Agent role (backend/frontend/test/devops)"),
      instruction: z.string().describe("Instruction to send to the agent"),
      task_id: z.string().optional().describe("Marblo task ID for tracking"),
      complexity: z
        .enum(["simple", "standard", "complex"])
        .optional()
        .describe(
          "Task difficulty — also picks the agent model tier (cost/quality). " +
            "'simple' = internal sub-agent + cheaper model; 'standard' (default) = " +
            "top model (claude opus / gpt-5.5 medium); 'complex' = physical agent + " +
            "top reasoning (claude opus / gpt-5.5 high). Set per task difficulty.",
        ),
      model: z
        .string()
        .optional()
        .describe(
          "Preferred model hint (claude/codex/antigravity). 'codex' and 'gpt' " +
            "both map to the OpenAI Codex CLI. When set, this model is forced " +
            "over tag scoring.",
        ),
      name: z.string().optional().describe("Agent name hint"),
      cwd: z.string().optional().describe("Working directory"),
      tags: z
        .array(z.string())
        .optional()
        .describe(
          "Task tags for model scoring (e.g., architecture, research, simple-fix)",
        ),
      mix: z
        .enum(["cross-check", "split-role"])
        .optional()
        .describe(
          "★complex 전용 opt-in 모델 믹스(기본 off). 발동 시 Claude 최상위 + Codex " +
            "high 2-spawn. 'cross-check'(기본)=교차검증, 'split-role'=역할분담. " +
            "complexity!=='complex' 면 무시됨. 비용 2배(슬롯 2)이므로 정확성이 " +
            "중요한 설계/보안/마이그레이션에만.",
        ),
      stages: z
        .array(
          z.object({
            instruction: z.string(),
            complexity: z.enum(["simple", "standard", "complex"]).optional(),
            model: z.string().optional(),
            tags: z.array(z.string()).optional(),
            dependsOnPrevious: z.boolean().optional(),
          }),
        )
        .optional()
        .describe(
          "★complex 전용 opt-in 단계분할(기본 단일). 스텝 배열을 각각 작은 " +
            "dispatch 로 풀어 난도별 모델 매칭(설계→최상위, 기계적→cheap). " +
            "dependsOnPrevious 스텝은 순차, 아니면 병렬. complexity!=='complex' 면 무시됨.",
        ),
      isolate: z
        .boolean()
        .optional()
        .describe(
          "★simple 전용 opt-in 물리스폰(기본 off). 기본은 complexity='simple' 이면 " +
            "logical(오케 내부 서브에이전트)로 단락되는데, true 면 그 단락을 건너뛰고 " +
            "cheap 모델(claude=sonnet, gpt=low)로 격리 worktree 물리 에이전트를 스폰한다. " +
            "격리·병렬이 필요한 저난도 작업용. complexity!=='simple' 면 무시됨.",
        ),
    },
    async ({
      role,
      instruction,
      task_id,
      complexity,
      model,
      name,
      cwd,
      tags,
      mix,
      stages,
      isolate,
    }) => {
      const bridgePort = process.env.MARBLO_BRIDGE_PORT;
      if (!bridgePort) {
        return text(
          "Error: MARBLO_BRIDGE_PORT not set. Bridge server not available.",
        );
      }

      const missionContextId = resolveMissionContextForWrite();
      let dispatchTaskId = task_id;

      if (missionContextId && !dispatchTaskId) {
        const projectId = resolveProject(undefined);
        if (!projectId) {
          return text(
            "Error: No project context. Set MARBLO_PROJECT env var before dispatching a mission task.",
          );
        }

        const now = Timestamp.now();
        const data: Record<string, unknown> = {
          title: name || instruction.split(/\r?\n/, 1)[0].slice(0, 80),
          description: instruction,
          role,
          priority: 3,
          status: "TODO",
          dependsOn: [],
          dependsOnCompleted: true,
          claimedBy: null,
          claimedAt: null,
          scope: tags ?? [],
          comment: `Mission ${missionContextId} (dispatch_task)`,
          prUrl: "",
          hasPmFeedback: false,
          projectId,
          contextId: missionContextId,
          missionId: missionContextId,
          createdAt: now,
          updatedAt: now,
        };

        const missionContextError = applyMissionContextTags(
          data,
          missionContextId,
        );
        if (missionContextError) return text(`Error: ${missionContextError}`);

        const ref = await addDoc(collection(db, "tasks"), data);
        dispatchTaskId = ref.id;
      }

      // Patent claim 4: 매칭점수 산출 단계는 선행 태스크의 존재 여부 및
      // 완료 여부를 먼저 판단하고, 선행이 없거나 완료된 태스크에 대해서만
      // 매칭점수를 산출한다. dispatch_task 가 매칭/스폰 진입점이므로 여기서
      // 명시적으로 dependency gate 를 둔다 — get_available_tasks 의 필터와
      // 별개로, task_id 가 직접 지정된 dispatch 경로(오케스트레이터가 특정
      // 태스크를 콕 집어 배정하는 케이스)에서도 같은 가드가 적용되도록 함.
      if (dispatchTaskId) {
        try {
          const task = await fetchTask(dispatchTaskId);
          if (!task) {
            return text(
              `Error: Task ${dispatchTaskId} not found — refusing to dispatch.`,
            );
          }
          const missionContextError = await ensureTaskMissionContext(
            dispatchTaskId,
            task,
            missionContextId,
          );
          if (missionContextError) return text(`Error: ${missionContextError}`);
          if (!task.dependsOnCompleted) {
            // Mark BLOCKED so it surfaces in the kanban board, then refuse
            // to dispatch. Best-effort — failing to mark is not fatal.
            // Route through applyProjection (not a raw updateDoc) so
            // tasks/{id}.projection.currentStatus AND the mission's
            // statusCounts move together with the real status — a bare
            // updateDoc left both projections stale, so get_projection
            // contradicted the actual BLOCKED status. No validateFrom: this is
            // a forced mark regardless of current status (same intent as the
            // prior raw write), so the in-txn TOCTOU guard stays off.
            try {
              await applyProjection(db, dispatchTaskId, {
                newStatus: "BLOCKED",
                lastAgentId: WORKER_AGENT_ID,
                lastActivitySummary:
                  "dispatch aborted: 선행 태스크 미완료 — BLOCKED",
                blockerSummary: "선행 태스크 미완료 (dependsOn 미충족)",
              });
            } catch (markErr) {
              console.error(
                "[dispatch_task] Failed to mark task BLOCKED:",
                markErr,
              );
            }
            const pending = (task.dependsOn || []).join(", ") || "(unknown)";
            return text(
              `Dispatch aborted (patent claim 4: 선행태스크 미완료): task ${dispatchTaskId} depends on [${pending}], not all complete. Task moved to BLOCKED. Resolve dependencies first, then re-dispatch.`,
            );
          }
        } catch (err) {
          console.error("[dispatch_task] Dependency precheck failed:", err);
          if (missionContextId) {
            return text(
              `Error: Failed to verify mission task tags before dispatch — ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
          // Don't block dispatch on a precheck failure — the bridge / agent
          // path also has its own claim_task gate as defense-in-depth.
        }
      }

      // SPAWN-MODEL-ALLOCATION-V2 §4/§5: mix(모델 믹스)·stages(단계분할)는 complex
      // 전용 opt-in. complexity!=="complex" 면 조용히 삼키지 않고 무시 + 경고 후
      // 단일 디스패치로 진행(기본 동작 무변동). bridge 도 같은 가드를 둔다(방어).
      let effectiveMix = mix;
      let effectiveStages = stages;
      if (complexity !== "complex" && (mix || (stages && stages.length > 0))) {
        console.warn(
          `[dispatch_task] mix/stages ignored — complexity='${
            complexity || "standard"
          }' (complex 전용). 단일 디스패치로 진행.`,
        );
        effectiveMix = undefined;
        effectiveStages = undefined;
      }

      // §B: isolate(simple cheap 물리스폰)는 simple 전용 opt-in. complexity!=="simple"
      // 면 무시 + 경고(조용히 삼키지 않음). bridge 도 같은 가드를 둔다(simple 이 아니면
      // 어차피 logical 단락을 안 타므로 isolate 가 무의미).
      let effectiveIsolate = isolate;
      if (isolate && complexity !== "simple") {
        console.warn(
          `[dispatch_task] isolate ignored — complexity='${
            complexity || "standard"
          }' (simple 전용).`,
        );
        effectiveIsolate = undefined;
      }

      try {
        const response = await fetch(
          `http://127.0.0.1:${bridgePort}/dispatch-task`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              role,
              instruction,
              taskId: dispatchTaskId,
              complexity: complexity || "standard",
              model,
              nameHint: name,
              cwd,
              tags,
              mix: effectiveMix,
              stages: effectiveStages,
              isolate: effectiveIsolate,
              projectId: process.env.MARBLO_PROJECT || "",
              // Forward parent agent id for owner fallback when projectId
              // is empty (external Claude Code → Marblo MCP path).
              parentAgentId: process.env.MARBLO_AGENT_ID || "",
              contextId: process.env.MARBLO_CONTEXT || "",
            }),
          },
        );

        const result = (await response.json()) as {
          success: boolean;
          action?: string;
          agentId?: string;
          agentName?: string;
          agentRole?: string;
          model?: string;
          score?: number;
          reason?: string;
          error?: string;
          // Board task bound to the agent — the supplied task_id, or an ad-hoc
          // task the WorktreeCoordinator created for a spawn without one.
          taskId?: string | null;
          // 모델 믹스(§4) 동반 에이전트 / 단계분할(§5) 스텝 에이전트들.
          companionAgentId?: string;
          stageAgentIds?: string[];
        };

        if (!result.success) {
          return text(`Dispatch failed: ${result.error || "Unknown error"}`);
        }

        // Persist newly-spawned / restarted agents to Firestore so they
        // appear in the Agents tab and survive across sessions. Reuse-only
        // dispatches don't need a new doc — the existing one is reused.
        // Idempotent setDoc(..., {merge:true}) with the bridge's agentId
        // as doc id — the renderer's onAgentSpawned listener also writes
        // the same doc, both converge on a single record.
        if (
          (result.action === "spawned" ||
            result.action === "restarted" ||
            result.action === "mixed") &&
          result.agentId
        ) {
          const projectId = resolveProject(undefined);
          if (projectId) {
            try {
              await setDoc(
                doc(db, "agents", result.agentId),
                {
                  projectId,
                  ownerId: "orchestrator",
                  name: result.agentName || `${role}-agent`,
                  model: result.model || model || "claude",
                  role: result.agentRole || role,
                  status: "working",
                  // Link to the board task — the supplied task_id, or the ad-hoc
                  // worktree task the bridge auto-created (result.taskId).
                  currentTaskId: result.taskId ?? dispatchTaskId ?? null,
                  command: result.model || model || "claude",
                  skillFile: "",
                  createdAt: Timestamp.now(),
                },
                { merge: true },
              );
            } catch (err) {
              // Non-fatal — agent is already running, Firestore just won't
              // show it. Surface in the response so the user can see why.
              console.error("[dispatch_task] Firestore write failed:", err);
            }
          }
        }

        // Bind the board task to the dispatched agent so the kanban shows the
        // REAL worker immediately — and overwrite any stale claimedBy left by a
        // previous (now-dead) agent. Before this, dispatch updated only the
        // agent doc's currentTaskId; the task's claimedBy stayed pinned to the
        // stale agent, so the board showed the wrong assignee and the task
        // looked unstarted until a human reassigned it by hand. The orchestrator
        // no longer auto-claims (see isOrchestratorAgentId / WORKER_AGENT_ID), so
        // the dispatched worker is the correct owner to record here. Applies to
        // every binding action (spawned/restarted/reused/mixed) — not 'logical'
        // (internal sub-agent, no real agent to bind).
        const boundTaskId = result.taskId ?? dispatchTaskId;
        if (result.agentId && boundTaskId && result.action !== "logical") {
          try {
            await updateDoc(doc(db, "tasks", boundTaskId), {
              claimedBy: result.agentId,
              claimedAt: Timestamp.now(),
            });
          } catch (err) {
            // Non-fatal — the agent is already dispatched; the board just keeps
            // showing the stale assignee. Surface for diagnosis.
            console.error(
              "[dispatch_task] Failed to bind task claimedBy:",
              err,
            );
          }
        }

        const lines = [
          `Dispatch: ${result.action}`,
          `  Reason: ${result.reason}`,
        ];
        if (result.agentId) lines.push(`  Agent ID: ${result.agentId}`);
        if (result.agentName) lines.push(`  Agent Name: ${result.agentName}`);
        if (result.agentRole) lines.push(`  Agent Role: ${result.agentRole}`);
        if (result.model) lines.push(`  Model: ${result.model}`);
        if (result.score !== undefined) lines.push(`  Score: ${result.score}`);
        if (dispatchTaskId) lines.push(`  Task ID: ${dispatchTaskId}`);
        if (result.companionAgentId)
          lines.push(`  Mix companion (Codex): ${result.companionAgentId}`);
        if (result.stageAgentIds && result.stageAgentIds.length > 0)
          lines.push(`  Stage agents: ${result.stageAgentIds.join(", ")}`);
        if (result.action === "logical") {
          lines.push(
            `\nAction required: Use internal sub-agent (Task/Agent tool) to handle this simple task directly.`,
          );
        }

        return text(lines.join("\n"));
      } catch (err: unknown) {
        return text(
          `Error: Failed to reach bridge server — ${(err as Error).message}`,
        );
      }
    },
  );

  // ── kill_agent — Stop and remove a specific agent
  auditedTool(
    "kill_agent",
    "Stop a specific agent by name. Use to free resources or remove unnecessary agents.",
    {
      agent_name: z.string().describe("Name of the agent to kill"),
      reason: z.string().optional().describe("Reason for killing the agent"),
    },
    async ({ agent_name, reason }) => {
      const bridgePort = process.env.MARBLO_BRIDGE_PORT;
      if (!bridgePort) {
        return text(
          "Error: MARBLO_BRIDGE_PORT not set. Bridge server not available.",
        );
      }

      try {
        const response = await fetch(
          `http://127.0.0.1:${bridgePort}/kill-agent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agentName: agent_name, reason }),
          },
        );

        const result = (await response.json()) as {
          success: boolean;
          agentId?: string;
          reason?: string;
          error?: string;
        };

        if (!result.success) {
          return text(
            `Failed to kill agent '${agent_name}': ${
              result.error || "Unknown error"
            }`,
          );
        }

        if (result.agentId) {
          await markAgentStoppedInFirestore(result.agentId);
        }

        return text(`${result.reason}`);
      } catch (err: unknown) {
        return text(
          `Error: Failed to reach bridge server — ${(err as Error).message}`,
        );
      }
    },
  );

  // ── cleanup_agents — Batch cleanup of stopped/error agents
  auditedTool(
    "cleanup_agents",
    "Clean up stopped or error-state agents. Optionally filter by role. Returns list of cleaned agents.",
    {
      role: z.string().optional().describe("Only clean agents with this role"),
    },
    async ({ role }) => {
      const bridgePort = process.env.MARBLO_BRIDGE_PORT;
      if (!bridgePort) {
        return text(
          "Error: MARBLO_BRIDGE_PORT not set. Bridge server not available.",
        );
      }

      try {
        // Get real-time agent list scoped to our project (multi-window).
        const projectId = process.env.MARBLO_PROJECT || "";
        const listUrl = projectId
          ? `http://127.0.0.1:${bridgePort}/agents?projectId=${encodeURIComponent(
              projectId,
            )}`
          : `http://127.0.0.1:${bridgePort}/agents`;
        const listResponse = await fetch(listUrl);
        const data = (await listResponse.json()) as {
          agents: Array<{
            id: string;
            name: string;
            model: string;
            role: string;
            status: string;
            contextId?: string;
          }>;
        };

        // Filter candidates for cleanup
        const candidates = data.agents.filter((a) => {
          if (a.status !== "stopped" && a.status !== "error") return false;
          if (role && a.role !== role) return false;
          const currentContext = process.env.MARBLO_CONTEXT || "";
          const currentIsLane = isLaneContextId(currentContext);
          const agentIsLane = isLaneContextId(a.contextId);
          if (currentIsLane) return a.contextId === currentContext;
          if (agentIsLane) return false;
          return true;
        });

        if (candidates.length === 0) {
          const roleNote = role ? ` for role '${role}'` : "";
          return text(
            `No stopped/error agents found${roleNote}. Nothing to clean up.`,
          );
        }

        // Kill each candidate
        const results: string[] = [];
        for (const agent of candidates) {
          try {
            const response = await fetch(
              `http://127.0.0.1:${bridgePort}/kill-agent`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  agentName: agent.name,
                  reason: "cleanup",
                }),
              },
            );
            const result = (await response.json()) as {
              success: boolean;
              agentId?: string;
            };
            if (result.success && result.agentId) {
              await markAgentStoppedInFirestore(result.agentId);
            }
            results.push(`${agent.name} (${agent.status})`);
          } catch {
            results.push(`${agent.name} (failed to kill)`);
          }
        }

        return text(
          `Cleaned up ${results.length} agent(s): ${results.join(", ")}`,
        );
      } catch (err: unknown) {
        return text(
          `Error: Failed to reach bridge server — ${(err as Error).message}`,
        );
      }
    },
  );

  // 17. create_flow — Create a new flow
  auditedTool(
    "create_flow",
    "Create a new flow (pipeline). Nodes and edges are JSON strings matching FlowNode[] and FlowEdge[] types.",
    {
      name: z.string().describe("Flow name"),
      description: z.string().optional().describe("Flow description"),
      nodes: z
        .string()
        .optional()
        .describe("FlowNode[] as JSON string (default: [])"),
      edges: z
        .string()
        .optional()
        .describe("FlowEdge[] as JSON string (default: [])"),
      project_id: z.string().optional().describe("Project ID"),
    },
    async ({ name, description, nodes, edges, project_id }) => {
      const projectId = resolveProject(project_id);

      let parsedNodes: unknown[];
      let parsedEdges: unknown[];
      try {
        parsedNodes = JSON.parse(nodes || "[]");
        parsedEdges = JSON.parse(edges || "[]");
      } catch (e: unknown) {
        return text(`Error: Invalid JSON — ${(e as Error).message}`);
      }

      const now = Timestamp.now();
      const data: Record<string, unknown> = {
        name,
        description: description || "",
        nodes: parsedNodes,
        edges: parsedEdges,
        status: "draft",
        createdBy: "orchestrator",
        createdAt: now,
        updatedAt: now,
      };
      if (projectId) data.projectId = projectId; // flows can be project-less (draft)

      const ref = await addDoc(collection(db, "flows"), data);
      return text(
        `Flow created successfully!\n` +
          `  ID: ${ref.id}\n` +
          `  Name: ${name}\n` +
          `  Nodes: ${parsedNodes.length}\n` +
          `  Edges: ${parsedEdges.length}`,
      );
    },
  );

  // 18. get_flows — List project flows
  auditedTool(
    "get_flows",
    "Get all flows for a project. Returns id, name, status, and node count.",
    {
      project_id: z.string().optional().describe("Project ID"),
    },
    async ({ project_id }) => {
      const projectId = resolveProject(project_id);
      const constraints: QueryConstraint[] = [];
      if (projectId) constraints.push(where("projectId", "==", projectId));

      const q = query(collection(db, "flows"), ...constraints);
      const snap = await getDocs(q);

      if (snap.empty) return text("No flows found.");

      const lines = snap.docs.map((d) => {
        const f = d.data();
        const nodeCount = Array.isArray(f.nodes) ? f.nodes.length : 0;
        return `- [${f.status}] ${f.name} (nodes=${nodeCount}, id=${d.id})`;
      });
      return text(`Flows (${snap.size}):\n${lines.join("\n")}`);
    },
    { userFacing: false },
  );

  // 19. update_flow — Update an existing flow
  auditedTool(
    "update_flow",
    "Update a flow. Can change name, nodes, edges, and status (draft/running/paused/completed/failed).",
    {
      flow_id: z.string().describe("Flow ID"),
      name: z.string().optional().describe("New flow name"),
      nodes: z.string().optional().describe("FlowNode[] as JSON string"),
      edges: z.string().optional().describe("FlowEdge[] as JSON string"),
      status: z
        .enum(["draft", "running", "paused", "completed", "failed"])
        .optional()
        .describe("New flow status"),
    },
    async ({ flow_id, name, nodes, edges, status }) => {
      const ref = doc(db, "flows", flow_id);
      const snap = await getDoc(ref);
      if (!snap.exists()) return text(`Error: Flow ${flow_id} not found.`);

      const updates: Record<string, unknown> = {
        updatedAt: Timestamp.now(),
      };

      if (name !== undefined) updates.name = name;
      if (status !== undefined) updates.status = status;

      if (nodes !== undefined) {
        try {
          updates.nodes = JSON.parse(nodes);
        } catch (e: unknown) {
          return text(`Error: Invalid nodes JSON — ${(e as Error).message}`);
        }
      }
      if (edges !== undefined) {
        try {
          updates.edges = JSON.parse(edges);
        } catch (e: unknown) {
          return text(`Error: Invalid edges JSON — ${(e as Error).message}`);
        }
      }

      await updateDoc(ref, updates);
      const flowName = name || snap.data()?.name || flow_id;
      return text(`Flow '${flowName}' updated successfully.`);
    },
  );

  // 20. add_pending_instruction — Queue a new-instruction for delivery to an
  //     agent's PTY on whatever machine currently hosts it. Used when the
  //     caller is not on the same machine as the target agent (team chat
  //     @mention, remote kanban operation, etc.), or as a robust fallback
  //     when same-machine direct PTY write is unavailable.
  auditedTool(
    "add_pending_instruction",
    "Queue a new-instruction for delivery to an agent's PTY across machines. The marblo app hosting the agent picks it up via a Firestore listener and injects it into the PTY's stdin. Use for cross-machine team scenarios where direct PTY write is not possible.",
    {
      task_id: z
        .string()
        .optional()
        .describe(
          "Task ID this instruction relates to. Omit for task-less directives (e.g. orchestrator-level commands).",
        ),
      target_agent_id: z
        .string()
        .describe("Agent ID whose PTY should receive the instruction"),
      message: z.string().describe("Instruction text to inject into PTY stdin"),
      project_id: z
        .string()
        .optional()
        .describe(
          "Project ID. Required when task_id is omitted; otherwise inferred from the task document.",
        ),
      source_type: z
        .enum(["kanban", "chat", "orchestrator", "other"])
        .optional()
        .describe("Where the instruction originated (default: 'other')"),
      from_user_id: z
        .string()
        .optional()
        .describe("User ID who initiated the instruction"),
      from_user_name: z
        .string()
        .optional()
        .describe("Display name of the initiating user"),
    },
    async ({
      task_id,
      target_agent_id,
      message,
      project_id,
      source_type,
      from_user_id,
      from_user_name,
    }) => {
      // Resolve project: prefer the task's projectId (authoritative), then
      // the explicit project_id arg, then MARBLO_PROJECT env. Missing
      // projectId is rejected because the security rules require it for
      // future per-project scoping.
      let projectId = "";
      if (task_id) {
        const task = await fetchTask(task_id);
        if (!task) return text(`Error: Task ${task_id} not found.`);
        projectId = task.projectId;
      }
      if (!projectId) {
        projectId = resolveProject(project_id);
      }
      if (!projectId) {
        return text(
          "Error: projectId could not be resolved. Pass project_id or set MARBLO_PROJECT.",
        );
      }

      const ref = await addDoc(collection(db, "pendingInstructions"), {
        projectId,
        taskId: task_id ?? null,
        targetAgentId: target_agent_id,
        message,
        fromUserId: from_user_id || "",
        fromUserName: from_user_name || "",
        sourceType: source_type || "other",
        isDelivered: false,
        createdAt: Timestamp.now(),
        deliveredAt: null,
      });
      return text(`Pending instruction queued: ${ref.id}`);
    },
  );

  // 21. get_pending_instructions — Fetch pending instructions for a given
  //     agent. The marblo app on each machine drains its local agents'
  //     queues via an onSnapshot listener (preferred) or this tool.
  auditedTool(
    "get_pending_instructions",
    "Fetch pending instructions for an agent. By default returns only undelivered entries, ordered oldest-first.",
    {
      target_agent_id: z
        .string()
        .describe("Agent ID whose pending queue to drain"),
      include_delivered: z
        .boolean()
        .optional()
        .describe("Include already-delivered entries (default: false)"),
      limit: z
        .number()
        .optional()
        .describe("Max entries to return (default: 50)"),
    },
    async ({ target_agent_id, include_delivered, limit }) => {
      const constraints: QueryConstraint[] = [
        where("targetAgentId", "==", target_agent_id),
      ];
      if (!include_delivered) {
        constraints.push(where("isDelivered", "==", false));
      }
      const q = query(collection(db, "pendingInstructions"), ...constraints);
      const snap = await getDocs(q);

      if (snap.empty) return text("No pending instructions.");

      const max = typeof limit === "number" && limit > 0 ? limit : 50;
      const docs = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
        .sort((a: any, b: any) => {
          const at = a.createdAt?.toMillis?.() ?? 0;
          const bt = b.createdAt?.toMillis?.() ?? 0;
          return at - bt;
        })
        .slice(0, max);

      const lines = docs.map((d: any) => {
        const delivered = d.isDelivered ? " [delivered]" : "";
        const who = d.fromUserName || d.fromUserId || "system";
        const src = d.sourceType || "other";
        return `- ${d.id} (from=${who}, src=${src})${delivered}: ${d.message}`;
      });
      return text(lines.join("\n"));
    },
    { userFacing: false },
  );

  // 22. mark_instruction_delivered — Flip `isDelivered` to true after the
  //     marblo app has successfully injected the instruction into the PTY.
  //     This is the only mutation security rules permit on existing
  //     pendingInstructions documents (besides creation).
  auditedTool(
    "mark_instruction_delivered",
    "Mark a pending instruction as delivered. Called by the marblo app after successful PTY stdin injection.",
    {
      instruction_id: z.string().describe("Pending instruction document ID"),
    },
    async ({ instruction_id }) => {
      const ref = doc(db, "pendingInstructions", instruction_id);
      const snap = await getDoc(ref);
      if (!snap.exists())
        return text(`Error: Pending instruction ${instruction_id} not found.`);
      const data = snap.data();
      if (data.isDelivered) {
        return text(`Instruction ${instruction_id} already delivered.`);
      }
      await updateDoc(ref, {
        isDelivered: true,
        deliveredAt: Timestamp.now(),
      });
      return text(`Instruction ${instruction_id} marked as delivered.`);
    },
  );

  // 23. run_skill — Mission engine 용 (명세 §8).
  //     allowlist 잠금된 gstack 슬래시 명령을 격리된 cc --print subprocess 로
  //     실행하고 결과를 반환한다.
  //     보안 락다운:
  //       - skill: zod enum (allowlist 외 거부)
  //       - args: shell 메타문자 차단 + 길이 제한
  //       - cwd: 절대 경로 + 디렉토리 존재 확인
  //       - timeout: default 10분, max 30분 — 초과 시 SIGTERM/SIGKILL
  //       - env: 최소 화이트리스트만 전달
  //     동기화 필요: v3/electron/mission-engine/types.ts 의 ALLOWED_SKILLS,
  //                v3/src/components/missions/templates.ts 의 skill 들과 동일.
  const ALLOWED_MISSION_SKILLS = [
    "/review",
    "/qa",
    "/ship",
    "/investigate",
    "/plan-ceo-review",
    "/plan-eng-review",
    "/plan-design-review",
    "/design-review",
    "/office-hours",
    "/autoplan",
  ] as const;
  const SHELL_METACHARS = /[;&|`$<>\\\n\r]/;

  auditedTool(
    "run_skill",
    "Run an allowlisted gstack slash command in an isolated `cc --print` subprocess and return the result. Used by MissionEngine. Arbitrary text and non-allowlisted commands are rejected.",
    {
      skill: z
        .enum(ALLOWED_MISSION_SKILLS)
        .describe("gstack slash command (allowlist)"),
      args: z
        .string()
        .max(2000)
        .optional()
        .describe("slash command args (shell metacharacters blocked)"),
      mission_id: z
        .string()
        .optional()
        .describe("mission ID — surfaced to subprocess as MARBLO_MISSION_ID"),
      cwd: z
        .string()
        .optional()
        .describe(
          "absolute cwd for the subprocess (default: MARBLO_PROJECT_ROOT or process.cwd())",
        ),
      timeout_ms: z
        .number()
        .int()
        .min(10_000)
        .max(1_800_000)
        .optional()
        .describe("timeout ms (default 600000 = 10min, max 1800000 = 30min)"),
    },
    async ({ skill, args, mission_id, cwd, timeout_ms }) => {
      // 1) args sanitization — shell injection 방지
      if (args && SHELL_METACHARS.test(args)) {
        return text(
          "Error: run_skill args contains forbidden shell metacharacters (;&|`$<>\\n).",
        );
      }

      // 2) cwd 검증 — 절대 경로 + 디렉토리 존재
      const resolvedCwd =
        cwd || process.env.MARBLO_PROJECT_ROOT || process.cwd();
      if (!path.isAbsolute(resolvedCwd)) {
        return text(`Error: run_skill cwd must be absolute, got "${cwd}".`);
      }
      try {
        const stat = fs.statSync(resolvedCwd);
        if (!stat.isDirectory()) {
          return text(
            `Error: run_skill cwd "${resolvedCwd}" is not a directory.`,
          );
        }
      } catch {
        return text(
          `Error: run_skill cwd "${resolvedCwd}" does not exist or is not accessible.`,
        );
      }

      // 3) subprocess spawn — cc --print, env 최소화
      const timeoutMs = timeout_ms ?? 600_000;
      const ccBinary = process.env.MARBLO_CC_BIN || "claude";
      const prompt = args ? `${skill} ${args}` : skill;
      const startedAt = Date.now();

      return await new Promise<ReturnType<typeof text>>((resolve) => {
        let resolved = false;
        let stdout = "";
        let stderr = "";

        const child = spawn(ccBinary, ["--print", prompt], {
          cwd: resolvedCwd,
          env: {
            PATH: process.env.PATH ?? "",
            HOME: process.env.HOME ?? "",
            USER: process.env.USER ?? "",
            LANG: process.env.LANG ?? "en_US.UTF-8",
            MARBLO_PROJECT: process.env.MARBLO_PROJECT ?? "",
            MARBLO_AGENT_ID: process.env.MARBLO_AGENT_ID ?? "",
            MARBLO_MISSION_ID: mission_id ?? "",
          },
          stdio: ["ignore", "pipe", "pipe"],
        });

        const timer = setTimeout(() => {
          try {
            child.kill("SIGTERM");
          } catch {
            /* best-effort */
          }
          setTimeout(() => {
            try {
              child.kill("SIGKILL");
            } catch {
              /* best-effort */
            }
          }, 5000);
          finish(false, `timeout after ${timeoutMs}ms`);
        }, timeoutMs);

        const finish = (ok: boolean, errLine?: string) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timer);
          const durationMs = Date.now() - startedAt;
          const status = ok ? "✅" : "❌";
          const outTail = stdout.slice(-8000);
          const errTail = stderr.slice(-2000);
          const summary =
            `${status} run_skill ${skill} (${durationMs}ms)\n` +
            (outTail ? `---stdout (last 8KB)---\n${outTail}\n` : "") +
            (errTail || errLine
              ? `---stderr---\n${[errLine, errTail]
                  .filter(Boolean)
                  .join("\n")}\n`
              : "");
          resolve(text(summary.trim()));
        };

        child.stdout.on("data", (b) => {
          stdout += b.toString();
        });
        child.stderr.on("data", (b) => {
          stderr += b.toString();
        });
        child.on("exit", (code, signal) => {
          finish(
            code === 0,
            code !== 0
              ? `exit code=${code} signal=${signal ?? "none"}`
              : undefined,
          );
        });
        child.on("error", (err) => {
          finish(false, `spawn error: ${err.message}`);
        });
      });
    },
  );

  // mission_step_done — B안 Phase 2 (보고 채널): 미션 오케스트레이터 → 지휘자
  // 스텝완료/실패 보고. 설계: v3/docs/MISSIONS-B-ORCHESTRATOR-DRIVEN.md §4 / §8.4.
  auditedTool(
    "mission_step_done",
    "Report completion (or failure) of the CURRENT mission step to the mission " +
      "conductor. Valid only inside a mission orchestrator context " +
      "(MARBLO_CONTEXT=<missionId>); board / Quick Lane / unscoped callers are " +
      "rejected. Emits the 'mission.step_reported' event the conductor subscribes " +
      "to. Call this when a granted step is finished — do NOT advance to the next " +
      "step yourself; the conductor verifies the step gate and grants the next.",
    {
      stepIndex: z
        .number()
        .int()
        .optional()
        .describe(
          "Index of the completed step. Omit to let the conductor use the " +
            "mission's current step.",
        ),
      result: z
        .object({
          success: z.boolean().describe("Whether the step succeeded."),
          output: z
            .unknown()
            .optional()
            .describe(
              "Artifact summary for gate verification (e.g. PR URL, review verdict).",
            ),
          error: z
            .string()
            .optional()
            .describe("Failure reason when success=false."),
        })
        .optional()
        .describe("Step result. Omit to report a successful completion."),
    },
    async ({ stepIndex, result }) => {
      const event = buildMissionStepReportedEvent(stepIndex, result);
      if (!event) {
        return text(
          "Error: mission_step_done requires a mission context. This caller is on " +
            "the board / a Quick Lane / unscoped (MARBLO_CONTEXT is not a missionId), " +
            "so there is no mission step to report.",
        );
      }
      emitMissionStepReport(event);
      const { missionId, payload } = event;
      const status = payload.result.success ? "success" : "failed";
      const stepLabel =
        payload.stepIndex < 0 ? "current step" : `step ${payload.stepIndex}`;
      return text(
        `Reported ${stepLabel} as ${status} to the conductor for mission ${missionId}.` +
          (payload.result.error ? ` (error: ${payload.result.error})` : ""),
      );
    },
  );
}
