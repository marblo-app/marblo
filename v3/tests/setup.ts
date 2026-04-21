import type {
  FlowNode,
  FlowEdge,
  Flow,
  NodeContext,
  FlowExecutionState,
  LLMProvider,
} from '../electron/flow-engine/types';
import type { DecomposedTask } from '../electron/orchestrator/dag-generator';
import type { Agent } from '../electron/orchestrator/auto-router';

// ── Test Helpers ─────────────────────────────────────────────

export function makeNode(
  id: string,
  type: FlowNode['type'],
  config: Record<string, unknown> = {},
): FlowNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: { label: `${type}: ${id}`, config },
  };
}

export function makeEdge(
  source: string,
  target: string,
  sourceHandle?: string,
): FlowEdge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    ...(sourceHandle ? { sourceHandle } : {}),
  };
}

export function makeFlow(
  nodes: FlowNode[],
  edges: FlowEdge[],
  overrides?: Partial<Flow>,
): Flow {
  return {
    id: 'test-flow',
    projectId: 'test-project',
    name: 'Test Flow',
    description: 'Test',
    nodes,
    edges,
    status: 'ready',
    ...overrides,
  };
}

export function makeNodeContext(
  overrides: Partial<NodeContext> = {},
): NodeContext {
  return {
    nodeId: 'test-node',
    nodeType: 'input',
    config: {},
    inputs: {},
    flowState: {
      runId: 'test-run',
      flowId: 'test-flow',
      status: 'running',
      currentNodeIds: [],
      nodeResults: {},
      startedAt: new Date(),
    },
    ...overrides,
  };
}

export function makeTask(overrides: Partial<DecomposedTask> = {}): DecomposedTask {
  return {
    title: 'Test Task',
    description: 'A test task',
    role: 'backend',
    priority: 3,
    depends_on: [],
    scope: [],
    estimatedHours: 1,
    ...overrides,
  };
}

export function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    role: 'backend',
    tags: [],
    status: 'idle',
    currentTaskCount: 0,
    maxConcurrentTasks: 3,
    ...overrides,
  };
}

export function mockLLMProvider(response: string = 'mock response'): LLMProvider {
  return {
    chat: async () => response,
  };
}
