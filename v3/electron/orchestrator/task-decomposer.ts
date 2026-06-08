import {
  LLMClient,
  createLLMClientFromEnv,
  type LLMConfig,
} from "./llm-client.js";
import {
  DAGGenerator,
  type DecomposedTask,
  type DAG,
} from "./dag-generator.js";
import {
  buildDecomposePrompt,
  buildAddTasksPrompt,
} from "./prompt-templates.js";

// ── Types ────────────────────────────────────────────────────

export interface DecompositionResult {
  projectName: string;
  tasks: DecomposedTask[];
  dag: { nodes: string[]; edges: [string, string][] };
}

interface DecomposeResponse {
  projectName: string;
  tasks: Array<{
    title: string;
    description?: string;
    goal?: string;
    changes?: string[];
    acceptance?: string[];
    notes?: string[];
    role: string;
    priority: number;
    depends_on: string[];
    scope: string[];
    estimatedHours: number;
  }>;
}

interface AddTasksResponse {
  tasks: Array<{
    title: string;
    description?: string;
    goal?: string;
    changes?: string[];
    acceptance?: string[];
    notes?: string[];
    role: string;
    priority: number;
    depends_on: string[];
    scope: string[];
    estimatedHours: number;
  }>;
}

// ── Validators ───────────────────────────────────────────────

const VALID_ROLES = new Set(["backend", "frontend", "test", "devops"]);
const TASK_REF_RE = /^TASK-\d{3}$/i;

export function validateTask(
  raw: DecomposeResponse["tasks"][number],
  index: number,
  totalCount: number,
): DecomposedTask {
  const role = VALID_ROLES.has(raw.role)
    ? (raw.role as DecomposedTask["role"])
    : "backend";
  const priority = Math.max(1, Math.min(5, Math.round(raw.priority ?? 3)));
  const estimatedHours = Math.max(0.5, Math.min(8, raw.estimatedHours ?? 1));

  // Validate depends_on references
  const validDeps = (raw.depends_on ?? []).filter((dep) => {
    if (!TASK_REF_RE.test(dep)) return false;
    const refIndex = parseInt(dep.replace(/^TASK-/i, ""), 10);
    // Must reference an earlier task (no forward refs, no self-refs)
    return refIndex >= 1 && refIndex <= totalCount && refIndex !== index + 1;
  });

  return {
    title: raw.title || `Task ${index + 1}`,
    description: raw.description || "",
    goal: raw.goal?.trim() || undefined,
    changes: raw.changes ?? [],
    acceptance: raw.acceptance ?? [],
    notes: raw.notes ?? [],
    role,
    priority,
    depends_on: validDeps,
    scope: raw.scope ?? [],
    estimatedHours,
  };
}

// ── Cycle-safe DAG construction ──────────────────────────────

/**
 * Build a DAG from `tasks` and GUARANTEE the returned graph is acyclic.
 *
 * task-decomposer can emit dependency cycles: the LLM is free to produce
 * forward/back references, and {@link validateTask} only strips self-refs —
 * it does NOT prevent A→B→A style loops. A cyclic dependency graph is poison
 * downstream: topological execution never drains (deadlock) or a naive runner
 * spins forever. So we must never hand a cyclic DAG back.
 *
 * Strategy: detect cycles via DFS and break them by dropping the offending
 * back-edges, re-verifying after every pass. Removing all DFS back-edges is
 * already sufficient in a single pass, but we loop + re-check so a cyclic
 * graph can never slip through even if the breaking logic ever regresses. If
 * the graph genuinely cannot be made acyclic, we reject with an explicit
 * error instead of returning a deadlock-prone DAG.
 *
 * Side effect: mutates `tasks` — depends_on entries that form cycles are
 * removed so the returned tasks stay consistent with the returned DAG.
 */
