export type FlowStatus = 'draft' | 'running' | 'paused' | 'completed' | 'failed';
export type NodeType = 'input' | 'llm' | 'agent' | 'api' | 'human' | 'branch' | 'output' | 'code' | 'integration';

export interface FlowNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: { label: string; config: Record<string, unknown> };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface Flow {
  id: string;
  projectId: string;
  name: string;
  description: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  status: FlowStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FlowRun {
  id: string;
  flowId: string;
  status: 'running' | 'paused' | 'completed' | 'failed';
  currentNodeId: string;
  nodeResults: Record<string, { status: string; output: unknown; error?: string }>;
  startedAt: Date;
  completedAt: Date | null;
}
