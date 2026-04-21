import { useCallback, useRef, useEffect, forwardRef, useImperativeHandle, type DragEvent } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { InputNode } from './nodes/InputNode';
import { LLMNode } from './nodes/LLMNode';
import { AgentNode } from './nodes/AgentNode';
import { APINode } from './nodes/APINode';
import { HumanNode } from './nodes/HumanNode';
import { BranchNode } from './nodes/BranchNode';
import { OutputNode } from './nodes/OutputNode';
import { CodeNode } from './nodes/CodeNode';
import { IntegrationNode } from './nodes/IntegrationNode';
import type { NodeType, FlowNode, FlowEdge } from '../../types/flow';

const nodeTypes = {
  input: InputNode,
  llm: LLMNode,
  agent: AgentNode,
  api: APINode,
  human: HumanNode,
  branch: BranchNode,
  output: OutputNode,
  code: CodeNode,
  integration: IntegrationNode,
};

export interface FlowCanvasHandle {
  updateNodeConfig: (nodeId: string, config: Record<string, any>) => void;
}

export type NodeExecutionStatus = 'running' | 'completed' | 'error' | 'skipped';

interface FlowCanvasProps {
  initialNodes: FlowNode[];
  initialEdges: FlowEdge[];
  onChange: (nodes: FlowNode[], edges: FlowEdge[]) => void;
  onNodeSelect?: (node: FlowNode | null) => void;
  nodeStatuses?: Record<string, NodeExecutionStatus>;
}

const EXECUTION_CLASS_MAP: Record<NodeExecutionStatus, string> = {
  running: 'flow-node-running',
  completed: 'flow-node-completed',
  error: 'flow-node-error',
  skipped: 'flow-node-skipped',
};

function toReactFlowNodes(
  flowNodes: FlowNode[],
  nodeStatuses?: Record<string, NodeExecutionStatus>,
): Node[] {
  return flowNodes.map((n) => {
    const status = nodeStatuses?.[n.id];
    return {
      id: n.id,
      type: n.type,
      position: n.position,
      className: status ? EXECUTION_CLASS_MAP[status] : undefined,
      data: {
        label: n.data.label,
        nodeType: n.type,
        config: n.data.config ?? {},
        executionStatus: status,
      },
    };
  });
}

function toReactFlowEdges(flowEdges: FlowEdge[]): Edge[] {
  return flowEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    animated: true,
    style: { stroke: '#6b7280' },
  }));
}

function toFlowNodes(rfNodes: Node[]): FlowNode[] {
  return rfNodes.map((n) => ({
    id: n.id,
    type: (n.data as Record<string, unknown>).nodeType as NodeType,
    position: n.position,
    data: {
      label: (n.data as Record<string, unknown>).label as string,
      config: ((n.data as Record<string, unknown>).config ?? {}) as Record<string, any>,
    },
  }));
}

function toFlowEdges(rfEdges: Edge[]): FlowEdge[] {
  return rfEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
  }));
}

const NODE_LABELS: Record<NodeType, string> = {
  input: 'Input',
  llm: 'LLM',
  agent: 'Agent',
  api: 'API',
  human: 'Human',
  branch: 'Branch',
  output: 'Output',
  code: 'Code',
  integration: 'Integration',
};

let nodeIdCounter = 0;
function getNextId() {
  return `node_${Date.now()}_${nodeIdCounter++}`;
}

