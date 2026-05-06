import { useState, useEffect } from "react";
import AgentDashboard from "../agents/AgentDashboard";
import AgentAddModal from "../agents/AgentAddModal";
import { useAgentStore } from "../../stores/agentStore";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { useAuth } from "../../hooks/useAuth";
import type { Agent, ModelType } from "../../types/agent";
import * as agentService from "../../services/agentService";

export function AgentsTab() {
  const { user } = useAuth();
  const currentProject = useProjectStore((s) => s.currentProject);
  const agents = useAgentStore((s) => s.agents);
  const loading = useAgentStore((s) => s.loading);
  const subscribeToAgents = useAgentStore((s) => s.subscribeToAgents);
  const stopAgent = useAgentStore((s) => s.stopAgent);
  const restartAgent = useAgentStore((s) => s.restartAgent);
  const deleteAgent = useAgentStore((s) => s.deleteAgent);
  const tasks = useTaskStore((s) => s.tasks);
  const subscribeToTasks = useTaskStore((s) => s.subscribeToTasks);
  const [showAddModal, setShowAddModal] = useState(false);

  const projectId = currentProject?.id || "";

  useEffect(() => {
    if (!projectId) return;
    const unsub = subscribeToAgents(projectId);
    return unsub;
  }, [projectId, subscribeToAgents]);

  useEffect(() => {
    if (!projectId) return;
    const unsub = subscribeToTasks(projectId);
    return unsub;
  }, [projectId, subscribeToTasks]);

  // Consume cross-tab agent jump (Activity Stream "🤖 에이전트 보기").
  // We scroll the matching card into view and flash a purple ring for ~1.4s.
  // Done via DOM rather than state-prop-drilling — one feature, one effect.
  const pendingJump = useNavigationStore((s) => s.pendingJump);
  const consumeJump = useNavigationStore((s) => s.consumeJump);
  useEffect(() => {
    if (!pendingJump || pendingJump.type !== "agent") return;
    if (agents.length === 0) return; // wait for subscription to deliver data
    const id = pendingJump.id;
    consumeJump();
    requestAnimationFrame(() => {
      const el = document.getElementById(`agent-card-${id}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-[#cba6f7]");
      setTimeout(() => {
        el.classList.remove("ring-2", "ring-[#cba6f7]");
      }, 1400);
    });
  }, [pendingJump, agents, consumeJump]);

  const handleLaunch = async (data: {
    name: string;
    model: ModelType;
    role: string;
    command: string;
    cwd: string;
    initialPrompt?: string;
    assignedTaskId?: string;
  }) => {
    if (!user || !projectId) return;
    const agentData = {
      projectId,
      ownerId: user.uid,
      name: data.name,
      model: data.model,
      role: data.role,
      status: "idle" as const,
      currentTaskId: data.assignedTaskId || null,
      command: data.command,
      skillFile: "",
    };
    const id = await agentService.createAgent(agentData);
    const agent = { ...agentData, id, createdAt: new Date() } as Agent;
    try {
      const result = await window.electronAPI.agent.launch(
        agent,
        data.cwd,
        data.initialPrompt
      );
      // 에이전트 실행 즉시 터미널 탭 자동 연결 (출력 유실 방지)
      const MODEL_ICONS: Record<string, string> = {
        claude: "🟣",
        gemini: "🔵",
        gpt: "🟢",
        custom: "⚪",
      };
      useTerminalStore
        .getState()
        .attachSession(
          result.ptySessionId,
          `${MODEL_ICONS[data.model] || "⚪"} ${data.name}`
        );
    } catch (err) {
      console.error("Agent launch failed:", err);
    }
  };

  return (
    <div className="h-full">
      <AgentDashboard
        agents={agents}
        tasks={tasks}
        projectId={projectId}
        loading={loading}
        onAddAgent={() => setShowAddModal(true)}
        onStop={stopAgent}
        onRestart={restartAgent}
        onDelete={deleteAgent}
      />

      {showAddModal && user && projectId && (
        <AgentAddModal
          projectId={projectId}
          ownerId={user.uid}
          tasks={tasks}
          onLaunch={handleLaunch}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}
