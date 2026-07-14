import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  Timestamp,
  type Firestore,
} from 'firebase/firestore';
import { topoSort, getIncomingEdges, getOutgoingEdges } from './topo-sort.js';
import { getExecutor } from './node-executors.js';
import type {
  Flow,
  FlowEdge,
  FlowNode,
  FlowEvent,
  FlowExecutionState,
  FlowRunStatus,
  HumanInput,
  LLMProvider,
  NodeContext,
  NodeExecutionResult,
} from './types.js';

// ── FlowRunner ───────────────────────────────────────────────

export class FlowRunner extends EventEmitter {
  private db: Firestore;
  private llmProvider?: LLMProvider;
  private states: Map<string, FlowExecutionState> = new Map();
  private flows: Map<string, Flow> = new Map();
  private humanResolvers: Map<string, (input: HumanInput) => void> = new Map();

  constructor(db: Firestore, llmProvider?: LLMProvider) {
    super();
    this.db = db;
    this.llmProvider = llmProvider;
  }

  /**
   * Run a flow from start to finish.
   */
  async run(flow: Flow, initialInputs?: Record<string, unknown>): Promise<FlowExecutionState> {
    const runId = randomUUID();

    const state: FlowExecutionState = {
      runId,
      flowId: flow.id,
      status: 'running',
      currentNodeIds: [],
      nodeResults: {},
      startedAt: new Date(),
    };

    this.states.set(runId, state);
    this.flows.set(runId, flow);
    await this.persistState(state);
    this.emit('event', { type: 'flow:started', runId, state } satisfies FlowEvent);

    try {
      // Build execution layers
      const layers = topoSort(flow.nodes, flow.edges);
      const nodeMap = new Map(flow.nodes.map(n => [n.id, n]));

      // Seed input nodes with initial inputs
      if (initialInputs) {
        for (const node of flow.nodes) {
          if (node.type === 'input') {
            state.nodeResults[`__initial_${node.id}`] = {
              status: 'success',
              output: initialInputs,
              startedAt: new Date(),
              completedAt: new Date(),
            };
          }
        }
      }

      // Track which nodes to skip (branch filtering) and which edges carry no
      // flow. deadEdges holds the not-taken branch edges so skip propagation
      // is join-aware: a node that re-converges on a still-live branch is kept
      // instead of being silently dropped while the flow reports completed.
      const skippedNodes = new Set<string>();
      const deadEdges = new Set<string>();

      // Execute layer by layer
      for (const layer of layers) {
        if (state.status === 'cancelled') break;

        // Wait if paused
        while (state.status === 'paused') {
          await this.waitForResume(runId);
        }
        if ((state.status as FlowRunStatus) === 'cancelled') break;

        // Filter out skipped nodes
        const activeNodes = layer.filter(id => !skippedNodes.has(id));
        state.currentNodeIds = activeNodes;
        await this.persistState(state);

        // Execute nodes in parallel within a layer
        const results = await Promise.all(
          activeNodes.map(nodeId => this.executeNode(runId, nodeId, nodeMap, flow.edges)),
        );

        // Process branch results — mark skipped downstream nodes
        for (let i = 0; i < activeNodes.length; i++) {
          const nodeId = activeNodes[i];
          const node = nodeMap.get(nodeId);
          const result = results[i];

          if (node?.type === 'branch' && result?.status === 'success') {
            const branchOutput = result.output as { branch?: string };
            const taken = branchOutput?.branch || 'true';
            const skipped = taken === 'true' ? 'false' : 'true';

            // The not-taken branch edges carry no flow — record them as dead
            // first so the join-aware propagation below sees the full picture,
            // then skip their subtrees (re-converging live nodes survive).
            const skippedEdges = getOutgoingEdges(nodeId, flow.edges, skipped);
            for (const edge of skippedEdges) {
              deadEdges.add(edge.id);
            }
            for (const edge of skippedEdges) {
              this.markDownstreamSkipped(edge.target, flow.edges, nodeMap, skippedNodes, state, deadEdges);
            }
          }
        }

        // Check for failures
        const failed = activeNodes.find(id => state.nodeResults[id]?.status === 'error');
        if (failed) {
          state.status = 'failed';
          state.completedAt = new Date();
          await this.persistState(state);
          this.emit('event', { type: 'flow:failed', runId, error: state.nodeResults[failed].error || 'Unknown error' } satisfies FlowEvent);
          return state;
        }
      }

      if (state.status === 'running') {
        state.status = 'completed';
        state.completedAt = new Date();
        state.currentNodeIds = [];
      }
      await this.persistState(state);
      this.emit('event', { type: 'flow:completed', runId, state } satisfies FlowEvent);
    } catch (e) {
      state.status = 'failed';
      state.completedAt = new Date();
      await this.persistState(state);
      this.emit('event', { type: 'flow:failed', runId, error: (e as Error).message } satisfies FlowEvent);
    }

    return state;
  }

