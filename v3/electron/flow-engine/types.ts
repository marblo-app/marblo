// ── Flow Graph Types (mirroring src/types/flow.ts) ───────────

export type NodeType = 'input' | 'llm' | 'agent' | 'api' | 'human' | 'branch' | 'output' | 'code' | 'integration';

export interface FlowNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: {
    label: string;
    config: Record<string, unknown>;
  };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export type FlowStatus = 'draft' | 'ready' | 'running' | 'completed' | 'failed';

export interface Flow {
  id: string;
  projectId: string;
  name: string;
  description: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  status: FlowStatus;
}

// ── Execution Types ──────────────────────────────────────────

export type NodeExecutionStatus = 'success' | 'error' | 'skipped' | 'pending';

export interface NodeExecutionResult {
  status: NodeExecutionStatus;
  output: unknown;
  error?: string;
  startedAt: Date;
  completedAt: Date;
}

export type FlowRunStatus = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
// Note: 'paused' and 'cancelled' are runtime-only states managed by FlowRunner

export interface FlowExecutionState {
  runId: string;
  flowId: string;
  status: FlowRunStatus;
  currentNodeIds: string[];
  nodeResults: Record<string, NodeExecutionResult>;
  startedAt: Date;
  completedAt?: Date;
}

export interface NodeContext {
  nodeId: string;
  nodeType: NodeType;
  config: Record<string, unknown>;
  inputs: Record<string, unknown>;
  flowState: FlowExecutionState;
}

// ── LLM Interface (for dependency injection from orchestrator) ─

export interface LLMProvider {
  chat(messages: Array<{ role: string; content: string }>, model?: string): Promise<string>;
}

// ── Events ───────────────────────────────────────────────────

export type FlowEvent =
  | { type: 'node:start'; nodeId: string }
  | { type: 'node:complete'; nodeId: string; result: NodeExecutionResult }
  | { type: 'node:error'; nodeId: string; error: string }
  | { type: 'flow:paused'; runId: string; pendingNodeId: string }
  | { type: 'flow:resumed'; runId: string }
  | { type: 'flow:completed'; runId: string; state: FlowExecutionState }
  | { type: 'flow:failed'; runId: string; error: string }
  | { type: 'flow:cancelled'; runId: string };

export interface HumanInput {
  nodeId: string;
  approved: boolean;
  data?: unknown;
}
