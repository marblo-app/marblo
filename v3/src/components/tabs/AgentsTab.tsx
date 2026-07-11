import { useState, useEffect } from "react";
import AgentDashboard from "../agents/AgentDashboard";
import AgentAddModal from "../agents/AgentAddModal";
import { useAgentStore } from "../../stores/agentStore";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { useSubscriptionStore } from "../../stores/subscriptionStore";
import { useUiStore } from "../../stores/uiStore";
import { useAuth } from "../../hooks/useAuth";
import { checkAgentSpawn } from "../../lib/planLimits";
import type { Agent, ModelType } from "../../types/agent";
import * as agentService from "../../services/agentService";
import { useTranslation } from "../../lib/i18n";

export function AgentsTab() {
  const { t } = useTranslation();
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
    // Plan throttle: gate before creating the Firestore doc. handleLaunch
    // bypasses agentStore.createAgent (it calls the service directly), so
    // we re-check here. Source of truth: lib/planLimits.ts.
    const plan = useSubscriptionStore.getState().getPlan();
    const check = checkAgentSpawn(plan, agents);
    if (!check.allowed) {
      // Free hit the fair-use agent cap → open the upgrade modal (routes to
      // Settings → Billing) instead of a dead-end alert.
      useUiStore.getState().showUpgrade("agents", "pro");
      return;
    }
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
        data.initialPrompt,
        undefined,
        projectId,
        data.assignedTaskId,
      );
      // Spawn blocked: this model's CLI is not installed / not logged in.
      // Open the CLI setup gate rather than attaching an empty terminal.
      if (result?.needsAuth) {
        window.dispatchEvent(new CustomEvent("marblo:open-cli-setup"));
        return;
      }
      // 에이전트 실행 즉시 터미널 탭 자동 연결 (출력 유실 방지)
      const MODEL_ICONS: Record<string, string> = {
        claude: "🟣",
        gemini: "🔵",
        gpt: "🟢",
        antigravity: "🟠",
        local: "⚫",
        custom: "⚪",
      };
      useTerminalStore
        .getState()
        .attachSession(
          result.ptySessionId,
          `${MODEL_ICONS[data.model] || "⚪"} ${data.name}`,
        );
    } catch (err) {
      console.error("Agent launch failed:", err);
    }
  };

  // Throttle indicator — visible badge so the user always knows their
  // remaining slots before they hit "Add Agent". Re-computes on every
  // agents/subscription change via store subscriptions.
  const planForBadge = useSubscriptionStore((s) => s.getPlan());
  const throttle = checkAgentSpawn(planForBadge, agents);
  const atLimit = !throttle.allowed;

  return (
    <div className="h-full flex flex-col">
      {throttle.limit > 0 && (
        <div
          className={`flex items-center justify-between border-b px-4 py-1.5 text-xs ${
            atLimit
              ? "border-[#f38ba8]/40 bg-[#f38ba8]/10 text-[#f38ba8]"
              : "border-[#313244] bg-[#181825] text-[#bac2de]"
          }`}
        >
          <span>
            {t("agents.tab.activeCount", {
              active: throttle.active,
              limit: throttle.limit,
            })}{" "}
            · <span className="uppercase">{planForBadge}</span>{" "}
            {t("agents.tab.plan")}
          </span>
          {atLimit && (
            <span className="text-[10px]">{t("agents.tab.atLimitHint")}</span>
          )}
        </div>
      )}
      <div className="flex-1 min-h-0">
        <AgentDashboard
          agents={agents}
          tasks={tasks}
          projectId={projectId}
          loading={loading}
          onAddAgent={() => {
            if (atLimit) {
              useUiStore.getState().showUpgrade("agents", "pro");
              return;
            }
            setShowAddModal(true);
          }}
          onStop={stopAgent}
          onRestart={restartAgent}
          onDelete={deleteAgent}
        />
      </div>

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