  /**
   * Pause a running flow.
   */
  async pause(runId: string): Promise<void> {
    const state = this.states.get(runId);
    if (!state || state.status !== 'running') return;
    state.status = 'paused';
    await this.persistState(state);
    this.emit('event', { type: 'flow:paused', runId, pendingNodeId: state.currentNodeIds[0] || '' } satisfies FlowEvent);
  }

  /**
   * Resume a paused flow, optionally providing human input.
   */
  async resume(runId: string, humanInput?: HumanInput): Promise<FlowExecutionState> {
    const state = this.states.get(runId);
    if (!state) throw new Error(`Run ${runId} not found`);

    if (humanInput) {
      const resolver = this.humanResolvers.get(`${runId}:${humanInput.nodeId}`);
      if (resolver) {
        resolver(humanInput);
        this.humanResolvers.delete(`${runId}:${humanInput.nodeId}`);
      }
    }

    if (state.status === 'paused') {
      state.status = 'running';
      await this.persistState(state);
      this.emit('event', { type: 'flow:resumed', runId } satisfies FlowEvent);
      this.emit(`resume:${runId}`);
    }

    return state;
  }

  /**
   * Cancel a running or paused flow.
   */
  async cancel(runId: string): Promise<void> {
    const state = this.states.get(runId);
    if (!state) return;
    state.status = 'cancelled';
    state.completedAt = new Date();
    await this.persistState(state);

    // Resolve any pending human inputs
    for (const [key, resolver] of this.humanResolvers) {
      if (key.startsWith(runId)) {
        resolver({ nodeId: '', approved: false });
        this.humanResolvers.delete(key);
      }
    }

    this.emit(`resume:${runId}`);
    this.emit('event', { type: 'flow:cancelled', runId } satisfies FlowEvent);
  }

  /**
   * Get the current state of a run.
   */
  getState(runId: string): FlowExecutionState | undefined {
    return this.states.get(runId);
  }

  // ── Private ────────────────────────────────────────────────

  private async executeNode(
    runId: string,
    nodeId: string,
    nodeMap: Map<string, FlowNode>,
    edges: FlowEdge[],
  ): Promise<NodeExecutionResult> {
    const state = this.states.get(runId)!;
    const node = nodeMap.get(nodeId);

    if (!node) {
      const result: NodeExecutionResult = {
        status: 'error',
        output: null,
        error: `Node ${nodeId} not found`,
        startedAt: new Date(),
        completedAt: new Date(),
      };
      state.nodeResults[nodeId] = result;
      return result;
    }

    this.emit('event', { type: 'node:start', nodeId } satisfies FlowEvent);

    // Gather inputs from upstream nodes
    const inputs = this.gatherInputs(nodeId, edges, state);

    const ctx: NodeContext = {
      nodeId,
      nodeType: node.type,
      config: node.data.config || {},
      inputs,
      flowState: state,
    };

    try {
      const executor = getExecutor(node.type, this.llmProvider);
      const result = await executor(ctx);

      // Handle human nodes — pause and wait
      if (node.type === 'human' && result.status === 'success') {
        const output = result.output as { _humanPending?: boolean };
        if (output?._humanPending) {
          state.status = 'paused';
          state.nodeResults[nodeId] = result;
          await this.persistState(state);
          this.emit('event', { type: 'flow:paused', runId, pendingNodeId: nodeId } satisfies FlowEvent);

          // Wait for human input
          const humanInput = await this.waitForHumanInput(runId, nodeId);

          if (humanInput.approved) {
            const approvedResult: NodeExecutionResult = {
              status: 'success',
              output: { approved: true, humanData: humanInput.data, ...output },
              startedAt: result.startedAt,
              completedAt: new Date(),
            };
            state.nodeResults[nodeId] = approvedResult;
            this.emit('event', { type: 'node:complete', nodeId, result: approvedResult } satisfies FlowEvent);
            return approvedResult;
          } else {
            const rejectedResult: NodeExecutionResult = {
              status: 'error',
              output: { approved: false },
              error: 'Human rejected',
              startedAt: result.startedAt,
              completedAt: new Date(),
            };
            state.nodeResults[nodeId] = rejectedResult;
            this.emit('event', { type: 'node:error', nodeId, error: 'Human rejected' } satisfies FlowEvent);
            return rejectedResult;
          }
        }
      }

      state.nodeResults[nodeId] = result;
      await this.persistState(state);
      this.emit('event', { type: 'node:complete', nodeId, result } satisfies FlowEvent);
      return result;
    } catch (e) {
      const errorResult: NodeExecutionResult = {
        status: 'error',
        output: null,
        error: (e as Error).message,
        startedAt: new Date(),
        completedAt: new Date(),
      };
      state.nodeResults[nodeId] = errorResult;
      this.emit('event', { type: 'node:error', nodeId, error: (e as Error).message } satisfies FlowEvent);
      return errorResult;
    }
  }

