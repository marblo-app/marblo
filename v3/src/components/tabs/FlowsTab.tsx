import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useFlows } from "../../hooks/useFlows";
import { useFlowExecution } from "../../hooks/useFlowExecution";
import { useProjectStore } from "../../stores/projectStore";
import { FlowList } from "../flows/FlowList";
import { NodePalette } from "../flows/NodePalette";
import { FlowCanvas, type FlowCanvasHandle } from "../flows/FlowCanvas";
import { NodeConfigPanel } from "../flows/NodeConfigPanel";
import { NodeResultPanel } from "../flows/NodeResultPanel";
import { HumanApprovalModal } from "../flows/HumanApprovalModal";
import { useTranslation } from "../../lib/i18n";
import type { FlowNode, FlowEdge } from "../../types/flow";

interface FlowPreset {
  name: string;
  description: string;
  detail: string;
  icon: string;
  color: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

const FLOW_PRESETS: FlowPreset[] = [
  {
    name: "Hello World (Python)",
    description: "Input → Python 코드 → Output",
    detail:
      "가장 간단한 플로우. 이름을 입력하면 Python이 인사말을 생성하고 Output으로 출력합니다. 플로우 동작 확인용.",
    icon: "👋",
    color: "border-emerald-500/30 hover:border-emerald-500/60",
    nodes: [
      {
        id: "n1",
        type: "input",
        position: { x: 250, y: 0 },
        data: { label: "이름 입력", config: { name: "Marblo" } },
      },
      {
        id: "n2",
        type: "code",
        position: { x: 250, y: 140 },
        data: {
          label: "Python 인사말",
          config: {
            language: "python",
            script:
              'import json, os\ninp = json.loads(os.environ.get("FLOW_INPUT", "{}"))\nname = inp.get("name", "World")\nprint(json.dumps({"greeting": f"안녕하세요 {name}님!", "length": len(name)}))',
          },
        },
      },
      {
        id: "n3",
        type: "output",
        position: { x: 250, y: 280 },
        data: { label: "결과 출력", config: { format: "json" } },
      },
    ],
    edges: [
      { id: "e1", source: "n1", target: "n2" },
      { id: "e2", source: "n2", target: "n3" },
    ],
  },
  {
    name: "API + 분기 테스트",
    description: "API 호출 → 분기(성공/실패) → Output",
    detail:
      "httpbin.org 공개 API를 호출하고, 응답 상태에 따라 성공/실패로 분기합니다. API 노드와 Branch 노드 테스트용.",
    icon: "🔀",
    color: "border-yellow-500/30 hover:border-yellow-500/60",
    nodes: [
      {
        id: "n1",
        type: "input",
        position: { x: 250, y: 0 },
        data: { label: "검색어 입력", config: { query: "marblo" } },
      },
      {
        id: "n2",
        type: "api",
        position: { x: 250, y: 140 },
        data: {
          label: "API 호출",
          config: { url: "https://httpbin.org/get?q={{query}}", method: "GET" },
        },
      },
      {
        id: "n3",
        type: "branch",
        position: { x: 250, y: 280 },
        data: {
          label: "성공?",
          config: { condition: "equals", field: "status", value: 200 },
        },
      },
      {
        id: "n4",
        type: "output",
        position: { x: 100, y: 420 },
        data: { label: "성공 결과", config: { format: "json" } },
      },
      {
        id: "n5",
        type: "output",
        position: { x: 400, y: 420 },
        data: { label: "에러", config: { format: "text" } },
      },
    ],
    edges: [
      { id: "e1", source: "n1", target: "n2" },
      { id: "e2", source: "n2", target: "n3" },
      { id: "e3", source: "n3", target: "n4", sourceHandle: "true" },
      { id: "e4", source: "n3", target: "n5", sourceHandle: "false" },
    ],
  },
  {
    name: "Python 데이터 분석",
    description: "Input → Python 분석 → Branch → Output",
    detail:
      "Python으로 데이터를 분석하고 점수에 따라 Pass/Fail로 분기합니다. Code + Branch 조합 테스트용.",
    icon: "🐍",
    color: "border-cyan-500/30 hover:border-cyan-500/60",
    nodes: [
      {
        id: "n1",
        type: "input",
        position: { x: 250, y: 0 },
        data: { label: "점수 입력", config: { scores: "85,92,78,95,60" } },
      },
      {
        id: "n2",
        type: "code",
        position: { x: 250, y: 140 },
        data: {
          label: "Python 분석",
          config: {
            language: "python",
            script:
              'import json, os\ninp = json.loads(os.environ.get("FLOW_INPUT", "{}"))\nscores = [int(x) for x in inp.get("scores", "0").split(",")]\navg = sum(scores) / len(scores)\npassed = avg >= 70\nprint(json.dumps({"average": round(avg, 1), "count": len(scores), "min": min(scores), "max": max(scores), "passed": passed}))',
          },
        },
      },
      {
        id: "n3",
        type: "branch",
        position: { x: 250, y: 280 },
        data: {
          label: "평균 70 이상?",
          config: { condition: "truthy", field: "passed" },
        },
      },
      {
        id: "n4",
        type: "code",
        position: { x: 80, y: 420 },
        data: {
          label: "합격 리포트",
          config: {
            language: "python",
            script:
              'import json, os\ninp = json.loads(os.environ.get("FLOW_INPUT", "{}"))\navg = inp.get("average", 0)\nprint(json.dumps({"result": "PASS", "message": f"평균 {avg}점으로 합격입니다!", "grade": "A" if avg >= 90 else "B" if avg >= 80 else "C"}))',
          },
        },
      },
      {
        id: "n5",
        type: "code",
        position: { x: 420, y: 420 },
        data: {
          label: "불합격 리포트",
          config: {
            language: "python",
            script:
              'import json, os\ninp = json.loads(os.environ.get("FLOW_INPUT", "{}"))\navg = inp.get("average", 0)\nprint(json.dumps({"result": "FAIL", "message": f"평균 {avg}점으로 불합격입니다.", "recommendation": "추가 학습이 필요합니다"}))',
          },
        },
      },
      {
        id: "n6",
        type: "output",
        position: { x: 250, y: 560 },
        data: { label: "최종 결과", config: { format: "json" } },
      },
    ],
    edges: [
      { id: "e1", source: "n1", target: "n2" },
      { id: "e2", source: "n2", target: "n3" },
      { id: "e3", source: "n3", target: "n4", sourceHandle: "true" },
      { id: "e4", source: "n3", target: "n5", sourceHandle: "false" },
      { id: "e5", source: "n4", target: "n6" },
      { id: "e6", source: "n5", target: "n6" },
    ],
  },
  {
    name: "CI/CD 파이프라인",
    description: "코드 생성 → 린트 → 테스트 → PR 생성",
    detail:
      "Agent가 코드를 생성하고 API로 린트/포맷을 실행합니다. 테스트 Agent가 검증 후 Branch에서 통과 여부를 판단하여 PR 생성 또는 수정 요청으로 분기합니다.",
    icon: "🚀",
    color: "border-green-500/30 hover:border-green-500/60",
    nodes: [
      {
        id: "n1",
        type: "input",
        position: { x: 250, y: 0 },
        data: { label: "코드 입력", config: { inputType: "text" } },
      },
      {
        id: "n2",
        type: "agent",
        position: { x: 250, y: 120 },
        data: {
          label: "코드 생성",
          config: { role: "backend", model: "claude" },
        },
      },
      {
        id: "n3",
        type: "api",
        position: { x: 250, y: 240 },
        data: { label: "린트 & 포맷", config: { url: "", method: "POST" } },
      },
      {
        id: "n4",
        type: "agent",
        position: { x: 250, y: 360 },
        data: {
          label: "테스트 실행",
          config: { role: "test", model: "claude" },
        },
      },
      {
        id: "n5",
        type: "branch",
        position: { x: 250, y: 480 },
        data: {
          label: "테스트 통과?",
          config: { condition: "result.passed === true" },
        },
      },
      {
        id: "n6",
        type: "agent",
        position: { x: 100, y: 600 },
        data: {
          label: "PR 생성",
          config: { role: "backend", model: "claude" },
        },
      },
      {
        id: "n7",
        type: "agent",
        position: { x: 400, y: 600 },
        data: {
          label: "수정 요청",
          config: { role: "backend", model: "claude" },
        },
      },
      {
        id: "n8",
        type: "output",
        position: { x: 250, y: 720 },
        data: { label: "완료", config: {} },
      },
    ],
    edges: [
      { id: "e1", source: "n1", target: "n2" },
      { id: "e2", source: "n2", target: "n3" },
      { id: "e3", source: "n3", target: "n4" },
      { id: "e4", source: "n4", target: "n5" },
      { id: "e5", source: "n5", target: "n6" },
      { id: "e6", source: "n5", target: "n7" },
      { id: "e7", source: "n6", target: "n8" },
      { id: "e8", source: "n7", target: "n2" },
    ],
  },
  {
    name: "코드 리뷰 플로우",
    description: "LLM 리뷰 → 사람 승인 → 머지",
    detail:
      "Opus 4.6이 코드 변경사항을 자동 리뷰합니다. 이슈가 있으면 Agent가 수정 제안을, 없으면 Human 노드에서 PM 승인 후 머지됩니다.",
    icon: "👀",
    color: "border-purple-500/30 hover:border-purple-500/60",
    nodes: [
      {
        id: "n1",
        type: "input",
        position: { x: 250, y: 0 },
        data: { label: "PR / Diff 입력", config: { inputType: "text" } },
      },
      {
        id: "n2",
        type: "llm",
        position: { x: 250, y: 120 },
        data: {
          label: "AI 코드 리뷰",
          config: {
            model: "claude-opus-4-6",
            temperature: 0.3,
            prompt: "코드 변경사항을 리뷰해주세요",
          },
        },
      },
      {
        id: "n3",
        type: "branch",
        position: { x: 250, y: 250 },
        data: {
          label: "이슈 발견?",
          config: { condition: "review.hasIssues" },
        },
      },
      {
        id: "n4",
        type: "human",
        position: { x: 100, y: 380 },
        data: { label: "PM 승인", config: { approver: "PM" } },
      },
      {
        id: "n5",
        type: "agent",
        position: { x: 400, y: 380 },
        data: {
          label: "자동 수정 제안",
          config: { role: "backend", model: "claude" },
        },
      },
      {
        id: "n6",
        type: "output",
        position: { x: 250, y: 500 },
        data: { label: "리뷰 완료", config: {} },
      },
    ],
    edges: [
      { id: "e1", source: "n1", target: "n2" },
      { id: "e2", source: "n2", target: "n3" },
      { id: "e3", source: "n3", target: "n4" },
      { id: "e4", source: "n3", target: "n5" },
      { id: "e5", source: "n4", target: "n6" },
      { id: "e6", source: "n5", target: "n6" },
    ],
  },
  {
    name: "멀티 에이전트 협업",
    description: "Backend + Frontend 병렬 → 통합 테스트",
    detail:
      "LLM이 요구사항을 분석한 뒤 Backend/Frontend Agent가 동시에 작업합니다. 양쪽 완료 후 Test Agent가 통합 테스트를 실행하고 PM이 최종 확인합니다.",
    icon: "🤖",
    color: "border-blue-500/30 hover:border-blue-500/60",
    nodes: [
      {
        id: "n1",
        type: "input",
        position: { x: 250, y: 0 },
        data: { label: "요구사항 입력", config: { inputType: "text" } },
      },
      {
        id: "n2",
        type: "llm",
        position: { x: 250, y: 120 },
        data: {
          label: "태스크 분석",
          config: {
            model: "claude-opus-4-6",
            temperature: 0.5,
            prompt: "요구사항을 분석하고 백엔드/프론트 작업을 분리해주세요",
          },
        },
      },
      {
        id: "n3",
        type: "agent",
        position: { x: 80, y: 260 },
        data: {
          label: "Backend Agent",
          config: { role: "backend", model: "claude" },
        },
      },
      {
        id: "n4",
        type: "agent",
        position: { x: 420, y: 260 },
        data: {
          label: "Frontend Agent",
          config: { role: "frontend", model: "claude" },
        },
      },
      {
        id: "n5",
        type: "agent",
        position: { x: 250, y: 400 },
        data: {
          label: "통합 테스트",
          config: { role: "test", model: "claude" },
        },
      },
      {
        id: "n6",
        type: "human",
        position: { x: 250, y: 530 },
        data: { label: "PM 확인", config: { approver: "PM" } },
      },
      {
        id: "n7",
        type: "output",
        position: { x: 250, y: 650 },
        data: { label: "완료", config: {} },
      },
    ],
    edges: [
      { id: "e1", source: "n1", target: "n2" },
      { id: "e2", source: "n2", target: "n3" },
      { id: "e3", source: "n2", target: "n4" },
      { id: "e4", source: "n3", target: "n5" },
      { id: "e5", source: "n4", target: "n5" },
      { id: "e6", source: "n5", target: "n6" },
      { id: "e7", source: "n6", target: "n7" },
    ],
  },
];

export function FlowsTab() {
  const { t } = useTranslation();
  const currentProject = useProjectStore((s) => s.currentProject);
  const projectId = currentProject?.id || "";

  const {
    flows,
    selectedFlow,
    selectedFlowId,
    loading,
    saveStatus,
    setSelectedFlowId,
    createFlow,
    deleteFlow,
    saveFlow,
    autoSave,
  } = useFlows(projectId);

  const {
    run: runFlow,
    pause: pauseFlow,
    resume: resumeFlow,
    cancel: cancelFlow,
    reset: resetExecution,
    executionState,
    nodeStatuses,
    nodeResults,
    pendingHumanNodeId,
  } = useFlowExecution();

  const [editingName, setEditingName] = useState(false);
  const [flowName, setFlowName] = useState("");
  const [selectedNode, setSelectedNode] = useState<FlowNode | null>(null);
  const [selectedResultNodeId, setSelectedResultNodeId] = useState<
    string | null
  >(null);
  const canvasRef = useRef<FlowCanvasHandle>(null);

  useEffect(() => {
    if (selectedFlow) {
      setFlowName(selectedFlow.name);
    }
  }, [selectedFlow]);

  // Clear selected node and reset execution when switching flows
  useEffect(() => {
    setSelectedNode(null);
    setSelectedResultNodeId(null);
    resetExecution();
  }, [selectedFlowId, resetExecution]);

  // Find the label for the pending human node
  const pendingHumanNodeLabel = useMemo(() => {
    if (!pendingHumanNodeId || !selectedFlow) return "";
    const node = selectedFlow.nodes.find((n) => n.id === pendingHumanNodeId);
    return node?.data.label || "Human Approval";
  }, [pendingHumanNodeId, selectedFlow]);

  const handleRun = useCallback(() => {
    if (selectedFlow) {
      runFlow(selectedFlow);
    }
  }, [selectedFlow, runFlow]);

  const handleApprove = useCallback(() => {
    if (pendingHumanNodeId) {
      resumeFlow({ nodeId: pendingHumanNodeId, approved: true });
    }
  }, [pendingHumanNodeId, resumeFlow]);

  const handleReject = useCallback(() => {
    if (pendingHumanNodeId) {
      resumeFlow({ nodeId: pendingHumanNodeId, approved: false });
    }
  }, [pendingHumanNodeId, resumeFlow]);

  const handleCanvasChange = useCallback(
    (nodes: FlowNode[], edges: FlowEdge[]) => {
      if (selectedFlowId) {
        autoSave(selectedFlowId, { nodes, edges });
      }
    },
    [selectedFlowId, autoSave],
  );

  const handleNodeSelect = useCallback(
    (node: FlowNode | null) => {
      setSelectedNode(node);
      if (node && executionState !== "idle" && node.id in nodeResults) {
        setSelectedResultNodeId(node.id);
      } else {
        setSelectedResultNodeId(null);
      }
    },
    [executionState, nodeResults],
  );

  const handleConfigChange = useCallback(
    (nodeId: string, config: Record<string, unknown>) => {
      canvasRef.current?.updateNodeConfig(nodeId, config);
      // Update the selectedNode state to reflect changes in the panel
      setSelectedNode((prev) => {
        if (!prev || prev.id !== nodeId) return prev;
        const newLabel =
          typeof config._label === "string" ? config._label : undefined;
        const cleanConfig = { ...config };
        delete cleanConfig._label;
        return {
          ...prev,
          data: {
            ...prev.data,
            ...(newLabel !== undefined ? { label: newLabel } : {}),
            config: cleanConfig,
          },
        };
      });
    },
    [],
  );

  const handleNameSave = useCallback(async () => {
    if (selectedFlowId && flowName.trim()) {
      await saveFlow(selectedFlowId, { name: flowName.trim() });
    }
    setEditingName(false);
  }, [selectedFlowId, flowName, saveFlow]);

  const saveStatusLabel =
    saveStatus === "saved"
      ? "Saved"
      : saveStatus === "saving"
        ? "Saving..."
        : "Unsaved";
  const saveStatusColor =
    saveStatus === "saved"
      ? "text-green-400"
      : saveStatus === "saving"
        ? "text-yellow-400"
        : "text-gray-500";

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400">
        <div className="animate-pulse">Loading flows...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      {selectedFlow && (
        <div className="flex items-center justify-between border-b border-gray-700 px-4 py-2 bg-gray-800/50">
          <div className="flex items-center gap-3">
            {editingName ? (
              <input
                type="text"
                value={flowName}
                onChange={(e) => setFlowName(e.target.value)}
                onBlur={handleNameSave}
                onKeyDown={(e) => e.key === "Enter" && handleNameSave()}
                className="bg-gray-700 border border-gray-600 rounded px-2 py-0.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                autoFocus
              />
            ) : (
              <button
                onClick={() => setEditingName(true)}
                className="text-sm font-medium text-gray-200 hover:text-white transition-colors"
              >
                {selectedFlow.name}
              </button>
            )}
            <span className={`text-xs ${saveStatusColor}`}>
              {saveStatusLabel}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Flow status badge */}
            <span className="text-xs text-gray-500 bg-gray-700/50 px-2 py-0.5 rounded">
              {selectedFlow.status}
            </span>

            {/* Execution status badge */}
            {executionState !== "idle" && (
              <span
                className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded font-medium ${
                  executionState === "running"
                    ? "bg-green-900/40 text-green-400"
                    : executionState === "paused"
                      ? "bg-yellow-900/40 text-yellow-400"
                      : executionState === "completed"
                        ? "bg-green-900/40 text-green-400"
                        : "bg-red-900/40 text-red-400"
                }`}
              >
                {executionState === "running" && (
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                  </span>
                )}
                {executionState === "paused" && (
                  <svg
                    className="h-3 w-3"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
                {executionState}
              </span>
            )}

            {/* Execution control buttons */}
            {executionState === "idle" ||
            executionState === "completed" ||
            executionState === "failed" ? (
              <button
                onClick={handleRun}
                className="px-3 py-1 bg-green-600 hover:bg-green-500 text-white text-xs rounded transition-colors flex items-center gap-1"
              >
                <svg
                  className="h-3 w-3"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                    clipRule="evenodd"
                  />
                </svg>
                Run
              </button>
            ) : executionState === "running" ? (
              <>
                <button
                  onClick={pauseFlow}
                  className="px-3 py-1 bg-yellow-600 hover:bg-yellow-500 text-white text-xs rounded transition-colors flex items-center gap-1"
                >
                  <svg
                    className="h-3 w-3"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Pause
                </button>
                <button
                  onClick={cancelFlow}
                  className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white text-xs rounded transition-colors flex items-center gap-1"
                >
                  <svg
                    className="h-3 w-3"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Cancel
                </button>
              </>
            ) : executionState === "paused" ? (
              <>
                <button
                  onClick={() => resumeFlow()}
                  className="px-3 py-1 bg-green-600 hover:bg-green-500 text-white text-xs rounded transition-colors flex items-center gap-1"
                >
                  <svg
                    className="h-3 w-3"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Resume
                </button>
                <button
                  onClick={cancelFlow}
                  className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white text-xs rounded transition-colors flex items-center gap-1"
                >
                  <svg
                    className="h-3 w-3"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Cancel
                </button>
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <div className="w-56 flex-shrink-0 border-r border-gray-700 bg-gray-800/30 overflow-y-auto">
          <FlowList
            flows={flows}
            selectedFlowId={selectedFlowId}
            onSelect={setSelectedFlowId}
            onCreate={createFlow}
            onDelete={deleteFlow}
          />
          <div className="border-t border-gray-700">
            <NodePalette />
          </div>
        </div>

        {/* Canvas area */}
        <div className="flex-1 bg-gray-900">
          {selectedFlow ? (
            <FlowCanvas
              ref={canvasRef}
              key={selectedFlow.id}
              initialNodes={selectedFlow.nodes}
              initialEdges={selectedFlow.edges}
              onChange={handleCanvasChange}
              onNodeSelect={handleNodeSelect}
              nodeStatuses={nodeStatuses}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-gray-500 p-8 overflow-y-auto">
              <div className="text-center max-w-2xl space-y-6">
                <div>
                  <svg
                    className="mx-auto h-12 w-12 text-gray-600 mb-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
                    />
                  </svg>
                  <p className="text-sm mb-1">{t("flows.empty.title")}</p>
                  <p className="text-xs text-gray-600">
                    {t("flows.empty.subtitle")}
                  </p>
                </div>

                {/* Preset templates */}
                <div className="grid grid-cols-3 gap-3 text-left">
                  {FLOW_PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      onClick={() =>
                        createFlow(preset.name, {
                          nodes: preset.nodes,
                          edges: preset.edges,
                          description: preset.description,
                        })
                      }
                      className={`rounded-lg border bg-gray-800/60 p-3 transition-all hover:bg-gray-800 text-left ${preset.color}`}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-lg">{preset.icon}</span>
                        <span className="text-sm font-medium text-gray-200">
                          {preset.name}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 font-medium mb-1">
                        {preset.description}
                      </p>
                      <p className="text-[11px] text-gray-500 leading-relaxed">
                        {preset.detail}
                      </p>
                      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-700/50">
                        <span className="text-[11px] text-gray-600">
                          {preset.nodes.length} nodes · {preset.edges.length}{" "}
                          edges
                        </span>
                        <span className="ml-auto text-[11px] text-blue-500/70">
                          {t("flows.preset.create")}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>

                <div className="text-left rounded-lg border border-gray-700 bg-gray-800/50 p-4 space-y-3">
                  <p className="text-xs font-medium text-gray-400">
                    {t("flows.guide.title")}
                  </p>
                  <div className="space-y-2 text-xs text-gray-500">
                    <div className="flex gap-2">
                      <span className="text-gray-400 font-mono w-4 flex-shrink-0">
                        1.
                      </span>
                      <span>
                        {t("flows.guide.step1.pre")}
                        <strong className="text-gray-400">+ New Flow</strong>
                        {t("flows.guide.step1.mid")}
                        <strong className="text-gray-400">
                          {t("flows.guide.step1.preset")}
                        </strong>
                        {t("flows.guide.step1.post")}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-gray-400 font-mono w-4 flex-shrink-0">
                        2.
                      </span>
                      <span>
                        {t("flows.guide.step2.pre")}
                        <strong className="text-gray-400">Node Palette</strong>
                        {t("flows.guide.step2.post")}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-gray-400 font-mono w-4 flex-shrink-0">
                        3.
                      </span>
                      <span>
                        {t("flows.guide.step3.pre")}
                        <strong className="text-gray-400">
                          {t("flows.guide.step3.handle")}
                        </strong>
                        {t("flows.guide.step3.post")}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-gray-400 font-mono w-4 flex-shrink-0">
                        4.
                      </span>
                      <span>
                        {t("flows.guide.step4.pre")}
                        <strong className="text-gray-400">
                          {t("flows.guide.step4.panel")}
                        </strong>
                        {t("flows.guide.step4.post")}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-gray-400 font-mono w-4 flex-shrink-0">
                        5.
                      </span>
                      <span>
                        {t("flows.guide.step5.pre")}
                        <strong className="text-gray-400">/tf-flow</strong>
                        {t("flows.guide.step5.post")}
                      </span>
                    </div>
                  </div>

                  <div className="border-t border-gray-700 pt-2 space-y-1">
                    <p className="text-xs font-medium text-gray-400">
                      {t("flows.nodeTypes.title")}
                    </p>
                    <div className="grid grid-cols-2 gap-1 text-xs text-gray-500">
                      <span>
                        <strong className="text-blue-400">Agent</strong> —{" "}
                        {t("flows.nodeTypes.agent")}
                      </span>
                      <span>
                        <strong className="text-purple-400">LLM</strong> —{" "}
                        {t("flows.nodeTypes.llm")}
                      </span>
                      <span>
                        <strong className="text-emerald-400">Code</strong> —
                        Python/Shell/Node
                      </span>
                      <span>
                        <strong className="text-orange-400">API</strong> —{" "}
                        {t("flows.nodeTypes.api")}
                      </span>
                      <span>
                        <strong className="text-rose-400">Integration</strong> —{" "}
                        {t("flows.nodeTypes.integration")}
                      </span>
                      <span>
                        <strong className="text-yellow-400">Branch</strong> —{" "}
                        {t("flows.nodeTypes.branch")}
                      </span>
                      <span>
                        <strong className="text-orange-300">Human</strong> —{" "}
                        {t("flows.nodeTypes.human")}
                      </span>
                      <span>
                        <strong className="text-cyan-400">Input/Output</strong>{" "}
                        — {t("flows.nodeTypes.io")}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right sidebar: Node result panel or config panel */}
        {selectedResultNodeId &&
        selectedNode &&
        selectedResultNodeId === selectedNode.id ? (
          <NodeResultPanel
            nodeId={selectedResultNodeId}
            nodeLabel={selectedNode.data.label || selectedResultNodeId}
            result={nodeResults[selectedResultNodeId]}
            onClose={() => {
              setSelectedResultNodeId(null);
              setSelectedNode(null);
            }}
          />
        ) : selectedNode ? (
          <NodeConfigPanel
            node={selectedNode}
            onConfigChange={handleConfigChange}
            onClose={() => setSelectedNode(null)}
          />
        ) : null}
      </div>

      {/* Human approval modal */}
      {pendingHumanNodeId && (
        <HumanApprovalModal
          pendingNodeId={pendingHumanNodeId}
          nodeLabel={pendingHumanNodeLabel}
          onApprove={handleApprove}
          onReject={handleReject}
        />
      )}
    </div>
  );
}
