import {
  collection,
  doc,
  addDoc,
  updateDoc,
  query,
  where,
  onSnapshot,
  Timestamp,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import type { FlowRunner } from './flow-runner.js';
import type { Flow, FlowEvent, FlowNode } from './types.js';

// ── KanbanBridge ─────────────────────────────────────────────
// Bridges FlowRunner events ↔ Firestore tasks collection.
// Loosely coupled: only depends on FlowRunner's EventEmitter interface.

interface BridgedTask {
  taskId: string;
  flowId: string;
  nodeId: string;
  runId: string;
}

export class KanbanBridge {
  private db: Firestore;
  private runner: FlowRunner;
  private bridgedTasks: Map<string, BridgedTask> = new Map(); // key: "runId:nodeId"
  private flowCache: Map<string, Flow> = new Map();
  private taskListeners: Unsubscribe[] = [];
  private disposed = false;

  constructor(db: Firestore, runner: FlowRunner) {
    this.db = db;
    this.runner = runner;
  }

  /**
   * Start listening for flow events and Kanban task changes.
   */
  attach(): void {
    this.runner.on('event', this.handleFlowEvent);
  }

  /**
   * Stop listening and clean up.
   */
  detach(): void {
    this.disposed = true;
    this.runner.off('event', this.handleFlowEvent);
    for (const unsub of this.taskListeners) {
      unsub();
    }
    this.taskListeners = [];
    this.bridgedTasks.clear();
    this.flowCache.clear();
  }

  /**
   * Register a flow so the bridge can look up node metadata.
   */
  registerFlow(flow: Flow): void {
    this.flowCache.set(flow.id, flow);
  }

  /**
   * Start watching Kanban tasks linked to a specific flow for DONE status changes.
   * When a linked task is marked DONE externally (e.g., by PM on the board),
   * the bridge resumes the waiting flow node.
   */
  watchKanbanForFlow(flowId: string, runId: string): Unsubscribe {
    const q = query(
      collection(this.db, 'tasks'),
      where('flowId', '==', flowId),
    );

    const unsub = onSnapshot(q, (snapshot) => {
      if (this.disposed) return;

      for (const change of snapshot.docChanges()) {
        if (change.type !== 'modified') continue;

        const data = change.doc.data();
        if (data.status !== 'DONE') continue;

        const nodeId = data.flowNodeId as string | undefined;
        if (!nodeId) continue;

        // Check if this node is waiting for completion
        const key = `${runId}:${nodeId}`;
        const bridged = this.bridgedTasks.get(key);
        if (!bridged) continue;

        // Task marked DONE → resume the flow at this node
        this.runner.resume(runId, {
          nodeId,
          approved: true,
          data: { taskId: change.doc.id, completedViaKanban: true },
        }).catch(() => {
          // Non-fatal: flow may have already moved past this node
        });

        this.bridgedTasks.delete(key);
      }
    });

    this.taskListeners.push(unsub);
    return unsub;
  }

  // ── Private ────────────────────────────────────────────────

  private handleFlowEvent = async (event: FlowEvent): Promise<void> => {
    if (this.disposed) return;

    switch (event.type) {
      case 'node:start':
        await this.onNodeStart(event);
        break;
      case 'node:complete':
        await this.onNodeComplete(event);
        break;
      case 'node:error':
        await this.onNodeError(event);
        break;
    }
  };

  /**
   * When an agent node starts → create a Kanban task.
   */
  private async onNodeStart(event: Extract<FlowEvent, { type: 'node:start' }>): Promise<void> {
    // Find the flow and node metadata
    const { node, flow, runId } = this.resolveNode(event.nodeId);
    if (!node || !flow) return;

    // Only create tasks for agent nodes
    if (node.type !== 'agent') return;

    const config = node.data.config || {};
    const role = (config.role as string) || 'backend';
    const title = node.data.label || `Flow task: ${node.id}`;

    try {
      const taskData = {
        projectId: flow.projectId,
        title,
        description: `자동 생성: Flow "${flow.name}" → ${node.data.label}`,
        status: 'IN_PROGRESS',
        role,
        priority: 3,
        dependsOn: [],
        dependsOnCompleted: true,
        claimedBy: config.agentId ?? null,
        claimedAt: config.agentId ? Timestamp.now() : null,
        scope: [],
        comment: '',
        prUrl: '',
        hasPmFeedback: false,
        flowId: flow.id,
        flowNodeId: node.id,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };

      const ref = await addDoc(collection(this.db, 'tasks'), taskData);

      if (runId) {
        const key = `${runId}:${node.id}`;
        this.bridgedTasks.set(key, {
          taskId: ref.id,
          flowId: flow.id,
          nodeId: node.id,
          runId,
        });
      }
    } catch {
      // Non-fatal: log but don't crash the flow
    }
  }

  /**
   * When a human node completes (approved) → mark linked task DONE.
   */
  private async onNodeComplete(
    event: Extract<FlowEvent, { type: 'node:complete' }>,
  ): Promise<void> {
    const { node, flow, runId } = this.resolveNode(event.nodeId);
    if (!node || !flow) return;

    // For human node approval, find and update the linked task
    if (node.type === 'human') {
      const output = event.result.output as Record<string, unknown> | null;
      if (output?.approved) {
        await this.updateLinkedTaskStatus(flow.id, node.id, 'DONE');
      }
    }

    // For agent node completion, also mark DONE
    if (node.type === 'agent') {
      await this.updateLinkedTaskStatus(flow.id, node.id, 'DONE');
      // Clean up bridged task entry
      if (runId) {
        this.bridgedTasks.delete(`${runId}:${node.id}`);
      }
    }
  }

  /**
   * When a node errors → mark linked task FAILED.
   */
  private async onNodeError(
    event: Extract<FlowEvent, { type: 'node:error' }>,
  ): Promise<void> {
    const { flow } = this.resolveNode(event.nodeId);
    if (!flow) return;

    await this.updateLinkedTaskStatus(flow.id, event.nodeId, 'FAILED');
  }

  /**
   * Find and update a task linked to a specific flow node.
   */
  private async updateLinkedTaskStatus(
    flowId: string,
    nodeId: string,
    status: string,
  ): Promise<void> {
    // Find the bridged task by flowId + nodeId
    for (const bridged of this.bridgedTasks.values()) {
      if (bridged.flowId === flowId && bridged.nodeId === nodeId) {
        try {
          const ref = doc(this.db, 'tasks', bridged.taskId);
          await updateDoc(ref, {
            status,
            updatedAt: Timestamp.now(),
          });
        } catch {
          // Non-fatal
        }
        return;
      }
    }
  }

  /**
   * Resolve a nodeId to its FlowNode, parent Flow, and current runId.
   */
  private resolveNode(nodeId: string): {
    node: FlowNode | undefined;
    flow: Flow | undefined;
    runId: string | undefined;
  } {
    for (const [flowId, flow] of this.flowCache) {
      const node = flow.nodes.find((n) => n.id === nodeId);
      if (node) {
        // Find associated runId from bridgedTasks or runner state
        let runId: string | undefined;
        for (const bridged of this.bridgedTasks.values()) {
          if (bridged.flowId === flowId) {
            runId = bridged.runId;
            break;
          }
        }
        return { node, flow, runId };
      }
    }
    return { node: undefined, flow: undefined, runId: undefined };
  }
}