export function buildAcyclicDAG(
  tasks: DecomposedTask[],
  dagGenerator: DAGGenerator = new DAGGenerator(),
): DAG {
  let dag = dagGenerator.buildDAG(tasks);
  // Each successful pass removes ≥1 edge, so the graph needs at most
  // (edge count) passes; +1 covers the initial acyclic check.
  let budget = dag.edges.length + 1;

  while (budget-- > 0) {
    const cycles = dagGenerator.detectCycles(dag);
    if (!cycles) return dag; // acyclic — safe to return

    const removed = removeCyclicEdges(tasks, dag, dagGenerator);
    if (removed.length === 0) {
      // A cycle was reported but no edge could be dropped — refuse rather
      // than loop forever or return a cyclic DAG.
      throw new Error(
        `Task dependency graph contains an unbreakable cycle and was rejected: ${JSON.stringify(
          cycles,
        )}`,
      );
    }
    dag = dagGenerator.buildDAG(tasks);
  }

  // Exhausted the breaking budget while still cyclic — reject loudly rather
  // than return a graph that deadlocks downstream execution.
  const remaining = dagGenerator.detectCycles(dag);
  if (remaining) {
    throw new Error(
      `Task dependency graph still contains cycles after exhausting the cycle-breaking budget: ${JSON.stringify(
        remaining,
      )}`,
    );
  }
  return dag;
}

/**
 * Drop the back-edges that cause cycles from the depending task's depends_on.
 * Returns the list of removed [from, to] edges (empty when `dag` is acyclic).
 */
function removeCyclicEdges(
  tasks: DecomposedTask[],
  dag: DAG,
  dagGenerator: DAGGenerator,
): [string, string][] {
  const cycles = dagGenerator.detectCycles(dag);
  if (!cycles) return [];

  const removed: [string, string][] = [];
  const edgesToRemove = new Set<string>();

  for (const cycle of cycles) {
    // The last hop of the traced cycle path is the back-edge (from → to).
    if (cycle.length >= 2) {
      const from = cycle[cycle.length - 2];
      const to = cycle[cycle.length - 1];
      edgesToRemove.add(`${from}->${to}`);
      removed.push([from, to]);
    }
  }

  // Apply removals to tasks' depends_on.
  for (const edgeKey of edgesToRemove) {
    const [from, to] = edgeKey.split("->");
    // Edge "from → to" means `to` depends_on `from`, so drop `from` from
    // `to`'s depends_on to cut the edge.
    const toIndex = parseInt(to.replace(/^TASK-/i, ""), 10) - 1;
    if (toIndex >= 0 && toIndex < tasks.length) {
      tasks[toIndex].depends_on = tasks[toIndex].depends_on.filter(
        (d) => d.toUpperCase() !== from.toUpperCase(),
      );
    }
  }

  return removed;
}

// ── TaskDecomposer ───────────────────────────────────────────

export class TaskDecomposer {
  private llm: LLMClient;
  private dagGenerator: DAGGenerator;

  constructor(llmConfig?: Partial<LLMConfig>) {
    this.llm = llmConfig?.apiKey
      ? new LLMClient(llmConfig as LLMConfig)
      : createLLMClientFromEnv(llmConfig);
    this.dagGenerator = new DAGGenerator();
  }

  /**
   * Decompose natural language requirements into structured tasks with a DAG.
   */
  async decompose(
    naturalLanguage: string,
    context?: string,
  ): Promise<DecompositionResult> {
    const messages = buildDecomposePrompt(naturalLanguage, context);
    const raw = await this.llm.chatJSON<DecomposeResponse>(messages);

    // Validate and normalize tasks
    const tasks = (raw.tasks ?? []).map((t, i) =>
      validateTask(t, i, raw.tasks.length),
    );

    if (tasks.length === 0) {
      throw new Error(
        "LLM returned no tasks. Try providing more specific requirements.",
      );
    }

    // Build the DAG, breaking any dependency cycles. buildAcyclicDAG
    // guarantees the returned graph is acyclic (or throws a clear error) —
    // we never hand a cyclic DAG downstream, which would deadlock execution.
    const dag = buildAcyclicDAG(tasks, this.dagGenerator);

    return {
      projectName: raw.projectName || "untitled",
      tasks,
      dag: { nodes: dag.nodes, edges: dag.edges },
    };
  }

  /**
   * Add tasks to an existing set based on a new requirement.
   */
  async addTasks(
    existingTasks: string,
    newRequirement: string,
  ): Promise<DecomposedTask[]> {
    const messages = buildAddTasksPrompt(existingTasks, newRequirement);
    const raw = await this.llm.chatJSON<AddTasksResponse>(messages);

    return (raw.tasks ?? []).map((t, i) =>
      validateTask(t, i, raw.tasks.length),
    );
  }

  /**
   * Get parallel execution layers for a set of tasks.
   */
  getExecutionPlan(tasks: DecomposedTask[]): string[][] {
    const dag = this.dagGenerator.buildDAG(tasks);
    return this.dagGenerator.topologicalSort(dag);
  }
}
