import { z } from "zod";
import { collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, query, where, Timestamp, } from "firebase/firestore";
import { db } from "./firebase.js";
import * as fs from "node:fs";
import * as path from "node:path";
const VALID_TRANSITIONS = {
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
function canTransition(from, to) {
    return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}
// ── Helpers ──────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TASK_NNN_RE = /^TASK-(\d+)$/i;
const DEFAULT_PROJECT = process.env.MARBLO_PROJECT || "";
const SKILLS_DIR = process.env.MARBLO_SKILLS_DIR ||
    path.resolve(new URL(".", import.meta.url).pathname, "..", "..", "..", "skills");
/**
 * Send a notification to the orchestrator via the bridge server.
 * Fire-and-forget — errors are silently ignored.
 */
function notifyOrchestrator(message) {
    const bridgePort = process.env.MARBLO_BRIDGE_PORT;
    if (!bridgePort)
        return;
    // Forward MARBLO_PROJECT so the bridge routes to the right per-project
    // orchestrator in multi-window mode. Each MCP server is launched with
    // MARBLO_PROJECT set by the agent / orchestrator config generator, so
    // this scopes notifications correctly without renderer involvement.
    const projectId = process.env.MARBLO_PROJECT || "";
    fetch(`http://127.0.0.1:${bridgePort}/notify-orchestrator`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, projectId }),
    }).catch(() => {
        /* best-effort */
    });
}
// Firestore document IDs are 20-char alphanumeric strings
const FIRESTORE_ID_RE = /^[A-Za-z0-9]{15,}$/;
function resolveProject(projectId) {
    // Always prefer the injected DEFAULT_PROJECT (Firestore document ID from Electron)
    if (DEFAULT_PROJECT)
        return DEFAULT_PROJECT;
    // Only accept explicit project_id if it looks like a Firestore document ID
    if (projectId && FIRESTORE_ID_RE.test(projectId))
        return projectId;
    // Reject human-readable names like "stockai-platform" — they cause projectId mismatch
    if (projectId) {
        console.warn(`[MCP] Ignoring non-Firestore project_id="${projectId}". Use MARBLO_PROJECT env var.`);
    }
    return "";
}
async function fetchTask(taskId) {
    const ref = doc(db, "tasks", taskId);
    const snap = await getDoc(ref);
    if (!snap.exists())
        return null;
    return { id: snap.id, ...snap.data() };
}
function text(t) {
    return { content: [{ type: "text", text: t }] };
}
// ── Audit Logging ─────────────────────────────────────────────
const MARBLO_AGENT_ID = process.env.MARBLO_AGENT_ID || "unknown";
function auditLog(entry) {
    addDoc(collection(db, "audit_logs"), {
        ...entry,
        createdAt: Timestamp.now(),
    }).catch((err) => {
        console.error("[Audit] Failed to write audit log:", err);
    });
}
function sanitizeParams(params) {
    const sanitized = {};
    for (const [key, value] of Object.entries(params)) {
        if (typeof value === "string" && value.length > 200) {
            sanitized[key] = value.slice(0, 200) + "...";
        }
        else {
            sanitized[key] = value;
        }
    }
    return sanitized;
}
function truncateResult(result) {
    const t = typeof result === "string" ? result : JSON.stringify(result);
    return t.length > 500 ? t.slice(0, 500) + "..." : t;
}
// ── Tool Registration ────────────────────────────────────────
export function registerTools(server) {
    // Wrap server.tool to add automatic audit logging
    const originalTool = server.tool.bind(server);
    function auditedTool(name, description, schema, handler) {
        originalTool(name, description, schema, async (...args) => {
            const start = Date.now();
            let success = true;
            let resultText = "";
            try {
                const result = await handler(...args);
                resultText = result?.content?.[0]?.text || "";
                return result;
            }
            catch (err) {
                success = false;
                resultText = err instanceof Error ? err.message : String(err);
                throw err;
            }
            finally {
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
    auditedTool("get_all_tasks", "Get all tasks regardless of status. Optionally filter by project and/or role. Set all_projects=true to ignore default project filter and see ALL tasks.", {
        project_id: z.string().optional().describe("Project ID"),
        role: z
            .string()
            .optional()
            .describe("Filter by role (backend/frontend/test/devops)"),
        all_projects: z
            .boolean()
            .optional()
            .describe("Ignore default project filter, show all projects (default: false)"),
    }, async ({ project_id, role, all_projects }) => {
        const projectId = all_projects ? "" : resolveProject(project_id);
        const constraints = [];
        if (projectId)
            constraints.push(where("projectId", "==", projectId));
        if (role)
            constraints.push(where("role", "==", role));
        const q = query(collection(db, "tasks"), ...constraints);
        const snap = await getDocs(q);
        if (snap.empty)
            return text("No tasks found.");
        const docs = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
        const lines = docs.map((t) => {
            const claimed = t.claimedBy ? ` → ${t.claimedBy}` : "";
            const proj = all_projects ? ` project=${t.projectId || "(none)"}` : "";
            return `- [${t.status}] ${t.title} (role=${t.role}, id=${t.id}${proj})${claimed}`;
        });
        return text(lines.join("\n"));
    });
    // 2. get_available_tasks
    auditedTool("get_available_tasks", "Get TODO tasks available for the given role. Returns tasks whose dependencies are satisfied.", {
        role: z.string().describe("Agent role (backend/frontend/test/devops)"),
        project_id: z.string().optional().describe("Project ID"),
    }, async ({ role, project_id }) => {
        const projectId = resolveProject(project_id);
        const constraints = [
            where("status", "==", "TODO"),
            where("role", "==", role),
        ];
        if (projectId)
            constraints.push(where("projectId", "==", projectId));
        const q = query(collection(db, "tasks"), ...constraints);
        const snap = await getDocs(q);
        const tasks = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((t) => t.dependsOnCompleted)
            .sort((a, b) => b.priority - a.priority);
        if (tasks.length === 0)
            return text(`No available tasks for role '${role}'.`);
        const lines = tasks.map((t) => {
            const deps = t.dependsOn?.length
                ? ` (depends_on: ${t.dependsOn.join(", ")})`
                : "";
            return `- [${t.id}] ${t.title} (priority=${t.priority})${deps}`;
        });
        return text(lines.join("\n"));
    });
    // 3. create_task
    auditedTool("create_task", "Create a new task. Role: backend/frontend/test/devops. Set project_id to group tasks, context for env constraints, scope for file paths.", {
        title: z.string().describe("Task title"),
        description: z.string().describe("Task description"),
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
    }, async ({ title, description, role, priority, depends_on, project_id, context, scope, }) => {
        const projectId = resolveProject(project_id);
        if (!projectId) {
            return text("Error: No project context. Set MARBLO_PROJECT env var or pass project_id parameter.\n" +
                "In Electron: agents get this automatically. For external CLI: set MARBLO_PROJECT in MCP config.");
        }
        const now = Timestamp.now();
        const deps = depends_on ?? [];
        const data = {
            title,
            description,
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
        };
        const ref = await addDoc(collection(db, "tasks"), data);
        return text(`Task created successfully!\nID: ${ref.id}\nTitle: ${title}\nRole: ${role}\nPriority: ${priority ?? 0}`);
    });
    // 4. create_tasks_bulk
    auditedTool("create_tasks_bulk", "Create multiple tasks at once. Pass tasks_json (JSON string) or tasks (array). Each item: title, description, role, priority?, depends_on?, project_id?, context?, scope?, alias?. depends_on supports TASK-NNN (1-based index), alias, or UUID.", {
        tasks_json: z
            .string()
            .optional()
            .describe("JSON array of task objects (string)"),
        tasks: z
            .array(z.record(z.unknown()))
            .optional()
            .describe("Array of task objects (alternative to tasks_json)"),
    }, async ({ tasks_json, tasks }) => {
        let taskList;
        if (tasks && Array.isArray(tasks)) {
            // 배열 직접 전달
            taskList = tasks;
        }
        else if (tasks_json) {
            // JSON 문자열 전달
            try {
                taskList = JSON.parse(tasks_json);
            }
            catch (e) {
                return text(`Error: Invalid JSON — ${e.message}`);
            }
            if (!Array.isArray(taskList))
                return text("Error: tasks_json must be a JSON array.");
        }
        else {
            return text("Error: Either tasks_json (string) or tasks (array) is required.");
        }
        const project = resolveProject("");
        if (!project) {
            return text("Error: No project context. Set MARBLO_PROJECT env var or include project_id in each task.\n" +
                "In Electron: agents get this automatically. For external CLI: set MARBLO_PROJECT in MCP config.");
        }
        // Phase 1: Build alias map (symbolic name → array index)
        const aliasMap = {};
        for (let i = 0; i < taskList.length; i++) {
            aliasMap[`TASK-${String(i + 1).padStart(3, "0")}`.toUpperCase()] = i;
            const alias = taskList[i].alias;
            if (alias)
                aliasMap[alias] = i;
        }
        // Phase 2: Sequential creation with dependency resolution
        const indexToId = {};
        const results = [];
        let successCount = 0;
        for (let i = 0; i < taskList.length; i++) {
            const t = taskList[i];
            let resolvedDeps = null;
            let depError = null;
            const rawDeps = t.depends_on;
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
                results.push(`  [FAILED] ${t.title || `task #${i}`} — ${depError}`);
                continue;
            }
            const now = Timestamp.now();
            const deps = resolvedDeps ?? [];
            const data = {
                title: t.title || "",
                description: t.description || "",
                role: t.role || "backend",
                priority: t.priority ?? 0,
                status: "TODO",
                dependsOn: deps,
                dependsOnCompleted: deps.length === 0,
                claimedBy: null,
                claimedAt: null,
                scope: t.scope || [],
                comment: t.context || "",
                prUrl: "",
                hasPmFeedback: false,
                createdAt: now,
                updatedAt: now,
            };
            // Always use the resolved project (Firestore doc ID from MARBLO_PROJECT env)
            // Ignore per-task project_id overrides — they cause ID mismatch with the board
            data.projectId = project;
            try {
                const ref = await addDoc(collection(db, "tasks"), data);
                indexToId[i] = ref.id;
                results.push(`  [${ref.id}] ${data.title} (role=${data.role}, priority=${data.priority})`);
                successCount++;
            }
            catch (e) {
                results.push(`  [FAILED] ${t.title || `task #${i}`} — ${e.message}`);
            }
        }
        const depMappings = [];
        for (const [label, idx] of Object.entries(aliasMap)) {
            if (idx in indexToId)
                depMappings.push(`    ${label} -> ${indexToId[idx]}`);
        }
        let output = `Created ${successCount}/${taskList.length} tasks:\n${results.join("\n")}`;
        if (depMappings.length > 0)
            output += `\n\nDependency ID mappings:\n${depMappings.join("\n")}`;
        return text(output);
    });
    // 5. claim_task
    auditedTool("claim_task", "Claim a specific task by ID. The task must be in TODO status with dependencies met.", {
        task_id: z.string().describe("Task ID to claim"),
        agent_id: z.string().describe("ID of the agent claiming the task"),
    }, async ({ task_id, agent_id }) => {
        const task = await fetchTask(task_id);
        if (!task)
            return text(`Error: Task ${task_id} not found.`);
        if (task.status !== "TODO") {
            return text("Error: Task is not available for claiming (not in TODO status).");
        }
        if (!task.dependsOnCompleted) {
            return text("Error: Task dependencies are not yet met.");
        }
        await updateDoc(doc(db, "tasks", task_id), {
            status: "CLAIMED",
            claimedBy: agent_id,
            claimedAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
        });
        const lines = [
            `Successfully claimed task: ${task.title}`,
            `ID: ${task_id}`,
            `Status: CLAIMED`,
            `Role: ${task.role}`,
        ];
        if (task.comment)
            lines.push(`Context: ${task.comment}`);
        if (task.scope?.length)
            lines.push(`Scope (files): ${task.scope.join(", ")}`);
        return text(lines.join("\n"));
    });
    // 6. update_task_status
    auditedTool("update_task_status", "Update a task status. Valid: TODO, CLAIMED, IN_PROGRESS, REVIEW, BLOCKED, FAILED, DONE. State machine rules enforced. Use force=true to skip validation (e.g., marking already-completed tasks as DONE).", {
        task_id: z.string().describe("Task ID"),
        status: z.string().describe("New status"),
        comment: z.string().optional().describe("Comment for the status change"),
        force: z
            .boolean()
            .optional()
            .describe("Skip state machine validation (default: false)"),
    }, async ({ task_id, status, comment, force }) => {
        const task = await fetchTask(task_id);
        if (!task)
            return text(`Error: Task ${task_id} not found.`);
        const newStatus = status;
        if (!force && !canTransition(task.status, newStatus)) {
            const validTargets = VALID_TRANSITIONS[task.status] ?? [];
            return text(`Error: Cannot transition from ${task.status} to ${newStatus}. Valid targets: ${validTargets.join(", ")}\nTip: Use force=true to skip validation.`);
        }
        const updates = {
            status: newStatus,
            updatedAt: Timestamp.now(),
        };
        if (comment)
            updates.comment = comment;
        await updateDoc(doc(db, "tasks", task_id), updates);
        // Signal agent is now free when task leaves active work state
        const doneStatuses = ["DONE", "REVIEW", "BLOCKED", "FAILED"];
        if (doneStatuses.includes(newStatus) && MARBLO_AGENT_ID) {
            const bridgePort = process.env.MARBLO_BRIDGE_PORT;
            if (bridgePort) {
                fetch(`http://127.0.0.1:${bridgePort}/set-agent-status`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ agentId: MARBLO_AGENT_ID, status: "idle" }),
                }).catch(() => { });
            }
        }
        // Notify orchestrator about status change
        const commentNote = comment ? ` — ${comment}` : "";
        notifyOrchestrator(`[Task Update] "${task.title}" ${task.status} → ${newStatus} (role=${task.role}, id=${task_id})${commentNote}`);
        // ── Inline dependency resolution ──
        // When a task completes, check all tasks that depend on it
        // and mark them ready if ALL their deps are now DONE.
        let unblocked = 0;
        if (newStatus === "DONE") {
            try {
                const depQ = query(collection(db, "tasks"), where("dependsOn", "array-contains", task_id));
                const depSnap = await getDocs(depQ);
                for (const depDoc of depSnap.docs) {
                    const depData = depDoc.data();
                    if (depData.dependsOnCompleted)
                        continue; // already resolved
                    // Check if ALL dependencies are now DONE
                    const allDeps = depData.dependsOn ?? [];
                    let allMet = true;
                    for (const depId of allDeps) {
                        if (depId === task_id)
                            continue; // we know this one is DONE
                        const depTask = await fetchTask(depId);
                        if (!depTask || depTask.status !== "DONE") {
                            allMet = false;
                            break;
                        }
                    }
                    if (allMet) {
                        await updateDoc(doc(db, "tasks", depDoc.id), {
                            dependsOnCompleted: true,
                            updatedAt: Timestamp.now(),
                        });
                        unblocked++;
                        // Notify orchestrator about newly unblocked task
                        notifyOrchestrator(`[Dependency Resolved] "${depData.title}" is now ready (all dependencies met, id=${depDoc.id}, role=${depData.role})`);
                    }
                }
            }
            catch (err) {
                console.error("[MCP] Dependency resolution error:", err);
            }
        }
        const unblockedNote = unblocked > 0 ? ` Unblocked ${unblocked} dependent task(s).` : "";
        return text(`Task '${task.title}' status updated to ${newStatus}.${unblockedNote}`);
    });
    // 7. add_activity
    auditedTool("add_activity", "Add an activity log entry to a task. Use to record work progress, decisions, or events.", {
        task_id: z.string().describe("Task ID"),
        message: z.string().describe("Activity message"),
        agent_id: z.string().optional().describe("Agent ID"),
    }, async ({ task_id, message, agent_id }) => {
        const task = await fetchTask(task_id);
        if (!task)
            return text(`Error: Task ${task_id} not found.`);
        // Fall back to the MARBLO_AGENT_ID env var (injected by Marblo when
        // the MCP server is spawned for an agent) before "unknown". The
        // Agents tab Activity feed filters by `agentId in [our agents]`, so
        // logging "unknown" makes the activity invisible.
        const resolvedAgentId = agent_id || MARBLO_AGENT_ID;
        await addDoc(collection(db, "activities"), {
            taskId: task_id,
            agentId: resolvedAgentId,
            message,
            createdAt: Timestamp.now(),
        });
        return text(`Activity logged: ${message}`);
    });
    // 8. submit_for_review
    auditedTool("submit_for_review", "Submit a task for review. Moves the task to REVIEW status.", {
        task_id: z.string().describe("Task ID"),
        pr_url: z.string().optional().describe("Pull request URL"),
    }, async ({ task_id, pr_url }) => {
        const task = await fetchTask(task_id);
        if (!task)
            return text(`Error: Task ${task_id} not found.`);
        // Allow submit from any pre-DONE status (auto-skip intermediate states)
        if (task.status === "DONE") {
            return text(`Task '${task.title}' is already DONE.`);
        }
        const updates = {
            status: "REVIEW",
            updatedAt: Timestamp.now(),
        };
        if (pr_url)
            updates.prUrl = pr_url;
        // Auto-claim if the task was never claimed
        if (!task.claimedBy) {
            updates.claimedBy = MARBLO_AGENT_ID;
            updates.claimedAt = Timestamp.now();
        }
        await updateDoc(doc(db, "tasks", task_id), updates);
        // Signal agent is now free
        if (MARBLO_AGENT_ID) {
            const bridgePort = process.env.MARBLO_BRIDGE_PORT;
            if (bridgePort) {
                fetch(`http://127.0.0.1:${bridgePort}/set-agent-status`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ agentId: MARBLO_AGENT_ID, status: "idle" }),
                }).catch(() => { });
            }
        }
        // Notify orchestrator about review submission
        const prNote = pr_url ? ` PR: ${pr_url}` : "";
        notifyOrchestrator(`[Review Submitted] "${task.title}" is ready for review (role=${task.role}, id=${task_id})${prNote}`);
        return text(`Task '${task.title}' submitted for review. Status: REVIEW`);
    });
    // 9. get_task_dependencies
    auditedTool("get_task_dependencies", "Check dependency status for a task. Shows which dependent tasks are completed and which are pending.", {
        task_id: z.string().describe("Task ID"),
    }, async ({ task_id }) => {
        const task = await fetchTask(task_id);
        if (!task)
            return text(`Error: Task ${task_id} not found.`);
        if (!task.dependsOn || task.dependsOn.length === 0) {
            return text("This task has no dependencies.");
        }
        const details = [];
        let allCompleted = true;
        for (const depId of task.dependsOn) {
            const dep = await fetchTask(depId);
            if (!dep) {
                details.push(`- [unknown] (ID: ${depId} — not found)`);
                allCompleted = false;
            }
            else {
                const completed = dep.status === "DONE";
                if (!completed)
                    allCompleted = false;
                details.push(`- [${completed ? "done" : "pending"}] ${dep.title} (${dep.status})`);
            }
        }
        return text(`All completed: ${allCompleted}\n${details.join("\n")}`);
    });
    // 10. get_agent_skill
    auditedTool("get_agent_skill", "Get skill/instruction file for a given agent role. Available: backend, frontend, test, devops, merge, team_leader, flutter.", {
        role: z.string().describe("Agent role name"),
    }, async ({ role }) => {
        const safeRole = role.replace(/[^a-zA-Z0-9_]/g, "");
        if (!safeRole || safeRole !== role) {
            return text(`Error: Invalid role name '${role}'. Use alphanumeric and underscore only.`);
        }
        const skillsDir = path.resolve(SKILLS_DIR);
        for (const filename of [`${safeRole}_agent.md`, `${safeRole}.md`]) {
            const filePath = path.resolve(skillsDir, filename);
            if (!filePath.startsWith(skillsDir))
                continue; // path traversal guard
            if (fs.existsSync(filePath)) {
                return text(fs.readFileSync(filePath, "utf-8"));
            }
        }
        return text(`Error: No skill file found for role '${role}'.`);
    });
    // 11. get_task_activities
    auditedTool("get_task_activities", "Get activity log entries for a task. Set pm_only=true to see only PM feedback.", {
        task_id: z.string().describe("Task ID"),
        pm_only: z
            .boolean()
            .optional()
            .default(false)
            .describe("Show only PM feedback"),
    }, async ({ task_id, pm_only }) => {
        const task = await fetchTask(task_id);
        if (!task)
            return text(`Error: Task ${task_id} not found.`);
        const constraints = [where("taskId", "==", task_id)];
        if (pm_only)
            constraints.push(where("type", "==", "pm"));
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
        return text(lines.join("\n"));
    });
    // 12. check_feedback
    auditedTool("check_feedback", "Check for tasks that have unread PM feedback. Filter by role and optionally by project.", {
        role: z.string().describe("Agent role (backend/frontend/test/devops)"),
        project_id: z.string().optional().describe("Project ID"),
    }, async ({ role, project_id }) => {
        const projectId = resolveProject(project_id);
        const constraints = [
            where("role", "==", role),
            where("hasPmFeedback", "==", true),
        ];
        if (projectId)
            constraints.push(where("projectId", "==", projectId));
        const q = query(collection(db, "tasks"), ...constraints);
        const snap = await getDocs(q);
        if (snap.empty)
            return text(`No tasks with pending PM feedback for role '${role}'.`);
        const lines = [`Tasks with PM feedback (${snap.size}):`];
        snap.docs.forEach((d) => {
            const t = d.data();
            lines.push(`- [${d.id}] ${t.title} (status=${t.status}, priority=${t.priority})`);
        });
        return text(lines.join("\n"));
    });
    // 13. acknowledge_feedback
    auditedTool("acknowledge_feedback", "Mark PM feedback as read/acknowledged for a task. Clears the feedback badge.", {
        task_id: z.string().describe("Task ID"),
    }, async ({ task_id }) => {
        const task = await fetchTask(task_id);
        if (!task)
            return text(`Error: Task ${task_id} not found.`);
        await updateDoc(doc(db, "tasks", task_id), {
            hasPmFeedback: false,
            updatedAt: Timestamp.now(),
        });
        return text(`Feedback acknowledged for task '${task.title}'. Badge cleared.`);
    });
    // 15. spawn_agent — HTTP bridge to Electron AgentManager
    auditedTool("spawn_agent", "Spawn a new agent via the Electron bridge. The agent gets its own PTY session and terminal tab. Requires MARBLO_BRIDGE_PORT env var.", {
        name: z.string().describe('Agent display name (e.g., "backend-auth")'),
        model: z
            .enum(["claude", "gemini", "gpt", "custom"])
            .describe("AI model to use"),
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
    }, async ({ name, model, role, command, cwd, initial_prompt }) => {
        const bridgePort = process.env.MARBLO_BRIDGE_PORT;
        if (!bridgePort) {
            return text("Error: MARBLO_BRIDGE_PORT not set. Bridge server not available.");
        }
        try {
            const body = JSON.stringify({
                name,
                model,
                role,
                command,
                cwd,
                initialPrompt: initial_prompt,
                // Forward MARBLO_PROJECT so bridge scopes the new agent to the
                // correct window in multi-window mode.
                projectId: process.env.MARBLO_PROJECT || "",
                // Forward MARBLO_AGENT_ID so bridge can fall back to the parent
                // agent's project / owner when projectId is empty (e.g., when
                // an external Claude Code session calls Marblo MCP without a
                // project context).
                parentAgentId: process.env.MARBLO_AGENT_ID || "",
            });
            const response = await fetch(`http://127.0.0.1:${bridgePort}/spawn-agent`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body,
            });
            const result = (await response.json());
            if (!result.success) {
                return text(`Error spawning agent: ${result.error || "Unknown error"}`);
            }
            // Write agent document to Firestore so it appears in Agents tab.
            // Use setDoc(...,{merge:true}) with the bridge's agentId as the
            // doc id so this write is idempotent — the renderer's
            // onAgentSpawned listener also writes the same doc, both writers
            // converge on the same id without creating duplicates.
            const projectId = resolveProject(undefined);
            if (projectId && result.agentId) {
                await setDoc(doc(db, "agents", result.agentId), {
                    projectId,
                    ownerId: "orchestrator",
                    name,
                    model,
                    role,
                    status: "idle",
                    currentTaskId: null,
                    command: command || model,
                    skillFile: "",
                    createdAt: Timestamp.now(),
                }, { merge: true });
            }
            return text(`Agent spawned successfully!\n` +
                `  Name: ${name}\n` +
                `  Model: ${model}\n` +
                `  Role: ${role}\n` +
                `  Agent ID: ${result.agentId}\n` +
                `  PTY Session: ${result.ptySessionId}`);
        }
        catch (err) {
            return text(`Error: Failed to reach bridge server — ${err.message}`);
        }
    });
    // 14. search_tasks (bonus)
    auditedTool("search_tasks", "Search tasks by keyword in title or description. Optionally filter by project.", {
        keyword: z.string().describe("Search keyword"),
        project_id: z.string().optional().describe("Project ID"),
    }, async ({ keyword, project_id }) => {
        const projectId = resolveProject(project_id);
        const constraints = [];
        if (projectId)
            constraints.push(where("projectId", "==", projectId));
        const q = query(collection(db, "tasks"), ...constraints);
        const snap = await getDocs(q);
        const lowerKeyword = keyword.toLowerCase();
        const matches = snap.docs.filter((d) => {
            const t = d.data();
            return (t.title?.toLowerCase().includes(lowerKeyword) ||
                t.description?.toLowerCase().includes(lowerKeyword));
        });
        if (matches.length === 0)
            return text(`No tasks found matching '${keyword}'.`);
        const lines = [`Found ${matches.length} task(s) matching '${keyword}':`];
        matches.forEach((d) => {
            const t = d.data();
            lines.push(`- [${t.status}] ${t.title} (role=${t.role}, id=${d.id})`);
        });
        return text(lines.join("\n"));
    });
    // 16. get_task — Get single task detail (including description)
    auditedTool("get_task", "Get full details of a single task by ID, including description, scope, dependencies, and comments.", {
        task_id: z.string().describe("Task ID"),
    }, async ({ task_id }) => {
        const task = await fetchTask(task_id);
        if (!task)
            return text(`Error: Task ${task_id} not found.`);
        const lines = [
            `ID: ${task.id}`,
            `Title: ${task.title}`,
            `Status: ${task.status}`,
            `Role: ${task.role}`,
            `Priority: ${task.priority}`,
            `Description: ${task.description || "(empty)"}`,
            `Claimed by: ${task.claimedBy || "(none)"}`,
            `Depends on: ${task.dependsOn?.length ? task.dependsOn.join(", ") : "(none)"}`,
            `Dependencies met: ${task.dependsOnCompleted}`,
            `Scope: ${task.scope?.length ? task.scope.join(", ") : "(none)"}`,
            `Comment: ${task.comment || "(none)"}`,
            `PR URL: ${task.prUrl || "(none)"}`,
            `Has PM feedback: ${task.hasPmFeedback}`,
        ];
        return text(lines.join("\n"));
    });
    // 17. get_agents — Real-time agent list (Bridge first, Firestore fallback)
    auditedTool("get_agents", "Get all agents with real-time status from AgentManager. Falls back to Firestore if bridge is unavailable.", {
        project_id: z
            .string()
            .optional()
            .describe("Project ID (only used for Firestore fallback)"),
    }, async ({ project_id }) => {
        const bridgePort = process.env.MARBLO_BRIDGE_PORT;
        // Try Bridge first — real-time data from AgentManager. Pass our
        // project so multi-window mode returns only this project's agents.
        if (bridgePort) {
            try {
                const projectId = process.env.MARBLO_PROJECT || "";
                const url = projectId
                    ? `http://127.0.0.1:${bridgePort}/agents?projectId=${encodeURIComponent(projectId)}`
                    : `http://127.0.0.1:${bridgePort}/agents`;
                const response = await fetch(url);
                const data = (await response.json());
                if (data.agents.length === 0)
                    return text("No agents found.");
                const lines = data.agents.map((a) => {
                    const restart = a.restartCount > 0 ? ` restarts=${a.restartCount}` : "";
                    return `- [${a.status}] ${a.name} (model=${a.model}, role=${a.role}, id=${a.id}${restart})`;
                });
                return text(`Agents (${data.agents.length}, real-time):\n${lines.join("\n")}`);
            }
            catch {
                // Bridge unavailable — fall through to Firestore
            }
        }
        // Firestore fallback
        const projectId = resolveProject(project_id);
        const constraints = [];
        if (projectId)
            constraints.push(where("projectId", "==", projectId));
        const q = query(collection(db, "agents"), ...constraints);
        const snap = await getDocs(q);
        if (snap.empty)
            return text("No agents found.");
        const lines = snap.docs.map((d) => {
            const a = d.data();
            const task = a.currentTaskId ? ` → task=${a.currentTaskId}` : "";
            return `- [${a.status}] ${a.name} (model=${a.model}, role=${a.role}, id=${d.id})${task}`;
        });
        return text(`Agents (${snap.size}, Firestore fallback):\n${lines.join("\n")}`);
    });
    // ── reuse_agent — Send a new instruction to an existing idle agent
    auditedTool("reuse_agent", "Send a new task instruction to an existing idle agent via its PTY session. Use this BEFORE spawn_agent to check if an idle agent with the matching role already exists. The agent will receive the message in its terminal stdin.", {
        agent_name: z.string().describe("Name of the existing agent to reuse"),
        instruction: z
            .string()
            .describe("New instruction/task to send to the agent"),
    }, async ({ agent_name, instruction }) => {
        const bridgePort = process.env.MARBLO_BRIDGE_PORT;
        if (!bridgePort) {
            return text("Error: MARBLO_BRIDGE_PORT not set. Bridge server not available.");
        }
        try {
            const response = await fetch(`http://127.0.0.1:${bridgePort}/reuse-agent`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    agentName: agent_name,
                    instruction,
                    projectId: process.env.MARBLO_PROJECT || "",
                }),
            });
            const result = (await response.json());
            if (!result.success) {
                return text(`Cannot reuse agent '${agent_name}': ${result.error || "Unknown error"}. Consider using spawn_agent instead.`);
            }
            return text(`Instruction sent to existing agent '${agent_name}'.\n` +
                `  Agent ID: ${result.agentId}\n` +
                `  Instruction: ${instruction.slice(0, 100)}${instruction.length > 100 ? "..." : ""}`);
        }
        catch (err) {
            return text(`Error: Failed to reach bridge server — ${err.message}`);
        }
    });
    // ── dispatch_task — Smart agent dispatch (reuse/restart/spawn/logical)
    auditedTool("dispatch_task", "Smart agent dispatch: automatically decides whether to reuse an idle agent, restart a stopped one, spawn a new one, or recommend a logical (internal) sub-agent. Preferred over manual spawn_agent/reuse_agent calls.", {
        role: z.string().describe("Agent role (backend/frontend/test/devops)"),
        instruction: z.string().describe("Instruction to send to the agent"),
        task_id: z.string().optional().describe("Marblo task ID for tracking"),
        complexity: z
            .enum(["simple", "standard", "complex"])
            .optional()
            .describe("'simple' = internal sub-agent, 'standard' = default, 'complex' = always physical agent"),
        model: z
            .string()
            .optional()
            .describe("Preferred model hint (claude/gemini/gpt)"),
        name: z.string().optional().describe("Agent name hint"),
        cwd: z.string().optional().describe("Working directory"),
        tags: z
            .array(z.string())
            .optional()
            .describe("Task tags for model scoring (e.g., architecture, research, simple-fix)"),
    }, async ({ role, instruction, task_id, complexity, model, name, cwd, tags, }) => {
        const bridgePort = process.env.MARBLO_BRIDGE_PORT;
        if (!bridgePort) {
            return text("Error: MARBLO_BRIDGE_PORT not set. Bridge server not available.");
        }
        // Patent claim 4: 매칭점수 산출 단계는 선행 태스크의 존재 여부 및
        // 완료 여부를 먼저 판단하고, 선행이 없거나 완료된 태스크에 대해서만
        // 매칭점수를 산출한다. dispatch_task 가 매칭/스폰 진입점이므로 여기서
        // 명시적으로 dependency gate 를 둔다 — get_available_tasks 의 필터와
        // 별개로, task_id 가 직접 지정된 dispatch 경로(오케스트레이터가 특정
        // 태스크를 콕 집어 배정하는 케이스)에서도 같은 가드가 적용되도록 함.
        if (task_id) {
            try {
                const task = await fetchTask(task_id);
                if (!task) {
                    return text(`Error: Task ${task_id} not found — refusing to dispatch.`);
                }
                if (!task.dependsOnCompleted) {
                    // Mark BLOCKED so it surfaces in the kanban board, then refuse
                    // to dispatch. Best-effort — failing to mark is not fatal.
                    try {
                        await updateDoc(doc(db, "tasks", task_id), {
                            status: "BLOCKED",
                            updatedAt: Timestamp.now(),
                        });
                    }
                    catch (markErr) {
                        console.error("[dispatch_task] Failed to mark task BLOCKED:", markErr);
                    }
                    const pending = (task.dependsOn || []).join(", ") || "(unknown)";
                    return text(`Dispatch aborted (patent claim 4: 선행태스크 미완료): task ${task_id} depends on [${pending}], not all complete. Task moved to BLOCKED. Resolve dependencies first, then re-dispatch.`);
                }
            }
            catch (err) {
                console.error("[dispatch_task] Dependency precheck failed:", err);
                // Don't block dispatch on a precheck failure — the bridge / agent
                // path also has its own claim_task gate as defense-in-depth.
            }
        }
        try {
            const response = await fetch(`http://127.0.0.1:${bridgePort}/dispatch-task`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    role,
                    instruction,
                    taskId: task_id,
                    complexity: complexity || "standard",
                    model,
                    nameHint: name,
                    cwd,
                    tags,
                    projectId: process.env.MARBLO_PROJECT || "",
                    // Forward parent agent id for owner fallback when projectId
                    // is empty (external Claude Code → Marblo MCP path).
                    parentAgentId: process.env.MARBLO_AGENT_ID || "",
                }),
            });
            const result = (await response.json());
            if (!result.success) {
                return text(`Dispatch failed: ${result.error || "Unknown error"}`);
            }
            // Persist newly-spawned / restarted agents to Firestore so they
            // appear in the Agents tab and survive across sessions. Reuse-only
            // dispatches don't need a new doc — the existing one is reused.
            // Idempotent setDoc(..., {merge:true}) with the bridge's agentId
            // as doc id — the renderer's onAgentSpawned listener also writes
            // the same doc, both converge on a single record.
            if ((result.action === "spawned" || result.action === "restarted") &&
                result.agentId) {
                const projectId = resolveProject(undefined);
                if (projectId) {
                    try {
                        await setDoc(doc(db, "agents", result.agentId), {
                            projectId,
                            ownerId: "orchestrator",
                            name: result.agentName || `${role}-agent`,
                            model: result.model || model || "claude",
                            role,
                            status: "working",
                            currentTaskId: task_id || null,
                            command: result.model || model || "claude",
                            skillFile: "",
                            createdAt: Timestamp.now(),
                        }, { merge: true });
                    }
                    catch (err) {
                        // Non-fatal — agent is already running, Firestore just won't
                        // show it. Surface in the response so the user can see why.
                        console.error("[dispatch_task] Firestore write failed:", err);
                    }
                }
            }
            const lines = [
                `Dispatch: ${result.action}`,
                `  Reason: ${result.reason}`,
            ];
            if (result.agentId)
                lines.push(`  Agent ID: ${result.agentId}`);
            if (result.agentName)
                lines.push(`  Agent Name: ${result.agentName}`);
            if (result.model)
                lines.push(`  Model: ${result.model}`);
            if (result.score !== undefined)
                lines.push(`  Score: ${result.score}`);
            if (result.action === "logical") {
                lines.push(`\nAction required: Use internal sub-agent (Task/Agent tool) to handle this simple task directly.`);
            }
            return text(lines.join("\n"));
        }
        catch (err) {
            return text(`Error: Failed to reach bridge server — ${err.message}`);
        }
    });
    // ── kill_agent — Stop and remove a specific agent
    auditedTool("kill_agent", "Stop a specific agent by name. Use to free resources or remove unnecessary agents.", {
        agent_name: z.string().describe("Name of the agent to kill"),
        reason: z.string().optional().describe("Reason for killing the agent"),
    }, async ({ agent_name, reason }) => {
        const bridgePort = process.env.MARBLO_BRIDGE_PORT;
        if (!bridgePort) {
            return text("Error: MARBLO_BRIDGE_PORT not set. Bridge server not available.");
        }
        try {
            const response = await fetch(`http://127.0.0.1:${bridgePort}/kill-agent`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ agentName: agent_name, reason }),
            });
            const result = (await response.json());
            if (!result.success) {
                return text(`Failed to kill agent '${agent_name}': ${result.error || "Unknown error"}`);
            }
            return text(`${result.reason}`);
        }
        catch (err) {
            return text(`Error: Failed to reach bridge server — ${err.message}`);
        }
    });
    // ── cleanup_agents — Batch cleanup of stopped/error agents
    auditedTool("cleanup_agents", "Clean up stopped or error-state agents. Optionally filter by role. Returns list of cleaned agents.", {
        role: z.string().optional().describe("Only clean agents with this role"),
    }, async ({ role }) => {
        const bridgePort = process.env.MARBLO_BRIDGE_PORT;
        if (!bridgePort) {
            return text("Error: MARBLO_BRIDGE_PORT not set. Bridge server not available.");
        }
        try {
            // Get real-time agent list scoped to our project (multi-window).
            const projectId = process.env.MARBLO_PROJECT || "";
            const listUrl = projectId
                ? `http://127.0.0.1:${bridgePort}/agents?projectId=${encodeURIComponent(projectId)}`
                : `http://127.0.0.1:${bridgePort}/agents`;
            const listResponse = await fetch(listUrl);
            const data = (await listResponse.json());
            // Filter candidates for cleanup
            const candidates = data.agents.filter((a) => {
                if (a.status !== "stopped" && a.status !== "error")
                    return false;
                if (role && a.role !== role)
                    return false;
                return true;
            });
            if (candidates.length === 0) {
                const roleNote = role ? ` for role '${role}'` : "";
                return text(`No stopped/error agents found${roleNote}. Nothing to clean up.`);
            }
            // Kill each candidate
            const results = [];
            for (const agent of candidates) {
                try {
                    await fetch(`http://127.0.0.1:${bridgePort}/kill-agent`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            agentName: agent.name,
                            reason: "cleanup",
                        }),
                    });
                    results.push(`${agent.name} (${agent.status})`);
                }
                catch {
                    results.push(`${agent.name} (failed to kill)`);
                }
            }
            return text(`Cleaned up ${results.length} agent(s): ${results.join(", ")}`);
        }
        catch (err) {
            return text(`Error: Failed to reach bridge server — ${err.message}`);
        }
    });
    // 17. create_flow — Create a new flow
    auditedTool("create_flow", "Create a new flow (pipeline). Nodes and edges are JSON strings matching FlowNode[] and FlowEdge[] types.", {
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
    }, async ({ name, description, nodes, edges, project_id }) => {
        const projectId = resolveProject(project_id);
        let parsedNodes;
        let parsedEdges;
        try {
            parsedNodes = JSON.parse(nodes || "[]");
            parsedEdges = JSON.parse(edges || "[]");
        }
        catch (e) {
            return text(`Error: Invalid JSON — ${e.message}`);
        }
        const now = Timestamp.now();
        const data = {
            name,
            description: description || "",
            nodes: parsedNodes,
            edges: parsedEdges,
            status: "draft",
            createdBy: "orchestrator",
            createdAt: now,
            updatedAt: now,
        };
        if (projectId)
            data.projectId = projectId; // flows can be project-less (draft)
        const ref = await addDoc(collection(db, "flows"), data);
        return text(`Flow created successfully!\n` +
            `  ID: ${ref.id}\n` +
            `  Name: ${name}\n` +
            `  Nodes: ${parsedNodes.length}\n` +
            `  Edges: ${parsedEdges.length}`);
    });
    // 18. get_flows — List project flows
    auditedTool("get_flows", "Get all flows for a project. Returns id, name, status, and node count.", {
        project_id: z.string().optional().describe("Project ID"),
    }, async ({ project_id }) => {
        const projectId = resolveProject(project_id);
        const constraints = [];
        if (projectId)
            constraints.push(where("projectId", "==", projectId));
        const q = query(collection(db, "flows"), ...constraints);
        const snap = await getDocs(q);
        if (snap.empty)
            return text("No flows found.");
        const lines = snap.docs.map((d) => {
            const f = d.data();
            const nodeCount = Array.isArray(f.nodes) ? f.nodes.length : 0;
            return `- [${f.status}] ${f.name} (nodes=${nodeCount}, id=${d.id})`;
        });
        return text(`Flows (${snap.size}):\n${lines.join("\n")}`);
    });
    // 19. update_flow — Update an existing flow
    auditedTool("update_flow", "Update a flow. Can change name, nodes, edges, and status (draft/running/paused/completed/failed).", {
        flow_id: z.string().describe("Flow ID"),
        name: z.string().optional().describe("New flow name"),
        nodes: z.string().optional().describe("FlowNode[] as JSON string"),
        edges: z.string().optional().describe("FlowEdge[] as JSON string"),
        status: z
            .enum(["draft", "running", "paused", "completed", "failed"])
            .optional()
            .describe("New flow status"),
    }, async ({ flow_id, name, nodes, edges, status }) => {
        const ref = doc(db, "flows", flow_id);
        const snap = await getDoc(ref);
        if (!snap.exists())
            return text(`Error: Flow ${flow_id} not found.`);
        const updates = {
            updatedAt: Timestamp.now(),
        };
        if (name !== undefined)
            updates.name = name;
        if (status !== undefined)
            updates.status = status;
        if (nodes !== undefined) {
            try {
                updates.nodes = JSON.parse(nodes);
            }
            catch (e) {
                return text(`Error: Invalid nodes JSON — ${e.message}`);
            }
        }
        if (edges !== undefined) {
            try {
                updates.edges = JSON.parse(edges);
            }
            catch (e) {
                return text(`Error: Invalid edges JSON — ${e.message}`);
            }
        }
        await updateDoc(ref, updates);
        const flowName = name || snap.data()?.name || flow_id;
        return text(`Flow '${flowName}' updated successfully.`);
    });
    // 20. add_pending_instruction — Queue a new-instruction for delivery to an
    //     agent's PTY on whatever machine currently hosts it. Used when the
    //     caller is not on the same machine as the target agent (team chat
    //     @mention, remote kanban operation, etc.), or as a robust fallback
    //     when same-machine direct PTY write is unavailable.
    auditedTool("add_pending_instruction", "Queue a new-instruction for delivery to an agent's PTY across machines. The marblo app hosting the agent picks it up via a Firestore listener and injects it into the PTY's stdin. Use for cross-machine team scenarios where direct PTY write is not possible.", {
        task_id: z
            .string()
            .optional()
            .describe("Task ID this instruction relates to. Omit for task-less directives (e.g. orchestrator-level commands)."),
        target_agent_id: z
            .string()
            .describe("Agent ID whose PTY should receive the instruction"),
        message: z.string().describe("Instruction text to inject into PTY stdin"),
        project_id: z
            .string()
            .optional()
            .describe("Project ID. Required when task_id is omitted; otherwise inferred from the task document."),
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
    }, async ({ task_id, target_agent_id, message, project_id, source_type, from_user_id, from_user_name, }) => {
        // Resolve project: prefer the task's projectId (authoritative), then
        // the explicit project_id arg, then MARBLO_PROJECT env. Missing
        // projectId is rejected because the security rules require it for
        // future per-project scoping.
        let projectId = "";
        if (task_id) {
            const task = await fetchTask(task_id);
            if (!task)
                return text(`Error: Task ${task_id} not found.`);
            projectId = task.projectId;
        }
        if (!projectId) {
            projectId = resolveProject(project_id);
        }
        if (!projectId) {
            return text("Error: projectId could not be resolved. Pass project_id or set MARBLO_PROJECT.");
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
    });
    // 21. get_pending_instructions — Fetch pending instructions for a given
    //     agent. The marblo app on each machine drains its local agents'
    //     queues via an onSnapshot listener (preferred) or this tool.
    auditedTool("get_pending_instructions", "Fetch pending instructions for an agent. By default returns only undelivered entries, ordered oldest-first.", {
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
    }, async ({ target_agent_id, include_delivered, limit }) => {
        const constraints = [
            where("targetAgentId", "==", target_agent_id),
        ];
        if (!include_delivered) {
            constraints.push(where("isDelivered", "==", false));
        }
        const q = query(collection(db, "pendingInstructions"), ...constraints);
        const snap = await getDocs(q);
        if (snap.empty)
            return text("No pending instructions.");
        const max = typeof limit === "number" && limit > 0 ? limit : 50;
        const docs = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => {
            const at = a.createdAt?.toMillis?.() ?? 0;
            const bt = b.createdAt?.toMillis?.() ?? 0;
            return at - bt;
        })
            .slice(0, max);
        const lines = docs.map((d) => {
            const delivered = d.isDelivered ? " [delivered]" : "";
            const who = d.fromUserName || d.fromUserId || "system";
            const src = d.sourceType || "other";
            return `- ${d.id} (from=${who}, src=${src})${delivered}: ${d.message}`;
        });
        return text(lines.join("\n"));
    });
    // 22. mark_instruction_delivered — Flip `isDelivered` to true after the
    //     marblo app has successfully injected the instruction into the PTY.
    //     This is the only mutation security rules permit on existing
    //     pendingInstructions documents (besides creation).
    auditedTool("mark_instruction_delivered", "Mark a pending instruction as delivered. Called by the marblo app after successful PTY stdin injection.", {
        instruction_id: z.string().describe("Pending instruction document ID"),
    }, async ({ instruction_id }) => {
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
    });
}
//# sourceMappingURL=tools.js.map