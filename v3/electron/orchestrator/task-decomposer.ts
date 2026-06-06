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

    // Build and validate DAG
    const dag = this.dagGenerator.buildDAG(tasks);
    const cycles = this.dagGenerator.detectCycles(dag);

    if (cycles) {
      // Auto-fix: remove edges that cause cycles
      const removedEdges = this.removeCyclicEdges(tasks, dag);
      if (removedEdges.length > 0) {
        // Rebuild DAG after fixing
        const fixedDag = this.dagGenerator.buildDAG(tasks);
        return {
          projectName: raw.projectName || "untitled",
          tasks,
          dag: { nodes: fixedDag.nodes, edges: fixedDag.edges },
        };
      }
    }

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

  /**
   * Remove edges that cause cycles by dropping the back-edge (higher→lower dependency).
   * Mutates the tasks array by removing offending depends_on entries.
   */
  private removeCyclicEdges(
    tasks: DecomposedTask[],
    dag: DAG,
  ): [string, string][] {
    const cycles = this.dagGenerator.detectCycles(dag);
    if (!cycles) return [];

    const removed: [string, string][] = [];
    const edgesToRemove = new Set<string>();

    for (const cycle of cycles) {
      // Remove the last edge in the cycle (the back-edge)
      if (cycle.length >= 2) {
        const from = cycle[cycle.length - 2];
        const to = cycle[cycle.length - 1];
        edgesToRemove.add(`${from}->${to}`);
        removed.push([from, to]);
      }
    }

    // Apply removals to tasks' depends_on
    for (const edgeKey of edgesToRemove) {
      const [from, to] = edgeKey.split("->");
      // Edge means "from must finish before to" → to depends_on from
      // So we need to remove `from` from `to`'s depends_on
      const toIndex = parseInt(to.replace(/^TASK-/i, ""), 10) - 1;
      if (toIndex >= 0 && toIndex < tasks.length) {
        tasks[toIndex].depends_on = tasks[toIndex].depends_on.filter(
          (d) => d.toUpperCase() !== from.toUpperCase(),
        );
      }
    }

    return removed;
  }
}
