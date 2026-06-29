import { useEffect, useState } from "react";
import { subscribeToDocument } from "../../services/firestore";
import type { Flow } from "../../types/flow";
import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";

interface FlowKanbanLinkProps {
  flowId: string;
  flowNodeId: string;
  /** Called when user clicks to navigate to the flow */
  onNavigate?: (flowId: string, nodeId: string) => void;
}

type NodeStatus = "running" | "waiting" | "completed" | "error" | "unknown";

const statusConfig: Record<
  NodeStatus,
  { labelKey: MessageKey; dot: string; text: string }
> = {
  running: {
    labelKey: "flows.status.running",
    dot: "bg-green-500 animate-pulse",
    text: "text-green-400",
  },
  waiting: {
    labelKey: "flows.status.waiting",
    dot: "bg-yellow-500 animate-pulse",
    text: "text-yellow-400",
  },
  completed: {
    labelKey: "flows.status.completed",
    dot: "bg-blue-500",
    text: "text-blue-400",
  },
  error: {
    labelKey: "flows.status.error",
    dot: "bg-red-500",
    text: "text-red-400",
  },
  unknown: {
    labelKey: "flows.status.unknown",
    dot: "bg-gray-600",
    text: "text-gray-500",
  },
};

export default function FlowKanbanLink({
  flowId,
  flowNodeId,
  onNavigate,
}: FlowKanbanLinkProps) {
  const { t } = useTranslation();
  const [flow, setFlow] = useState<Flow | null>(null);
  const [nodeStatus, setNodeStatus] = useState<NodeStatus>("unknown");

  // Subscribe to flow document for real-time name/status
  useEffect(() => {
    const unsub = subscribeToDocument<Flow>("flows", flowId, (f) => {
      setFlow(f);
    });
    return unsub;
  }, [flowId]);

  // Subscribe to the latest flow run to get node execution status
  useEffect(() => {
    if (!flowId) return;

    const unsub = subscribeToDocument<{
      id: string;
      flowId: string;
      status: string;
      currentNodeIds: string[];
      nodeResults: Record<string, { status: string }>;
    }>("flowRuns", flowId, (run) => {
      if (!run) {
        setNodeStatus("unknown");
        return;
      }

      const nodeResult = run.nodeResults?.[flowNodeId];
      if (nodeResult) {
        if (nodeResult.status === "success") setNodeStatus("completed");
        else if (nodeResult.status === "error") setNodeStatus("error");
        else setNodeStatus("running");
      } else if (run.currentNodeIds?.includes(flowNodeId)) {
        setNodeStatus("running");
      } else if (run.status === "paused") {
        setNodeStatus("waiting");
      } else {
        setNodeStatus("unknown");
      }
    });

    return unsub;
  }, [flowId, flowNodeId]);

  const node = flow?.nodes.find((n) => n.id === flowNodeId);
  const status = statusConfig[nodeStatus];
  const flowName = flow?.name ?? "Flow";
  const nodeName = node?.data.label ?? flowNodeId;

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onNavigate?.(flowId, flowNodeId);
      }}
      className="flex items-center gap-2 rounded border border-indigo-800/40 bg-indigo-900/20 px-2.5 py-1.5 text-left transition-colors hover:bg-indigo-900/30 hover:border-indigo-700/50 w-full"
      title={`Flow: ${flowName} → ${nodeName}`}
    >
      {/* Flow icon */}
      <span className="text-indigo-400 text-xs flex-shrink-0">⚡</span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium text-indigo-300">
            {flowName}
          </span>
          <span className="text-gray-600 text-xs">→</span>
          <span className="truncate text-xs text-gray-400">{nodeName}</span>
        </div>
      </div>

      {/* Status indicator */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
        <span className={`text-xs ${status.text}`}>{t(status.labelKey)}</span>
      </div>
    </button>
  );
}