export const FlowCanvas = forwardRef<FlowCanvasHandle, FlowCanvasProps>(
  function FlowCanvas({ initialNodes, initialEdges, onChange, onNodeSelect, nodeStatuses }, ref) {
    const reactFlowWrapper = useRef<HTMLDivElement>(null);
    const [nodes, setNodes, onNodesChange] = useNodesState(toReactFlowNodes(initialNodes));
    const [edges, setEdges, onEdgesChange] = useEdgesState(toReactFlowEdges(initialEdges));

    // Update node classNames when nodeStatuses change
    useEffect(() => {
      if (!nodeStatuses) return;
      setNodes((nds) =>
        nds.map((n) => {
          const status = nodeStatuses[n.id];
          return {
            ...n,
            className: status ? EXECUTION_CLASS_MAP[status] : undefined,
            data: {
              ...n.data,
              executionStatus: status,
            },
          };
        }),
      );
    }, [nodeStatuses, setNodes]);
    const reactFlowInstance = useRef<ReactFlowInstance | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        updateNodeConfig: (nodeId: string, config: Record<string, any>) => {
          setNodes((nds) => {
            const updated = nds.map((n) => {
              if (n.id !== nodeId) return n;
              const prevData = n.data as Record<string, unknown>;
              // Handle _label special key from config panel
              const newLabel = config._label;
              const cleanConfig = { ...config };
              delete cleanConfig._label;
              return {
                ...n,
                data: {
                  ...prevData,
                  ...(newLabel !== undefined ? { label: newLabel } : {}),
                  config: cleanConfig,
                },
              };
            });
            setTimeout(() => onChange(toFlowNodes(updated), toFlowEdges(edges)), 0);
            return updated;
          });
        },
      }),
      [setNodes, edges, onChange],
    );

    const onConnect = useCallback(
      (connection: Connection) => {
        setEdges((eds) => {
          const newEdges = addEdge({ ...connection, animated: true, style: { stroke: '#6b7280' } }, eds);
          setTimeout(() => onChange(toFlowNodes(nodes), toFlowEdges(newEdges)), 0);
          return newEdges;
        });
      },
      [setEdges, nodes, onChange],
    );

    const handleNodesChange: typeof onNodesChange = useCallback(
      (changes) => {
        onNodesChange(changes);
        setTimeout(() => {
          setNodes((currentNodes) => {
            onChange(toFlowNodes(currentNodes), toFlowEdges(edges));
            return currentNodes;
          });
        }, 0);
      },
      [onNodesChange, edges, onChange, setNodes],
    );

    const handleEdgesChange: typeof onEdgesChange = useCallback(
      (changes) => {
        onEdgesChange(changes);
        setTimeout(() => {
          setEdges((currentEdges) => {
            onChange(toFlowNodes(nodes), toFlowEdges(currentEdges));
            return currentEdges;
          });
        }, 0);
      },
      [onEdgesChange, nodes, onChange, setEdges],
    );

    const onDragOver = useCallback((event: DragEvent) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    }, []);

    const onDrop = useCallback(
      (event: DragEvent) => {
        event.preventDefault();
        const nodeType = event.dataTransfer.getData('application/reactflow') as NodeType;
        if (!nodeType || !reactFlowInstance.current || !reactFlowWrapper.current) return;

        const bounds = reactFlowWrapper.current.getBoundingClientRect();
        const position = reactFlowInstance.current.screenToFlowPosition({
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        });

        const newNode: Node = {
          id: getNextId(),
          type: nodeType,
          position,
          data: {
            label: NODE_LABELS[nodeType],
            nodeType,
            config: {},
          },
        };

        setNodes((nds) => {
          const updated = [...nds, newNode];
          setTimeout(() => onChange(toFlowNodes(updated), toFlowEdges(edges)), 0);
          return updated;
        });
      },
      [setNodes, edges, onChange],
    );

    const onInit = useCallback((instance: ReactFlowInstance) => {
      reactFlowInstance.current = instance;
    }, []);

    const handleNodeClick = useCallback(
      (_event: React.MouseEvent, node: Node) => {
        if (!onNodeSelect) return;
        const data = node.data as Record<string, unknown>;
        const flowNode: FlowNode = {
          id: node.id,
          type: (data.nodeType as NodeType) ?? 'input',
          position: node.position,
          data: {
            label: (data.label as string) || '',
            config: ((data.config as Record<string, any>) ?? {}),
          },
        };
        onNodeSelect(flowNode);
      },
      [onNodeSelect],
    );

    const handlePaneClick = useCallback(() => {
      onNodeSelect?.(null);
    }, [onNodeSelect]);

    return (
      <div ref={reactFlowWrapper} className="h-full w-full">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={onConnect}
          onInit={onInit}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeClick={handleNodeClick}
          onPaneClick={handlePaneClick}
          nodeTypes={nodeTypes}
          colorMode="dark"
          fitView
          snapToGrid
          snapGrid={[16, 16]}
          defaultEdgeOptions={{ animated: true, style: { stroke: '#6b7280' } }}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#374151" />
          <Controls className="!bg-gray-800 !border-gray-700 !rounded-lg [&>button]:!bg-gray-800 [&>button]:!border-gray-700 [&>button]:!text-gray-300 [&>button:hover]:!bg-gray-700" />
          <MiniMap
            nodeColor="#4b5563"
            maskColor="rgba(0,0,0,0.6)"
            className="!bg-gray-800 !border-gray-700 !rounded-lg"
          />
        </ReactFlow>
      </div>
    );
  },
);
