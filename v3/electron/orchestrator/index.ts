import { initializeApp, getApps } from 'firebase/app';
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  doc,
  Timestamp,
} from 'firebase/firestore';
import { TaskDecomposer, type DecompositionResult } from './task-decomposer.js';
import { AutoRouter, type Agent, type RoutingResult } from './auto-router.js';
import { DAGResolver, type Task, type DAGStatus } from './dag-resolver.js';
import { DAGGenerator, type DecomposedTask } from './dag-generator.js';
import { FlowGenerator, type Flow } from './flow-generator.js';
import type { LLMConfig } from './llm-client.js';

// ── Types ────────────────────────────────────────────────────

export interface OrchestrateResult {
  decomposition: DecompositionResult;
  createdTaskIds: string[];
  routing: Map<string, RoutingResult | null>;
}

export interface OrchestratorConfig {
  llm?: Partial<LLMConfig>;
  autoAssign?: boolean;
}

// ── OrchestratorService ──────────────────────────────────────

export class OrchestratorService {
  private decomposer: TaskDecomposer;
  private router: AutoRouter;
  private resolver: DAGResolver;
  private dagGenerator: DAGGenerator;
  private flowGenerator: FlowGenerator;
  private db;
  private config: OrchestratorConfig;

  constructor(config?: OrchestratorConfig) {
    this.config = config ?? {};

    // Initialize Firebase
    const app = getApps().length === 0
      ? initializeApp({
          apiKey: process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || '',
          authDomain: process.env.FIREBASE_AUTH_DOMAIN || process.env.VITE_FIREBASE_AUTH_DOMAIN || '',
          projectId: process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || '',
          storageBucket: process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET || '',
          messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
          appId: process.env.FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID || '',
        })
      : getApps()[0];
    this.db = getFirestore(app);

    this.decomposer = new TaskDecomposer(config?.llm);
    this.router = new AutoRouter();
    this.resolver = new DAGResolver(this.db);
    this.dagGenerator = new DAGGenerator();
    this.flowGenerator = new FlowGenerator(config?.llm);
  }

  /**
   * Full pipeline: natural language → decompose → create in Firestore → route → watch.
   */
  async orchestrate(
    requirement: string,
    projectId: string,
    agents?: Agent[],
    context?: string,
  ): Promise<OrchestrateResult> {
    // Step 1: Decompose requirement into tasks + DAG
    const decomposition = await this.decomposer.decompose(requirement, context);

    // Step 2: Create tasks in Firestore
    const createdTaskIds = await this.createTasksInFirestore(
      decomposition,
      projectId,
    );

    // Step 3: Route tasks to agents (if agents provided)
    const routing = new Map<string, RoutingResult | null>();
    if (agents && agents.length > 0 && this.config.autoAssign !== false) {
      const routingMap = this.router.routeBatch(decomposition.tasks, agents);

      let taskIndex = 0;
      for (const [task, result] of routingMap) {
        const taskId = createdTaskIds[taskIndex];
        if (taskId) {
          routing.set(taskId, result);

          // Auto-claim if routing found an agent
          if (result) {
            await updateDoc(doc(this.db, 'tasks', taskId), {
              status: 'CLAIMED',
              claimedBy: result.agent.id,
              claimedAt: Timestamp.now(),
              updatedAt: Timestamp.now(),
            });
          }
        }
        taskIndex++;
      }
    }

    return { decomposition, createdTaskIds, routing };
  }

  /**
   * Execute an existing DAG: start watching for completions and auto-route ready tasks.
   */
  async executeDAG(
    projectId: string,
    agents?: Agent[],
    onTaskReady?: (task: Task) => void,
  ): Promise<() => void> {
    // Get current status and route any ready tasks
    const status = await this.resolver.getDAGStatus(projectId);

    if (agents && agents.length > 0) {
      for (const readyTask of status.ready) {
        const decomposed: DecomposedTask = {
          title: readyTask.title,
          description: readyTask.description,
          role: readyTask.role as DecomposedTask['role'],
          priority: readyTask.priority,
          depends_on: readyTask.dependsOn,
          scope: readyTask.scope,
          estimatedHours: 1,
        };

        const agent = this.router.route(decomposed, agents);
        if (agent) {
          await updateDoc(doc(this.db, 'tasks', readyTask.id), {
            status: 'CLAIMED',
            claimedBy: agent.id,
            claimedAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
          });
        }
      }
    }

    // Start watching for task completions
    const unsubscribe = this.resolver.watch(projectId, async (task) => {
      // Auto-route newly ready tasks
      if (agents && agents.length > 0) {
        const decomposed: DecomposedTask = {
          title: task.title,
          description: task.description,
          role: task.role as DecomposedTask['role'],
          priority: task.priority,
          depends_on: task.dependsOn,
          scope: task.scope,
          estimatedHours: 1,
        };

        const agent = this.router.route(decomposed, agents);
        if (agent) {
          await updateDoc(doc(this.db, 'tasks', task.id), {
            status: 'CLAIMED',
            claimedBy: agent.id,
            claimedAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
          });
        }
      }

      onTaskReady?.(task);
    });

    return unsubscribe;
  }

