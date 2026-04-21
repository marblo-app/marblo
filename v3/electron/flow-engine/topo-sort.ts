import type { FlowNode, FlowEdge } from './types.js';

/**
 * Topological sort of a flow graph using Kahn's algorithm.
 * Returns layers where each layer can execute in parallel.
 * Branch nodes emit edges with sourceHandle 'true'/'false' —
 * these are included in the sort but filtering happens at runtime.
 */
export function topoSort(nodes: FlowNode[], edges: FlowEdge[]): string[][] {
  const nodeIds = new Set(nodes.map(n => n.id));
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const id of nodeIds) {
    adj.set(id, []);
    inDegree.set(id, 0);
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    adj.get(edge.source)!.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const layers: string[][] = [];
  let queue = [...nodeIds].filter(id => (inDegree.get(id) ?? 0) === 0);
  let processed = 0;

  while (queue.length > 0) {
    layers.push([...queue]);

    const next: string[] = [];
    for (const id of queue) {
      processed++;
      for (const neighbor of adj.get(id) ?? []) {
        const deg = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, deg);
        if (deg === 0) next.push(neighbor);
      }
    }
    queue = next;
  }

  if (processed < nodeIds.size) {
    const cycles = detectCycles(nodes, edges);
    throw new Error(
      `Flow contains cycles — cannot execute. Cycles: ${JSON.stringify(cycles)}`,
    );
  }

  return layers;
}

/**
 * Detect cycles using DFS coloring.
 * Returns arrays of node IDs forming cycles, or empty array if acyclic.
 */
export function detectCycles(nodes: FlowNode[], edges: FlowEdge[]): string[][] {
  const nodeIds = new Set(nodes.map(n => n.id));
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const edge of edges) {
    if (adj.has(edge.source)) adj.get(edge.source)!.push(edge.target);
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const cycles: string[][] = [];

  for (const id of nodeIds) {
    color.set(id, WHITE);
    parent.set(id, null);
  }

  const dfs = (u: string): void => {
    color.set(u, GRAY);
    for (const v of adj.get(u) ?? []) {
      if (color.get(v) === GRAY) {
        const cycle: string[] = [v];
        let cur = u;
        while (cur !== v) {
          cycle.push(cur);
          cur = parent.get(cur) ?? v;
        }
        cycle.push(v);
        cycle.reverse();
        cycles.push(cycle);
      } else if (color.get(v) === WHITE) {
        parent.set(v, u);
        dfs(v);
      }
    }
    color.set(u, BLACK);
  };

  for (const id of nodeIds) {
    if (color.get(id) === WHITE) dfs(id);
  }

  return cycles;
}

/**
 * Get outgoing edges from a node, optionally filtered by sourceHandle.
 */
export function getOutgoingEdges(
  nodeId: string,
  edges: FlowEdge[],
  sourceHandle?: string,
): FlowEdge[] {
  return edges.filter(
    e => e.source === nodeId && (sourceHandle === undefined || e.sourceHandle === sourceHandle),
  );
}

/**
 * Get incoming edges to a node.
 */
export function getIncomingEdges(nodeId: string, edges: FlowEdge[]): FlowEdge[] {
  return edges.filter(e => e.target === nodeId);
}
