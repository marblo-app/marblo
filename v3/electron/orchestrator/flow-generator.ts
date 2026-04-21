import { LLMClient, createLLMClientFromEnv, type LLMConfig } from './llm-client.js';
import { buildFlowGenerationPrompt, buildFlowExtensionPrompt } from './prompt-templates.js';
import type { FlowNode, FlowEdge } from './dag-generator.js';

// ── Types ────────────────────────────────────────────────────

export interface Flow {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

interface LLMFlowResponse {
  nodes: Array<{
    id: string;
    type?: string;
    data: Record<string, unknown>;
    parentId?: string;
  }>;
  edges: Array<{
    id?: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
    label?: string;
    animated?: boolean;
  }>;
}

// ── FlowGenerator ────────────────────────────────────────────

export class FlowGenerator {
  private llm: LLMClient;

  constructor(llmConfig?: Partial<LLMConfig>) {
    this.llm = llmConfig?.apiKey
      ? new LLMClient(llmConfig as LLMConfig)
      : createLLMClientFromEnv(llmConfig);
  }

  /**
   * Generate a React Flow graph from a natural language pipeline description.
   */
  async generateFlow(
    description: string,
    context?: string,
  ): Promise<Flow> {
    const messages = buildFlowGenerationPrompt(description, context);
    const raw = await this.llm.chatJSON<LLMFlowResponse>(messages);

    const nodes = this.normalizeNodes(raw.nodes ?? []);
    const edges = this.normalizeEdges(raw.edges ?? []);
    const laid = this.layoutNodes(nodes, edges);

    return { nodes: laid, edges };
  }

  /**
   * Extend an existing flow with new nodes based on a requirement.
   */
  async extendFlow(
    existingFlow: Flow,
    requirement: string,
  ): Promise<Flow> {
    const messages = buildFlowExtensionPrompt(existingFlow, requirement);
    const raw = await this.llm.chatJSON<LLMFlowResponse>(messages);

    const newNodes = this.normalizeNodes(raw.nodes ?? []);
    const newEdges = this.normalizeEdges(raw.edges ?? []);

    // Merge with existing, avoiding duplicate IDs
    const existingNodeIds = new Set(existingFlow.nodes.map(n => n.id));
    const existingEdgeIds = new Set(existingFlow.edges.map(e => e.id));

    const mergedNodes = [
      ...existingFlow.nodes,
      ...newNodes.filter(n => !existingNodeIds.has(n.id)),
    ];
    const mergedEdges = [
      ...existingFlow.edges,
      ...newEdges.filter(e => !existingEdgeIds.has(e.id)),
    ];

    const laid = this.layoutNodes(mergedNodes, mergedEdges);
    return { nodes: laid, edges: mergedEdges };
  }

  /**
   * Dagre-style layered layout using topological sort.
   * Assigns x/y positions based on dependency layers.
   */
  layoutNodes(nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] {
    if (nodes.length === 0) return [];

    const LAYER_GAP_X = 300;
    const NODE_GAP_Y = 120;

    // Build adjacency and in-degree
    const adj = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    for (const node of nodes) {
      adj.set(node.id, []);
      inDegree.set(node.id, 0);
    }

    for (const edge of edges) {
      if (adj.has(edge.source) && inDegree.has(edge.target)) {
        adj.get(edge.source)!.push(edge.target);
        inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
      }
    }

    // Kahn's algorithm for layer assignment
    const layers: string[][] = [];
    let queue = nodes
      .map(n => n.id)
      .filter(id => (inDegree.get(id) ?? 0) === 0);

    const assigned = new Set<string>();

    while (queue.length > 0) {
      layers.push([...queue]);
      for (const id of queue) assigned.add(id);

      const nextQueue: string[] = [];
      for (const nodeId of queue) {
        for (const neighbor of adj.get(nodeId) ?? []) {
          const deg = (inDegree.get(neighbor) ?? 1) - 1;
          inDegree.set(neighbor, deg);
          if (deg === 0 && !assigned.has(neighbor)) {
            nextQueue.push(neighbor);
          }
        }
      }
      queue = nextQueue;
    }

    // Place unassigned nodes (cycles or disconnected) in a final layer
    const unassigned = nodes
      .map(n => n.id)
      .filter(id => !assigned.has(id));
    if (unassigned.length > 0) {
      layers.push(unassigned);
    }

    // Build position map
    const positionMap = new Map<string, { x: number; y: number }>();

    for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
      const layer = layers[layerIdx];
      const totalHeight = layer.length * NODE_GAP_Y;
      const startY = -totalHeight / 2 + NODE_GAP_Y / 2;

      for (let nodeIdx = 0; nodeIdx < layer.length; nodeIdx++) {
        positionMap.set(layer[nodeIdx], {
          x: layerIdx * LAYER_GAP_X,
          y: startY + nodeIdx * NODE_GAP_Y,
        });
      }
    }

    // Apply positions to nodes
    return nodes.map(node => ({
      ...node,
      position: positionMap.get(node.id) ?? node.position,
    }));
  }

  // ── Private helpers ────────────────────────────────────────

  private normalizeNodes(
    raw: LLMFlowResponse['nodes'],
  ): FlowNode[] {
    return raw.map((n, i) => ({
      id: n.id || `node-${i + 1}`,
      type: n.type || 'default',
      position: { x: 0, y: 0 }, // will be set by layout
      data: {
        label: (n.data?.label as string) || n.id || `Node ${i + 1}`,
        role: (n.data?.role as string) || '',
        status: (n.data?.status as string) || 'TODO',
        ...n.data,
      },
    }));
  }

  private normalizeEdges(
    raw: LLMFlowResponse['edges'],
  ): FlowEdge[] {
    return raw.map((e, i) => ({
      id: e.id || `edge-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      animated: e.animated ?? true,
      ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
      ...(e.targetHandle ? { targetHandle: e.targetHandle } : {}),
      ...(e.label ? { label: e.label } : {}),
    }));
  }
}
