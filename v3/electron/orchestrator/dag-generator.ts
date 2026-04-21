// ── Types ────────────────────────────────────────────────────

export interface DecomposedTask {
  title: string;
  description: string;
  role: 'backend' | 'frontend' | 'test' | 'devops';
  priority: number;
  depends_on: string[];
  scope: string[];
  estimatedHours: number;
}

export interface DAG {
  /** TASK-NNN identifiers */
  nodes: string[];
  /** [from, to] directed edges — "from" must complete before "to" */
  edges: [string, string][];
  /** Node label mapping */
  labels: Record<string, string>;
}

export interface FlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: { label: string; role: string; status: string };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  animated: boolean;
}

// ── DAG Generator ────────────────────────────────────────────

export class DAGGenerator {
  /**
   * Build a DAG from a list of decomposed tasks.
   * Task indices are 0-based; TASK-NNN references are 1-based.
   */
  buildDAG(tasks: DecomposedTask[]): DAG {
    const nodes: string[] = [];
    const edges: [string, string][] = [];
    const labels: Record<string, string> = {};

    for (let i = 0; i < tasks.length; i++) {
      const nodeId = `TASK-${String(i + 1).padStart(3, '0')}`;
      nodes.push(nodeId);
      labels[nodeId] = tasks[i].title;

      for (const dep of tasks[i].depends_on) {
        const normalizedDep = dep.toUpperCase();
        edges.push([normalizedDep, nodeId]);
      }
    }

    return { nodes, edges, labels };
  }

  /**
   * Topological sort using Kahn's algorithm.
   * Returns layers of tasks that can be executed in parallel within each layer.
   * Throws if a cycle is detected.
   */
  topologicalSort(dag: DAG): string[][] {
    // Build adjacency list and in-degree map
    const adj = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    for (const node of dag.nodes) {
      adj.set(node, []);
      inDegree.set(node, 0);
    }

    for (const [from, to] of dag.edges) {
      if (!adj.has(from) || !inDegree.has(to)) continue;
      adj.get(from)!.push(to);
      inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
    }

    // Kahn's algorithm with layer tracking
    const layers: string[][] = [];
    let queue = dag.nodes.filter(n => (inDegree.get(n) ?? 0) === 0);
    let processed = 0;

    while (queue.length > 0) {
      layers.push([...queue]);
      const nextQueue: string[] = [];

      for (const node of queue) {
        processed++;
        for (const neighbor of adj.get(node) ?? []) {
          const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
          inDegree.set(neighbor, newDeg);
          if (newDeg === 0) {
            nextQueue.push(neighbor);
          }
        }
      }

      queue = nextQueue;
    }

    if (processed < dag.nodes.length) {
      const cycles = this.detectCycles(dag);
      const cycleInfo = cycles ? ` Cycles: ${JSON.stringify(cycles)}` : '';
      throw new Error(`DAG contains cycles — topological sort failed.${cycleInfo}`);
    }

    return layers;
  }

  /**
   * Detect cycles using DFS.
   * Returns an array of cycles (each cycle is a path), or null if acyclic.
   */
  detectCycles(dag: DAG): string[][] | null {
    const adj = new Map<string, string[]>();
    for (const node of dag.nodes) {
      adj.set(node, []);
    }
    for (const [from, to] of dag.edges) {
      if (adj.has(from)) adj.get(from)!.push(to);
    }

    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    const parent = new Map<string, string | null>();
    const cycles: string[][] = [];

    for (const node of dag.nodes) {
      color.set(node, WHITE);
      parent.set(node, null);
    }

    const dfs = (u: string): void => {
      color.set(u, GRAY);
      for (const v of adj.get(u) ?? []) {
        if (color.get(v) === GRAY) {
          // Found a cycle — trace back
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

    for (const node of dag.nodes) {
      if (color.get(node) === WHITE) {
        dfs(node);
      }
    }

    return cycles.length > 0 ? cycles : null;
  }

  /**
   * Convert DAG to React Flow compatible nodes and edges for visualization.
   * Arranges nodes in layers based on topological sort.
   */
  toReactFlowGraph(dag: DAG): { nodes: FlowNode[]; edges: FlowEdge[] } {
    let layers: string[][];
    try {
      layers = this.topologicalSort(dag);
    } catch {
      // If cycles exist, put each node in its own layer
      layers = dag.nodes.map(n => [n]);
    }

    const NODE_WIDTH = 200;
    const NODE_HEIGHT = 60;
    const LAYER_GAP_X = 280;
    const NODE_GAP_Y = 100;

    const flowNodes: FlowNode[] = [];

    for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
      const layer = layers[layerIdx];
      const layerHeight = layer.length * NODE_GAP_Y;
      const startY = -layerHeight / 2 + NODE_GAP_Y / 2;

      for (let nodeIdx = 0; nodeIdx < layer.length; nodeIdx++) {
        const nodeId = layer[nodeIdx];
        flowNodes.push({
          id: nodeId,
          type: 'default',
          position: {
            x: layerIdx * LAYER_GAP_X,
            y: startY + nodeIdx * NODE_GAP_Y,
          },
          data: {
            label: dag.labels[nodeId] || nodeId,
            role: '',
            status: 'TODO',
          },
        });
      }
    }

    const flowEdges: FlowEdge[] = dag.edges.map(([from, to], i) => ({
      id: `edge-${i}`,
      source: from,
      target: to,
      animated: true,
    }));

    return { nodes: flowNodes, edges: flowEdges };
  }
}