  private gatherInputs(
    nodeId: string,
    edges: FlowEdge[],
    state: FlowExecutionState,
  ): Record<string, unknown> {
    const incoming = getIncomingEdges(nodeId, edges);
    const inputs: Record<string, unknown> = {};

    for (const edge of incoming) {
      const upstreamResult = state.nodeResults[edge.source];
      if (upstreamResult?.status === 'success' && upstreamResult.output != null) {
        const output = upstreamResult.output;
        if (typeof output === 'object' && output !== null && !Array.isArray(output)) {
          Object.assign(inputs, output);
        } else {
          inputs[edge.source] = output;
        }
      }
    }

    // Also include initial inputs if any
    const initialKey = `__initial_${nodeId}`;
    if (state.nodeResults[initialKey]?.status === 'success') {
      const initialOutput = state.nodeResults[initialKey].output;
      if (typeof initialOutput === 'object' && initialOutput !== null) {
        Object.assign(inputs, initialOutput);
      }
    }

    return inputs;
  }

  private markDownstreamSkipped(
    nodeId: string,
    edges: FlowEdge[],
    nodeMap: Map<string, FlowNode>,
    skippedNodes: Set<string>,
    state: FlowExecutionState,
    deadEdges: Set<string>,
  ): void {
    if (skippedNodes.has(nodeId)) return;

    // Join-aware: only skip this node when EVERY incoming edge is dead. If any
    // parent is still live or pending (feeding through a live edge), the node
    // can still execute once that parent resolves — dropping a re-converging
    // diamond/join branch here would silently delete it while the flow keeps
    // reporting completed. When a later parent does get skipped it re-invokes
    // this method, so the node is re-evaluated and skipped only if it truly
    // ends up with no live parent.
    const incoming = getIncomingEdges(nodeId, edges);
    if (incoming.some(edge => !this.isEdgeDead(edge, skippedNodes, deadEdges, state))) {
      return;
    }

    skippedNodes.add(nodeId);

    state.nodeResults[nodeId] = {
      status: 'skipped',
      output: null,
      startedAt: new Date(),
      completedAt: new Date(),
    };

    // This node is skipped → its outgoing edges now carry no flow. Mark them
    // dead before recursing so downstream join checks see them.
    const outgoing = getOutgoingEdges(nodeId, edges);
    for (const edge of outgoing) {
      deadEdges.add(edge.id);
    }
    for (const edge of outgoing) {
      this.markDownstreamSkipped(edge.target, edges, nodeMap, skippedNodes, state, deadEdges);
    }
  }

  /**
   * An incoming edge is "dead" (carries no flow) when it is a not-taken branch
   * edge, or when its source node was skipped or errored. A node whose every
   * incoming edge is dead can be skipped; a single live edge keeps it alive.
   */
  private isEdgeDead(
    edge: FlowEdge,
    skippedNodes: Set<string>,
    deadEdges: Set<string>,
    state: FlowExecutionState,
  ): boolean {
    if (deadEdges.has(edge.id)) return true;
    if (skippedNodes.has(edge.source)) return true;
    return state.nodeResults[edge.source]?.status === 'error';
  }

  private waitForResume(runId: string): Promise<void> {
    return new Promise(resolve => {
      this.once(`resume:${runId}`, resolve);
    });
  }

  private waitForHumanInput(runId: string, nodeId: string): Promise<HumanInput> {
    return new Promise(resolve => {
      this.humanResolvers.set(`${runId}:${nodeId}`, resolve);
    });
  }

  private async persistState(state: FlowExecutionState): Promise<void> {
    try {
      const ref = doc(this.db, 'flowRuns', state.runId);
      const data = {
        flowId: state.flowId,
        status: state.status,
        currentNodeIds: state.currentNodeIds,
        nodeResults: this.serializeNodeResults(state.nodeResults),
        startedAt: Timestamp.fromDate(state.startedAt),
        ...(state.completedAt ? { completedAt: Timestamp.fromDate(state.completedAt) } : {}),
        updatedAt: Timestamp.now(),
      };

      const existing = await getDoc(ref);
      if (existing.exists()) {
        await updateDoc(ref, data);
      } else {
        await setDoc(ref, data);
      }
    } catch {
      // Non-fatal: log but don't crash the flow
    }
  }

  private serializeNodeResults(
    results: Record<string, NodeExecutionResult>,
  ): Record<string, Record<string, unknown>> {
    const serialized: Record<string, Record<string, unknown>> = {};
    for (const [key, result] of Object.entries(results)) {
      serialized[key] = {
        status: result.status,
        output: result.output,
        error: result.error,
        startedAt: result.startedAt.toISOString(),
        completedAt: result.completedAt.toISOString(),
      };
    }
    return serialized;
  }
}