  /**
   * Get execution plan: topological sort layers showing parallel groups.
   */
  getExecutionPlan(tasks: DecomposedTask[]): string[][] {
    return this.decomposer.getExecutionPlan(tasks);
  }

  /**
   * Get DAG status for a project.
   */
  async getDAGStatus(projectId: string): Promise<DAGStatus> {
    return this.resolver.getDAGStatus(projectId);
  }

  /**
   * Find bottleneck tasks in a project.
   */
  async findBottlenecks(projectId: string): Promise<Task[]> {
    return this.resolver.findBottlenecks(projectId);
  }

  /**
   * Set routing rules for the auto-router.
   */
  setRoutingRules(rules: Parameters<AutoRouter['setRules']>[0]): void {
    this.router.setRules(rules);
  }

  /**
   * Generate a React Flow graph from a natural language pipeline description.
   */
  async generateFlow(description: string, context?: string): Promise<Flow> {
    return this.flowGenerator.generateFlow(description, context);
  }

  /**
   * Extend an existing flow with new nodes based on a requirement.
   */
  async extendFlow(existingFlow: Flow, requirement: string): Promise<Flow> {
    return this.flowGenerator.extendFlow(existingFlow, requirement);
  }

  // ── Private ────────────────────────────────────────────────

  /**
   * Persist decomposed tasks to Firestore with TASK-NNN → Firestore ID mapping.
   */
  private async createTasksInFirestore(
    decomposition: DecompositionResult,
    projectId: string,
  ): Promise<string[]> {
    const taskIds: string[] = [];
    const indexToId: Record<number, string> = {};

    for (let i = 0; i < decomposition.tasks.length; i++) {
      const task = decomposition.tasks[i];

      // Resolve TASK-NNN references to Firestore IDs
      const resolvedDeps: string[] = [];
      for (const dep of task.depends_on) {
        const match = dep.match(/^TASK-(\d+)$/i);
        if (match) {
          const idx = parseInt(match[1], 10) - 1;
          if (idx in indexToId) {
            resolvedDeps.push(indexToId[idx]);
          }
        } else {
          resolvedDeps.push(dep);
        }
      }

      const now = Timestamp.now();
      const data: Record<string, unknown> = {
        title: task.title,
        description: task.description,
        role: task.role,
        priority: task.priority,
        status: 'TODO',
        dependsOn: resolvedDeps,
        dependsOnCompleted: resolvedDeps.length === 0,
        claimedBy: null,
        claimedAt: null,
        scope: task.scope,
        comment: '',
        prUrl: '',
        hasPmFeedback: false,
        projectId,
        createdAt: now,
        updatedAt: now,
      };

      const docRef = await addDoc(collection(this.db, 'tasks'), data);
      taskIds.push(docRef.id);
      indexToId[i] = docRef.id;
    }

    return taskIds;
  }
}

// ── Re-exports ───────────────────────────────────────────────

export { TaskDecomposer } from './task-decomposer.js';
export { AutoRouter } from './auto-router.js';
export { DAGResolver } from './dag-resolver.js';
export { DAGGenerator } from './dag-generator.js';
export { FlowGenerator } from './flow-generator.js';
export { LLMClient, createLLMClientFromEnv } from './llm-client.js';
export type { DecomposedTask, DAG, FlowNode, FlowEdge } from './dag-generator.js';
export type { Flow } from './flow-generator.js';
export type { Agent, RoutingRule, RoutingResult } from './auto-router.js';
export type { Task, DAGStatus } from './dag-resolver.js';
export type { LLMConfig, ChatMessage } from './llm-client.js';
export type { DecompositionResult } from './task-decomposer.js';
